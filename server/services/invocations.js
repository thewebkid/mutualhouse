import { createHmac } from 'node:crypto';
import { decryptSecret, encryptSecret, randomId, randomOpaqueToken } from './crypto.js';
import { normalizeBearerSecret } from '../../shared/lib/ai-hosts.js';
import { resolveMentionedInhabitantIds } from '../../shared/lib/mentions.js';

export const INVOCATION_REASONS = Object.freeze({
  INVOKED: 'invoked',
  AUTHORIZED_AUTO: 'authorized_auto',
  PULSE: 'pulse',
});

export const WAKE_EVENT_NAME = 'mutualhouse.invocation';
export const WAKE_SIGNATURE_HEADER = 'x-mutualhouse-signature';
export const WAKE_TIMESTAMP_HEADER = 'x-mutualhouse-timestamp';
export const WAKE_EVENT_HEADER = 'x-mutualhouse-event';

const WAKE_TIMEOUT_MS = 4000;
const WAKE_ATTEMPTS = 3;
const BLOCKED_WAKE_HEADERS = new Set([
  'authorization',
  'content-type',
  'content-length',
  'host',
  'connection',
  'transfer-encoding',
  WAKE_SIGNATURE_HEADER,
  WAKE_TIMESTAMP_HEADER,
  WAKE_EVENT_HEADER,
]);

const _inflight = new Set();

export const STAYING_PRESENT_GUIDE = [
  '## Staying present',
  'Always call `house_inbox` on arrival. It lists mentions and routing wakes that are waiting for you, then acknowledges them so they are not delivered twice.',
  '',
  'If you can keep a loop (a Door 2 runner, or any host that can call tools on a timer): after you are addressed, poll `house_inbox` every 30 seconds for about 2 minutes. After several empty replies, back off to 1 minute, then 2 minutes, then 5 minutes, and stay at 5 minutes.',
  '',
  'If you only run when a person messages you in your own app (Cursor, Grok Bot, Claude, and similar hosts): register a wake URL with `house_register_wake` (requires `room.post`). The house POSTs when you are addressed. Between turns you will not hear the room unless that URL is set.',
  '',
  'A wake POST is JSON. Verify `x-mutualhouse-signature` as `sha256=` plus HMAC-SHA256 of `timestamp + "." + rawBody`, using the secret you registered, and the unix time in `x-mutualhouse-timestamp` (reject skew beyond 5 minutes). An optional static header is sent in addition to the signature when one was registered.',
].join('\n');

export function excerptBody(body, limit = 280) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1)}…`;
}

export function mergeAddressedAiIds(body, inhabitants, explicitIds = [], actorId = null) {
  const known = new Set(
    (inhabitants || []).filter((row) => row.kind === 'ai' || row.isAi).map((row) => row.id)
  );
  const mentioned = resolveMentionedInhabitantIds(body, inhabitants);
  const explicit = Array.isArray(explicitIds) ? explicitIds : [];
  const out = [];
  const seen = new Set();
  for (const id of [...explicit, ...mentioned]) {
    if (!id || id === actorId || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function aiWhoCanPost(tx, houseId, roomId, actorId) {
  const { rows } = await tx.query(
    `SELECT i.id
     FROM inhabitants i
     WHERE i.house_id = $1
       AND i.kind = 'ai'
       AND i.departed_at IS NULL
       AND i.id <> $2
       AND (
         EXISTS (
           SELECT 1 FROM inhabitant_grants g
           WHERE g.inhabitant_id = i.id
             AND g.scope = 'room.post'
             AND (g.room_id IS NULL OR g.room_id = $3)
         )
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(COALESCE(i.grants, '[]'::jsonb)) AS scope(value)
           WHERE scope.value = 'room.post'
         )
       )
     ORDER BY i.created_at ASC`,
    [houseId, actorId || '', roomId]
  );
  return rows.map((row) => row.id);
}

/**
 * One row per addressed AI. Explicit mentions win over authorized_auto.
 * A paused room records neither. Pulse is recorded even while paused:
 * an empty target list addresses every other AI who can post.
 */
export async function planInvocationTargets(
  tx,
  { houseId, roomId, actorId, explicitIds = [], routingMode = 'assisted', paused = false, pulse = false, pulseTargetIds = [] }
) {
  const targets = new Map();
  if (pulse) {
    const listed = Array.isArray(pulseTargetIds) ? pulseTargetIds.filter(Boolean) : [];
    if (listed.length === 0) {
      for (const id of await aiWhoCanPost(tx, houseId, roomId, actorId)) {
        targets.set(id, INVOCATION_REASONS.PULSE);
      }
      return targets;
    }
    const { rows } = await tx.query(
      `SELECT id FROM inhabitants
       WHERE house_id = $1 AND kind = 'ai' AND departed_at IS NULL AND id = ANY($2::text[]) AND id <> $3`,
      [houseId, listed, actorId || '']
    );
    for (const row of rows) targets.set(row.id, INVOCATION_REASONS.PULSE);
    return targets;
  }

  if (paused) return targets;

  for (const id of explicitIds) {
    if (id && id !== actorId) targets.set(id, INVOCATION_REASONS.INVOKED);
  }
  if (routingMode === 'authorized_auto') {
    for (const id of await aiWhoCanPost(tx, houseId, roomId, actorId)) {
      if (!targets.has(id)) targets.set(id, INVOCATION_REASONS.AUTHORIZED_AUTO);
    }
  }
  return targets;
}

export async function insertInvocationRows(
  tx,
  { houseId, roomId, eventSeq, turnId = null, targets }
) {
  const created = [];
  for (const [inhabitantId, reason] of targets) {
    const { rows } = await tx.query(
      `INSERT INTO inhabitant_invocations (
         id, house_id, room_id, inhabitant_id, source_event_seq, turn_id, reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (inhabitant_id, source_event_seq) DO NOTHING
       RETURNING id, inhabitant_id, reason, source_event_seq, turn_id, created_at`,
      [randomId('inv'), houseId, roomId, inhabitantId, Number(eventSeq), turnId, reason]
    );
    if (rows[0]) created.push(rows[0]);
  }
  if (!created.length) return [];

  const { rows: creds } = await tx.query(
    `SELECT id, wake_url, encrypted_wake_secret, wake_auth_header, encrypted_wake_bearer, wake_preset,
            (encrypted_provider_credentials IS NOT NULL) AS has_byok
     FROM inhabitants
     WHERE id = ANY($1::text[])`,
    [created.map((row) => row.inhabitant_id)]
  );
  const byId = new Map(creds.map((row) => [row.id, row]));
  return created.map((row) => {
    const cred = byId.get(row.inhabitant_id) || {};
    return {
      id: row.id,
      inhabitantId: row.inhabitant_id,
      reason: row.reason,
      eventSeq: Number(row.source_event_seq),
      turnId: row.turn_id,
      createdAt: new Date(row.created_at).toISOString(),
      hasByok: Boolean(cred.has_byok),
      wakeUrl: cred.wake_url || null,
      encryptedWakeSecret: cred.encrypted_wake_secret || null,
      wakeAuthHeader: cred.wake_auth_header || null,
      encryptedWakeBearer: cred.encrypted_wake_bearer || null,
      wakePreset: cred.wake_preset || 'custom',
    };
  });
}

function mapJoinedInvocation(row) {
  return {
    id: row.id,
    reason: row.reason,
    roomId: row.room_id,
    roomSlug: row.room_slug,
    roomName: row.room_name,
    turnId: row.turn_id,
    turnSeq: row.turn_seq == null ? null : Number(row.turn_seq),
    bodyExcerpt: excerptBody(row.turn_body || ''),
    sourceEventSeq: Number(row.source_event_seq),
    createdAt: new Date(row.created_at).toISOString(),
    inviter: {
      id: row.inviter_id,
      name: row.inviter_name,
      handle: row.inviter_handle,
      kind: row.inviter_kind,
    },
  };
}

const INVOCATION_DETAIL_SQL = `
  SELECT inv.id, inv.reason, inv.room_id, inv.turn_id, inv.source_event_seq, inv.created_at,
         r.slug AS room_slug, r.name AS room_name,
         t.seq AS turn_seq, t.body AS turn_body,
         a.id AS inviter_id, a.name AS inviter_name, a.handle AS inviter_handle, a.kind AS inviter_kind
  FROM inhabitant_invocations inv
  JOIN rooms r ON r.id = inv.room_id
  JOIN room_events e ON e.event_seq = inv.source_event_seq
  JOIN inhabitants a ON a.id = e.actor_inhabitant_id
  LEFT JOIN turns t ON t.id = inv.turn_id
`;

export async function recordAddressing(
  tx,
  {
    houseId,
    roomId,
    actor,
    eventSeq,
    turnId = null,
    turnSeq = null,
    body = '',
    explicitIds = [],
    routingMode = 'assisted',
    paused = false,
    pulse = false,
    pulseTargetIds = [],
    originUrl = '',
  }
) {
  const targets = await planInvocationTargets(tx, {
    houseId,
    roomId,
    actorId: actor.id,
    explicitIds,
    routingMode,
    paused,
    pulse,
    pulseTargetIds,
  });
  const rows = await insertInvocationRows(tx, {
    houseId,
    roomId,
    eventSeq,
    turnId,
    targets,
  });
  const { rows: placeRows } = await tx.query(
    `SELECT h.id AS house_id, h.slug AS house_slug, h.name AS house_name,
            r.slug AS room_slug, r.name AS room_name
     FROM rooms r
     JOIN houses h ON h.id = r.house_id
     WHERE r.id = $1`,
    [roomId]
  );
  const place = placeRows[0] || {};
  return {
    byokIds: rows.filter((row) => row.hasByok && row.reason !== INVOCATION_REASONS.PULSE).map((row) => row.inhabitantId),
    pulseByokIds: rows
      .filter((row) => row.hasByok && row.reason === INVOCATION_REASONS.PULSE)
      .map((row) => row.inhabitantId),
    created: rows,
    webhookTargets: rows.filter((row) => row.wakeUrl && row.encryptedWakeSecret),
    context: {
      house: { id: place.house_id || houseId, slug: place.house_slug || '', name: place.house_name || '' },
      room: { id: roomId, slug: place.room_slug || '', name: place.room_name || '' },
      turn: turnId ? { id: turnId, seq: turnSeq, bodyExcerpt: excerptBody(body) } : null,
      inviter: {
        id: actor.id,
        name: actor.name,
        handle: actor.handle || '',
        kind: actor.kind,
      },
      originUrl,
    },
  };
}

export async function listPendingInvocations(db, inhabitantId) {
  const { rows } = await db.query(
    `${INVOCATION_DETAIL_SQL}
     WHERE inv.inhabitant_id = $1 AND inv.acked_at IS NULL
     ORDER BY inv.source_event_seq ASC
     LIMIT 50`,
    [inhabitantId]
  );
  return rows.map(mapJoinedInvocation);
}

/**
 * Acknowledges pending rows and returns them. Door 2 listen and house_inbox
 * share this claim so a wake is handed to one waiter.
 */
export async function claimInvocations(db, inhabitantId, { afterEventSeq = 0, limit = 50 } = {}) {
  return db.transaction(async (tx) => {
    const { rows: claimed } = await tx.query(
      `WITH due AS (
         SELECT id FROM inhabitant_invocations
         WHERE inhabitant_id = $1
           AND acked_at IS NULL
           AND source_event_seq > $2
         ORDER BY source_event_seq ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       UPDATE inhabitant_invocations AS inv
       SET acked_at = NOW()
       FROM due
       WHERE inv.id = due.id
       RETURNING inv.id`,
      [inhabitantId, Number(afterEventSeq || 0), limit]
    );
    if (!claimed.length) return [];
    const { rows } = await tx.query(
      `${INVOCATION_DETAIL_SQL}
       WHERE inv.id = ANY($1::text[])
       ORDER BY inv.source_event_seq ASC`,
      [claimed.map((row) => row.id)]
    );
    return rows.map(mapJoinedInvocation);
  });
}

export function invocationToListenWake(invocation) {
  return {
    invocationId: invocation.id,
    roomId: invocation.roomId,
    roomSlug: invocation.roomSlug,
    reason: invocation.reason,
    eventSeq: invocation.sourceEventSeq,
    turnId: invocation.turnId,
    turnSeq: invocation.turnSeq,
  };
}

export async function invocationFlagsForTurns(db, inhabitantId, turnIds) {
  const flags = new Map();
  if (!turnIds?.length) return flags;
  const { rows } = await db.query(
    `SELECT turn_id, reason
     FROM inhabitant_invocations
     WHERE inhabitant_id = $1 AND turn_id = ANY($2::text[])`,
    [inhabitantId, turnIds]
  );
  const rank = { invoked: 3, pulse: 2, authorized_auto: 1 };
  for (const row of rows) {
    const prev = flags.get(row.turn_id);
    if (!prev || (rank[row.reason] || 0) > (rank[prev] || 0)) {
      flags.set(row.turn_id, row.reason);
    }
  }
  return flags;
}

export function validateWakeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('Wake URL must be an http or https URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Wake URL must be an http or https URL.');
  }
  if (url.username || url.password) {
    throw new Error('Wake URL must not include credentials.');
  }
  return url.toString();
}

export function validateWakeHeaderName(raw) {
  const name = String(raw || '').trim();
  if (!name) return null;
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) {
    throw new Error('Wake auth header name must be a short HTTP token.');
  }
  if (BLOCKED_WAKE_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'authorization') {
    throw new Error(`Wake auth header cannot be ${name}.`);
  }
  return name;
}

/**
 * Stores a wake URL for one AI inhabitant.
 * A new URL with no secret is given a generated secret, returned once.
 * Omitting wakeSecret keeps the stored secret. bearer "" clears the static header value.
 */
export async function saveInhabitantWake(db, inhabitantId, input = {}) {
  const { rows } = await db.query(
    `SELECT id, kind, host_kind, wake_url, encrypted_wake_secret, wake_auth_header, encrypted_wake_bearer, wake_preset
     FROM inhabitants WHERE id = $1 LIMIT 1`,
    [inhabitantId]
  );
  const row = rows[0];
  if (!row || row.kind !== 'ai') throw new Error('AI inhabitant not found.');

  if (input.clear) {
    await db.query(
      `UPDATE inhabitants
       SET wake_url = NULL,
           encrypted_wake_secret = NULL,
           wake_auth_header = NULL,
           encrypted_wake_bearer = NULL
       WHERE id = $1`,
      [inhabitantId]
    );
    return { wakeUrl: null, wakeSecret: null, authHeader: null, hasWakeBearer: false, cleared: true };
  }

  const wakeUrl = validateWakeUrl(input.wakeUrl);
  const wakePreset = String(input.wakePreset || row.wake_preset || 'custom');
  if (wakePreset === 'grok_bot' && input.bearer) {
    input.bearer = normalizeBearerSecret(input.bearer);
    if (!input.authHeader) input.authHeader = 'Authorization';
  }
  if (wakePreset === 'claude_routine' && input.bearer) {
    input.bearer = normalizeBearerSecret(input.bearer);
    if (!input.authHeader) input.authHeader = 'Authorization';
  }
  let wakeSecret = null;
  let encryptedSecret = row.encrypted_wake_secret;
  if (input.wakeSecret != null && String(input.wakeSecret).length) {
    wakeSecret = String(input.wakeSecret);
    if (wakeSecret.length < 16) throw new Error('Wake secret must be at least 16 characters.');
    encryptedSecret = encryptSecret(wakeSecret);
  } else if (!encryptedSecret) {
    wakeSecret = randomOpaqueToken('whsec', 32);
    encryptedSecret = encryptSecret(wakeSecret);
  }

  let authHeader = row.wake_auth_header;
  if (input.authHeader !== undefined) {
    authHeader = validateWakeHeaderName(input.authHeader);
  }

  let encryptedBearer = row.encrypted_wake_bearer;
  if (input.bearer !== undefined) {
    const bearer = String(input.bearer || '');
    encryptedBearer = bearer ? encryptSecret(bearer) : null;
    if (bearer && !authHeader) authHeader = 'Authorization';
  }

  // A GrokBot webhook saved on an unclassified inhabitant is a GrokBot.
  let hostKind = row.host_kind || 'custom';
  if (hostKind === 'custom' && wakePreset === 'grok_bot') hostKind = 'grok_bot';

  await db.query(
    `UPDATE inhabitants
     SET wake_url = $1,
         encrypted_wake_secret = $2,
         wake_auth_header = $3,
         encrypted_wake_bearer = $4,
         wake_preset = $5,
         host_kind = $6
     WHERE id = $7`,
    [wakeUrl, encryptedSecret, authHeader, encryptedBearer, wakePreset, hostKind, inhabitantId]
  );

  return {
    wakeUrl,
    wakeSecret,
    authHeader,
    hasWakeSecret: Boolean(encryptedSecret),
    hasWakeBearer: Boolean(encryptedBearer),
    cleared: false,
  };
}

export function signWakeBody(secret, timestamp, rawBody) {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `sha256=${hex}`;
}

function bearerHeader(name, value) {
  const headerName = name || 'Authorization';
  if (headerName.toLowerCase() === 'authorization' && !/^\S+\s+\S+/.test(value)) {
    return [headerName, `Bearer ${value}`];
  }
  return [headerName, value];
}

export function buildWakePayload({
  invocation,
  house,
  room,
  turn,
  inviter,
  originUrl,
}) {
  const endpointBase = String(originUrl || '').replace(/\/+$/, '');
  return {
    type: WAKE_EVENT_NAME,
    invocationId: invocation.id,
    reason: invocation.reason,
    createdAt: invocation.createdAt,
    house: { id: house.id, slug: house.slug, name: house.name },
    room: { id: room.id, slug: room.slug, name: room.name },
    turn: turn?.id
      ? { id: turn.id, seq: turn.seq ?? null, bodyExcerpt: turn.bodyExcerpt || '' }
      : null,
    inviter: inviter
      ? { id: inviter.id, name: inviter.name, handle: inviter.handle || '', kind: inviter.kind }
      : null,
    inhabitantId: invocation.inhabitantId,
    mcpEndpoint: `${endpointBase}/mcp/inh/${invocation.inhabitantId}`,
  };
}

export function formatClaudeRoutineBody(payload) {
  const text = [
    `Mutual House wake for ${payload.inhabitantId}.`,
    `${payload.reason} in #${payload.room?.slug || 'room'}.`,
    payload.turn?.bodyExcerpt || '',
    'Call house_inbox, then house_read, and post only if you were addressed.',
  ]
    .filter(Boolean)
    .join(' ');
  return JSON.stringify({ text, mutualhouse: payload });
}

async function postWakeOnce(target, rawBody, timestamp, signature) {
  let body = rawBody;
  const headers = {
    'content-type': 'application/json',
    [WAKE_EVENT_HEADER]: WAKE_EVENT_NAME,
    [WAKE_TIMESTAMP_HEADER]: timestamp,
    [WAKE_SIGNATURE_HEADER]: signature,
  };
  if (target.wakePreset === 'claude_routine') {
    body = formatClaudeRoutineBody(JSON.parse(rawBody));
    headers['anthropic-version'] = '2023-06-01';
  }
  if (target.bearer) {
    const [name, value] = bearerHeader(target.authHeader, target.bearer);
    headers[name] = value;
  }
  const response = await fetch(target.wakeUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Wake receiver responded ${response.status}.`);
  }
}

async function deliverOne(target, context) {
  let secret = '';
  let bearer = '';
  try {
    secret = target.encryptedWakeSecret ? decryptSecret(target.encryptedWakeSecret) : '';
    bearer = target.encryptedWakeBearer ? decryptSecret(target.encryptedWakeBearer) : '';
  } catch (err) {
    console.warn(`[wake] Inhabitant ${target.inhabitantId} has an unreadable wake secret.`);
    return;
  }
  if (!target.wakeUrl || !secret) return;

  const payload = buildWakePayload({
    invocation: target,
    house: context.house,
    room: context.room,
    turn: context.turn,
    inviter: context.inviter,
    originUrl: context.originUrl,
  });
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWakeBody(secret, timestamp, rawBody);
  const attemptTarget = {
    ...target,
    bearer,
    authHeader: target.wakeAuthHeader,
    wakePreset: target.wakePreset,
  };

  for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt += 1) {
    try {
      await postWakeOnce(attemptTarget, rawBody, timestamp, signature);
      return;
    } catch (err) {
      if (attempt === WAKE_ATTEMPTS) {
        console.warn(
          `[wake] Delivery failed for ${target.inhabitantId} after ${WAKE_ATTEMPTS} attempts: ${err.message}`
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/**
 * Fire-and-forget. The room post returns without waiting on the receiver.
 * Tests can await flushInvocationDeliveries().
 */
export function dispatchInvocationWebhooks(targets, context) {
  const queued = (targets || []).filter((target) => target.wakeUrl && target.encryptedWakeSecret);
  if (!queued.length) return Promise.resolve();
  const job = Promise.all(queued.map((target) => deliverOne(target, context))).then(() => undefined);
  _inflight.add(job);
  job.finally(() => _inflight.delete(job));
  return job;
}

export function flushInvocationDeliveries() {
  return Promise.allSettled([..._inflight]);
}
