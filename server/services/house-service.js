import {
  House,
  INHABITANT_GRANTS,
  HUMAN_STEWARD_DEFAULT_GRANTS,
  AI_DEFAULT_GRANTS,
  canInviteAi,
  grantsForParticipation,
  defaultProviderDisclosure,
} from '../../shared/models/index.js';
import { defaultDoorTypeForHost, defaultWakePresetForHost, isHostKind, providerForHost } from '../../shared/lib/ai-hosts.js';
import { slugify } from '../../shared/lib/model-util.js';
import { generateHouseEd25519KeyPair, randomId, sha256HexNode } from './crypto.js';
import {
  mapConstitutionRow,
  mapEpisodeRow,
  mapSummaryRow,
} from './memory-service.js';
import {
  mapAttachmentRow,
  mapCallRow,
  mintSignedReadUrl,
} from './media-and-calls.js';

export function mapInhabitantRow(row, activeKeyPrefixes = [], roomGrantsMap = {}) {
  return {
    id: row.id,
    houseId: row.house_id,
    kind: row.kind,
    userId: row.user_id ?? null,
    stewardInhabitantId: row.steward_inhabitant_id ?? null,
    name: row.name,
    handle: row.handle,
    roleLabel: row.role_label || '',
    signatureNotes: row.signature_notes || '',
    isFounder: Boolean(row.is_founder),
    arrivalNumber: row.arrival_number ?? 1,
    provider: row.provider || (row.kind === 'ai' ? 'custom' : 'human'),
    providerDisclosure: row.provider_disclosure || '',
    modelSlug: row.model_slug ?? null,
    doorType: row.door_type || (row.kind === 'ai' ? 'human_prompt' : 'web'),
    handoffNote: row.handoff_note || '',
    hasByokCredentials: Boolean(row.encrypted_provider_credentials),
    hasWakeUrl: Boolean(row.wake_url),
    wakeUrl: row.wake_url || null,
    hasWakeSecret: Boolean(row.encrypted_wake_secret),
    wakeAuthHeader: row.wake_auth_header || null,
    hasWakeBearer: Boolean(row.encrypted_wake_bearer),
    mcpEndpointPath: row.kind === 'ai' ? `/mcp/inh/${row.id}` : null,
    activeKeyPrefixes,
    grants: Array.isArray(row.grants) ? row.grants : [],
    roomGrants: roomGrantsMap,
    presence: computePresence(row),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    hasOAuthConnection: Boolean(row.has_oauth_connection),
    departedAt: row.departed_at ? new Date(row.departed_at).toISOString() : null,
    hostKind: row.host_kind || (row.kind === 'ai' ? 'custom' : null),
    wakePreset: row.wake_preset || 'custom',
    participationMode: row.participation_mode === 'readonly' ? 'readonly' : 'contribute',
    participationLocked: Boolean(row.participation_locked),
    bio: row.bio || '',
    hobbies: Array.isArray(row.hobbies) ? row.hobbies : [],
    avatarUrl: row.avatar_url || null,
    gravatarHash: row.gravatar_hash || null,
    useGravatar: row.use_gravatar !== false,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const AI_DOOR_TYPES = new Set(['human_prompt', 'agent_loop', 'manual_packet', 'byok_hosted']);

function computePresence(row) {
  if (row.presence === 'participating') {
    const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - seen <= 90_000) return 'participating';
  }
  if (row.presence === 'connected') {
    const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - seen <= 90_000) return 'connected';
  }
  return 'invocable';
}

export function mapSealRow(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    promptTurnId: row.prompt_turn_id ?? null,
    mode: row.mode,
    status: row.status,
    targetInhabitantIds: row.target_inhabitant_ids ?? [],
    respondedInhabitantIds: row.responded_inhabitant_ids ?? [],
    openedByInhabitantId: row.opened_by_inhabitant_id,
    releasedByInhabitantId: row.released_by_inhabitant_id ?? null,
    openedAt: new Date(row.opened_at).toISOString(),
    releasedAt: row.released_at ? new Date(row.released_at).toISOString() : null,
  };
}

export function mapReceiptRow(row) {
  return {
    id: row.id,
    houseId: row.house_id,
    roomId: row.room_id,
    inhabitantId: row.inhabitant_id,
    doorType: row.door_type,
    turnIds: row.turn_ids ?? [],
    turnDigests: row.turn_digests ?? [],
    memoryVersion: row.memory_version ?? 0,
    constitutionVersion: row.constitution_version ?? 0,
    excludedSealIds: row.excluded_seal_ids ?? [],
    contextSha256: row.context_sha256,
    packetSignature: row.packet_signature ?? null,
    providerDisclosure: row.provider_disclosure ?? '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function mapTurnRow(row, attachments = []) {
  return {
    id: row.id,
    seq: row.seq,
    roomId: row.room_id,
    houseId: row.house_id,
    commandId: row.command_id,
    authorId: row.author_id,
    replyToId: row.reply_to_id ?? null,
    origin: row.origin,
    contributionKind: row.contribution_kind,
    body: row.body,
    bodySha256: row.body_sha256,
    sealedStub: false,
    sealId: row.seal_id ?? null,
    invokedInhabitantIds: row.invoked_inhabitant_ids ?? [],
    memoryVersion: row.memory_version ?? 0,
    readReceiptId: row.read_receipt_id ?? null,
    packetDrift: Boolean(row.packet_drift),
    transcriptOfTurnId: row.transcript_of_turn_id ?? null,
    attachments,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Hydrates a complete `House` isomorphic domain model from Postgres, filtered
 * strictly for `viewerInhabitantId` so sealed turns are masked before crossing
 * the wire (`House.create(def)`).
 */
export async function hydrateHouseForViewer(
  db,
  { houseIdOrSlug, viewerInhabitantId = null, viewerUserId = null, originUrl = '' }
) {
  const { rows: houseRows } = await db.query(
    `SELECT * FROM houses WHERE id = $1 OR slug = $1 LIMIT 1`,
    [houseIdOrSlug]
  );
  const houseRow = houseRows[0];
  if (!houseRow) return null;

  const [
    inhRes,
    keyRes,
    grantRes,
    roomRes,
    sealRes,
    turnRes,
    attRes,
    recRes,
    epRes,
    sumRes,
    constRes,
    callRes,
    cursorRes,
    oauthRes,
    userRes,
  ] = await Promise.all([
    db.query(`SELECT * FROM inhabitants WHERE house_id = $1 ORDER BY created_at ASC`, [houseRow.id]),
    db.query(
      `SELECT inhabitant_id, key_prefix FROM inhabitant_api_keys WHERE house_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC`,
      [houseRow.id]
    ),
    db.query(`SELECT * FROM inhabitant_grants WHERE house_id = $1`, [houseRow.id]),
    db.query(`SELECT * FROM rooms WHERE house_id = $1 AND archived_at IS NULL ORDER BY created_at ASC`, [
      houseRow.id,
    ]),
    db.query(`SELECT * FROM seals WHERE house_id = $1 ORDER BY opened_at ASC`, [houseRow.id]),
    db.query(`SELECT * FROM turns WHERE house_id = $1 ORDER BY seq ASC`, [houseRow.id]),
    db.query(
      `SELECT * FROM attachments WHERE house_id = $1 AND status = 'committed' ORDER BY created_at ASC`,
      [houseRow.id]
    ),
    db.query(`SELECT * FROM read_receipts WHERE house_id = $1 ORDER BY created_at ASC`, [houseRow.id]),
    db.query(`SELECT * FROM memory_episodes WHERE house_id = $1 ORDER BY episode_date DESC, created_at DESC`, [
      houseRow.id,
    ]),
    db.query(`SELECT * FROM living_summaries WHERE house_id = $1 ORDER BY version DESC`, [houseRow.id]),
    db.query(`SELECT * FROM constitutions WHERE house_id = $1 ORDER BY version DESC`, [houseRow.id]),
    db.query(
      `SELECT * FROM room_call_sessions WHERE house_id = $1 AND status IN ('ringing', 'active')`,
      [houseRow.id]
    ),
    db.query(
      `SELECT room_id, MAX(event_seq) AS max_seq FROM room_events WHERE house_id = $1 GROUP BY room_id`,
      [houseRow.id]
    ),
    db.query(
      `SELECT DISTINCT t.inhabitant_id
       FROM oauth_tokens t
       JOIN inhabitants i ON i.id = t.inhabitant_id
       WHERE i.house_id = $1 AND t.revoked_at IS NULL`,
      [houseRow.id]
    ),
    db.query(
      `SELECT i.id AS inhabitant_id, u.email
       FROM inhabitants i
       JOIN mh_users u ON u.id = i.user_id
       WHERE i.house_id = $1 AND i.kind = 'human' AND i.use_gravatar IS NOT FALSE`,
      [houseRow.id]
    ),
  ]);

  const oauthIds = new Set(oauthRes.rows.map((row) => row.inhabitant_id));
  const gravatarById = new Map(
    userRes.rows.map((row) => [row.inhabitant_id, sha256HexNode(String(row.email || '').trim().toLowerCase())])
  );

  const prefixesByInh = {};
  for (const k of keyRes.rows) {
    if (!prefixesByInh[k.inhabitant_id]) prefixesByInh[k.inhabitant_id] = [];
    prefixesByInh[k.inhabitant_id].push(k.key_prefix);
  }

  const roomGrantsByInh = {};
  for (const g of grantRes.rows) {
    if (!g.room_id) continue;
    if (!roomGrantsByInh[g.inhabitant_id]) roomGrantsByInh[g.inhabitant_id] = {};
    if (!roomGrantsByInh[g.inhabitant_id][g.room_id]) {
      roomGrantsByInh[g.inhabitant_id][g.room_id] = [];
    }
    roomGrantsByInh[g.inhabitant_id][g.room_id].push(g.scope);
  }

  const inhabitants = [];
  for (const r of inhRes.rows) {
    let avatarUrl = null;
    if (r.avatar_r2_key && originUrl) {
      avatarUrl = await mintSignedReadUrl(originUrl, { r2_key: r.avatar_r2_key, status: 'committed' });
    }
    inhabitants.push(
      mapInhabitantRow(
        {
          ...r,
          has_oauth_connection: oauthIds.has(r.id),
          avatar_url: avatarUrl,
          gravatar_hash: r.kind === 'human' && r.use_gravatar !== false ? gravatarById.get(r.id) || null : null,
        },
        prefixesByInh[r.id] || [],
        roomGrantsByInh[r.id] || {}
      )
    );
  }

  let resolvedViewerId = viewerInhabitantId;
  if (!resolvedViewerId && viewerUserId) {
    resolvedViewerId = inhabitants.find((i) => i.userId === viewerUserId)?.id ?? null;
  }

  const attByTurn = {};
  for (const a of attRes.rows) {
    if (!a.turn_id) continue;
    const signedUrl = originUrl ? await mintSignedReadUrl(originUrl, a) : null;
    if (!attByTurn[a.turn_id]) attByTurn[a.turn_id] = [];
    attByTurn[a.turn_id].push(mapAttachmentRow(a, signedUrl));
  }

  const maxEventByRoom = {};
  for (const c of cursorRes.rows) {
    maxEventByRoom[c.room_id] = Number(c.max_seq || 0);
  }

  const callByRoom = {};
  for (const cs of callRes.rows) {
    callByRoom[cs.room_id] = mapCallRow(cs);
  }

  const rawRooms = roomRes.rows.map((roomRow) => {
    const roomSeals = sealRes.rows.filter((s) => s.room_id === roomRow.id).map(mapSealRow);
    const roomReceipts = recRes.rows.filter((rc) => rc.room_id === roomRow.id).map(mapReceiptRow);
    const roomTurns = turnRes.rows
      .filter((t) => t.room_id === roomRow.id)
      .map((t) => mapTurnRow(t, attByTurn[t.id] || []));

    return {
      id: roomRow.id,
      houseId: roomRow.house_id,
      slug: roomRow.slug,
      name: roomRow.name,
      kind: roomRow.kind,
      purpose: roomRow.purpose || '',
      category: roomRow.category || '',
      ownerInhabitantId: roomRow.owner_inhabitant_id ?? null,
      routingMode: roomRow.routing_mode,
      paused: Boolean(roomRow.paused),
      autoTurnCap: roomRow.auto_turn_cap ?? 3,
      consecutiveAiTurns: roomRow.consecutive_ai_turns ?? 0,
      lastTurnSeq: roomRow.last_turn_seq ?? 0,
      eventCursor: maxEventByRoom[roomRow.id] ?? 0,
      createdAt: new Date(roomRow.created_at).toISOString(),
      seals: roomSeals,
      receipts: roomReceipts,
      turns: roomTurns,
      callSession: callByRoom[roomRow.id] ?? null,
    };
  });

  // Build full server-side House model first, then project each room strictly for `viewer`
  const fullHouse = House.create({
    id: houseRow.id,
    slug: houseRow.slug,
    name: houseRow.name,
    coordinates: houseRow.coordinates || '',
    purpose: houseRow.purpose || '',
    publicKeyEd25519: houseRow.public_key_ed25519,
    fourSections: houseRow.four_sections ?? {},
    createdAt: new Date(houseRow.created_at).toISOString(),
    updatedAt: new Date(houseRow.updated_at).toISOString(),
    viewerInhabitantId: resolvedViewerId,
    inhabitants,
    rooms: rawRooms,
    memory: {
      episodes: epRes.rows.map(mapEpisodeRow),
      summaries: sumRes.rows.map(mapSummaryRow),
    },
    constitutions: constRes.rows.map(mapConstitutionRow),
  });

  const viewer = fullHouse.viewer;
  if (!viewer) {
    return null; // Caller is not an inhabitant of this House
  }

  // Filter private rooms belonging to other inhabitants & mask sealed turns
  const projectedRooms = fullHouse.rooms
    .filter((r) => r.kind !== 'private' || r.ownerInhabitantId === viewer.id || viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE))
    .map((r) => {
      const visibleTurns = r.visibleTurnsFor(viewer).map((t) => t.toVisibleDef(viewer));
      return {
        ...r.def,
        turns: visibleTurns,
      };
    });

  const viewerSafeDef = {
    ...fullHouse.def,
    rooms: projectedRooms,
  };

  return {
    houseRow,
    fullHouse,
    viewer,
    viewerHouse: House.create(viewerSafeDef),
  };
}

/**
 * Self-service blank-by-default House creation (Brief v0.3 §2.2 & §6).
 */
export async function createBlankHouseInDb(
  db,
  { user, name, slug, coordinates = '', purpose = '' }
) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('House name is required.');
  const baseSlug = slugify(slug || cleanName);
  if (!baseSlug) throw new Error('A valid URL slug is required.');

  const { publicKeyEd25519, encryptedPrivateKeyEd25519 } = generateHouseEd25519KeyPair();
  const houseId = randomId('house');
  const founderInhId = randomId('inh');
  const commonRoomId = randomId('room');
  const founderHandle = slugify(user.name || user.email.split('@')[0] || 'founder') || 'founder';

  await db.transaction(async (tx) => {
    const { rows: dup } = await tx.query(`SELECT id FROM houses WHERE slug = $1`, [baseSlug]);
    if (dup.length > 0) {
      throw new Error(`House slug "${baseSlug}" is already taken.`);
    }

    await tx.query(
      `INSERT INTO houses (
        id, slug, name, coordinates, purpose, four_sections,
        public_key_ed25519, encrypted_private_key_ed25519, created_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [
        houseId,
        baseSlug,
        cleanName,
        String(coordinates || '').trim(),
        String(purpose || '').trim(),
        JSON.stringify({
          authorship: '',
          provenance: '',
          categories: [],
          housekeepingNotes: '',
        }),
        publicKeyEd25519,
        encryptedPrivateKeyEd25519,
        user.id,
      ]
    );

    await tx.query(
      `INSERT INTO inhabitants (
        id, house_id, kind, user_id, name, handle, role_label,
        is_founder, provider, door_type, grants, presence, last_seen_at
      ) VALUES ($1,$2,'human',$3,$4,$5,'Steward',TRUE,'human','web',$6::jsonb,'participating',NOW())`,
      [
        founderInhId,
        houseId,
        user.id,
        user.name || user.email,
        founderHandle,
        JSON.stringify(HUMAN_STEWARD_DEFAULT_GRANTS),
      ]
    );

    await tx.query(
      `INSERT INTO rooms (
        id, house_id, slug, name, kind, purpose, routing_mode
      ) VALUES ($1,$2,'common-room','Common Room','common','Shared household dialogue space.','assisted')`,
      [commonRoomId, houseId]
    );
  });

  return houseId;
}

export async function createAiInhabitantInDb(
  db,
  {
    houseId,
    stewardInhabitant,
    house,
    name,
    handle,
    provider,
    hostKind,
    participationMode = 'contribute',
    arrivalNumber = 1,
    doorType,
    signatureNotes = '',
    modelSlug = null,
  }
) {
  if (!canInviteAi(stewardInhabitant, house || { inhabitants: [] })) {
    const err = new Error(
      stewardInhabitant.can(INHABITANT_GRANTS.AI_INVITE)
        ? 'Members may welcome one active AI inhabitant. A steward can welcome more.'
        : 'You do not have permission to welcome an AI inhabitant.'
    );
    err.status = 403;
    throw err;
  }
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('AI inhabitant name is required.');
  const resolvedHost = isHostKind(hostKind) ? hostKind : 'custom';
  const resolvedProvider = provider || providerForHost(resolvedHost);
  const resolvedDoor = doorType || defaultDoorTypeForHost(resolvedHost);
  const mode = participationMode === 'readonly' ? 'readonly' : 'contribute';
  const cleanHandle = slugify(handle || cleanName) || randomId('ai');
  const id = randomId('inh');
  const disclosure = defaultProviderDisclosure(resolvedProvider);
  const grants = grantsForParticipation(mode);

  const { rows } = await db.query(
    `INSERT INTO inhabitants (
      id, house_id, kind, steward_inhabitant_id, name, handle,
      role_label, signature_notes, arrival_number, provider,
      provider_disclosure, model_slug, door_type, grants, presence,
      host_kind, wake_preset, participation_mode
    ) VALUES ($1,$2,'ai',$3,$4,$5,'AI Inhabitant',$6,$7,$8,$9,$10,$11,$12::jsonb,'invocable',$13,$14,$15)
    RETURNING *`,
    [
      id,
      houseId,
      stewardInhabitant.id,
      cleanName,
      cleanHandle,
      String(signatureNotes || ''),
      Math.max(1, Number(arrivalNumber || 1)),
      String(resolvedProvider || 'custom'),
      disclosure,
      modelSlug || null,
      String(resolvedDoor || 'human_prompt'),
      JSON.stringify(grants),
      resolvedHost,
      defaultWakePresetForHost(resolvedHost),
      mode,
    ]
  );

  for (const scope of grants) {
    await db.query(
      `INSERT INTO inhabitant_grants (id, house_id, inhabitant_id, room_id, scope)
       VALUES ($1,$2,$3,NULL,$4)`,
      [randomId('gr'), houseId, id, scope]
    );
  }

  return mapInhabitantRow(rows[0], [], {});
}

export async function updateInhabitantInDb(db, { houseId, inhabitantId, body = {} }) {
  const { rows } = await db.query(
    `SELECT * FROM inhabitants WHERE id = $1 AND house_id = $2 LIMIT 1`,
    [inhabitantId, houseId]
  );
  const row = rows[0];
  if (!row) throw fail(404, 'Inhabitant not found.');
  if (row.departed_at) throw fail(409, 'This inhabitant has departed.');

  const aiOnlyFields = ['handle', 'provider', 'doorType', 'modelSlug', 'hostKind'];
  if (aiOnlyFields.some((key) => body[key] !== undefined) && row.kind !== 'ai') {
    throw fail(400, 'Only an AI inhabitant has a provider and a door.');
  }

  let name = row.name;
  let handle = row.handle;
  let provider = row.provider;
  let disclosure = row.provider_disclosure;
  let modelSlug = row.model_slug;
  let doorType = row.door_type;
  const arrivalNumber =
    body.arrivalNumber !== undefined
      ? Math.max(1, Number(body.arrivalNumber) || 1)
      : row.arrival_number;
  const handoffNote = body.handoffNote !== undefined ? String(body.handoffNote) : row.handoff_note;
  const signatureNotes =
    body.signatureNotes !== undefined ? String(body.signatureNotes) : row.signature_notes;

  if (body.name !== undefined) {
    name = String(body.name).trim();
    if (!name) throw fail(400, 'Name is required.');
  }
  if (body.handle !== undefined) {
    handle = slugify(body.handle);
    if (!handle) throw fail(400, 'Handle is required.');
    if (handle !== row.handle) {
      const { rows: clash } = await db.query(
        `SELECT id FROM inhabitants WHERE house_id = $1 AND handle = $2 AND id <> $3 LIMIT 1`,
        [houseId, handle, inhabitantId]
      );
      if (clash[0]) throw fail(409, 'That handle is already in this house.');
    }
  }
  if (body.provider !== undefined) {
    provider = String(body.provider).trim().toLowerCase();
    if (!provider) throw fail(400, 'Provider is required.');
    disclosure = defaultProviderDisclosure(provider);
  }
  if (body.doorType !== undefined) {
    if (!AI_DOOR_TYPES.has(body.doorType)) throw fail(400, 'Unknown door.');
    doorType = body.doorType;
  }
  if (body.modelSlug !== undefined) {
    const slug = String(body.modelSlug || '').trim();
    modelSlug = slug || null;
  }
  let hostKind = row.host_kind || 'custom';
  let wakePreset = row.wake_preset || 'custom';
  if (body.hostKind !== undefined && row.kind === 'ai') {
    if (!isHostKind(body.hostKind)) throw fail(400, 'Unknown host.');
    hostKind = body.hostKind;
    if (body.provider === undefined) {
      provider = providerForHost(hostKind);
      disclosure = defaultProviderDisclosure(provider);
    }
    if (body.wakePreset === undefined && !row.wake_url) {
      wakePreset = defaultWakePresetForHost(hostKind);
    }
  }
  const bio = body.bio !== undefined ? String(body.bio).slice(0, 2000) : row.bio || '';
  const hobbies =
    body.hobbies !== undefined
      ? (Array.isArray(body.hobbies) ? body.hobbies : String(body.hobbies).split(','))
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 12)
      : row.hobbies || [];
  const useGravatar = body.useGravatar !== undefined ? Boolean(body.useGravatar) : row.use_gravatar !== false;

  await db.query(
    `UPDATE inhabitants
     SET name = $1, handle = $2, arrival_number = $3, handoff_note = $4, signature_notes = $5,
         provider = $6, provider_disclosure = $7, model_slug = $8, door_type = $9,
         host_kind = $10, wake_preset = $11, bio = $12, hobbies = $13::jsonb, use_gravatar = $14
     WHERE id = $15`,
    [
      name,
      handle,
      arrivalNumber,
      handoffNote,
      signatureNotes,
      provider,
      disclosure,
      modelSlug,
      doorType,
      hostKind,
      wakePreset,
      bio,
      JSON.stringify(hobbies),
      useGravatar,
      inhabitantId,
    ]
  );
}

export async function setAiParticipationModeInDb(db, { houseId, inhabitantId, mode, locked }) {
  const next = mode === 'readonly' ? 'readonly' : 'contribute';
  const grants = grantsForParticipation(next);
  await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND house_id = $2 AND kind = 'ai' LIMIT 1`,
      [inhabitantId, houseId]
    );
    if (!rows[0]) throw fail(404, 'AI inhabitant not found.');
    if (rows[0].departed_at) throw fail(409, 'This inhabitant has departed.');
    await tx.query(
      `UPDATE inhabitants
       SET participation_mode = $1,
           participation_locked = COALESCE($2, participation_locked),
           grants = $3::jsonb
       WHERE id = $4`,
      [next, locked === undefined ? null : Boolean(locked), JSON.stringify(grants), inhabitantId]
    );
    await tx.query(`DELETE FROM inhabitant_grants WHERE inhabitant_id = $1 AND room_id IS NULL`, [
      inhabitantId,
    ]);
    for (const scope of grants) {
      await tx.query(
        `INSERT INTO inhabitant_grants (id, house_id, inhabitant_id, room_id, scope)
         VALUES ($1,$2,$3,NULL,$4)`,
        [randomId('gr'), houseId, inhabitantId, scope]
      );
    }
  });
  return { participationMode: next, grants };
}

export async function departAiInhabitantInDb(db, { houseId, inhabitantId, handoffNote }) {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND house_id = $2 AND kind = 'ai' LIMIT 1`,
      [inhabitantId, houseId]
    );
    const row = rows[0];
    if (!row) throw fail(404, 'AI inhabitant not found.');
    if (row.departed_at) throw fail(409, 'This inhabitant has already departed.');
    const note = handoffNote !== undefined ? String(handoffNote) : row.handoff_note;
    await tx.query(
      `UPDATE inhabitants
       SET departed_at = NOW(), handoff_note = $1, presence = 'invocable'
       WHERE id = $2`,
      [note, inhabitantId]
    );
    await tx.query(
      `UPDATE inhabitant_api_keys
       SET revoked_at = NOW()
       WHERE inhabitant_id = $1 AND revoked_at IS NULL`,
      [inhabitantId]
    );
    await tx.query(
      `UPDATE oauth_tokens
       SET revoked_at = NOW()
       WHERE inhabitant_id = $1 AND revoked_at IS NULL`,
      [inhabitantId]
    );
  });
}
