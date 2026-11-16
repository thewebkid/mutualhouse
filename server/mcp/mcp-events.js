import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptSecret, encryptSecret, randomId } from '../services/crypto.js';

const EVENT_NAME = 'mutualhouse.invocation';

function isPublicHttps(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
  return true;
}

export function signStandardWebhook(secret, webhookId, timestamp, rawBody) {
  const key = String(secret || '').replace(/^whsec_/, '');
  const signed = `${webhookId}.${timestamp}.${rawBody}`;
  const digest = createHmac('sha256', Buffer.from(key, 'base64')).update(signed).digest('base64');
  return `v1,${digest}`;
}

export async function listMcpEvents() {
  return {
    events: [
      {
        name: EVENT_NAME,
        description: 'A room mention, authorized-auto wake, or tempo pulse for this inhabitant.',
        delivery: ['webhook'],
      },
    ],
  };
}

export async function subscribeMcpEvent(db, { houseId, inhabitantId, params }) {
  const name = params?.name || EVENT_NAME;
  if (name !== EVENT_NAME) throw new Error('Unknown event.');
  const url = params?.delivery?.url;
  const secret = params?.delivery?.secret;
  if (params?.delivery?.mode && params.delivery.mode !== 'webhook') throw new Error('Only webhook delivery is supported.');
  if (!isPublicHttps(url)) throw new Error('Callback URL must be public https.');
  if (!String(secret || '').startsWith('whsec_')) throw new Error('Signing secret must start with whsec_.');

  const challenge = randomId('ver');
  const verifyBody = JSON.stringify({ type: 'verification', challenge });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookId = `msg_${challenge}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signStandardWebhook(secret, webhookId, timestamp, verifyBody),
    },
    body: verifyBody,
    signal: AbortSignal.timeout(4000),
  });
  const echoed = await response.json().catch(() => ({}));
  if (!response.ok || (echoed.challenge && echoed.challenge !== challenge)) {
    throw new Error('Webhook verification failed.');
  }

  const id = randomId('sub');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    `INSERT INTO mcp_event_subscriptions (id, house_id, inhabitant_id, event_name, callback_url, encrypted_secret, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (inhabitant_id, event_name, callback_url)
     DO UPDATE SET encrypted_secret = EXCLUDED.encrypted_secret, expires_at = EXCLUDED.expires_at`,
    [id, houseId, inhabitantId, name, url, encryptSecret(secret), expiresAt]
  );
  return { id, refreshBefore: expiresAt, cursor: null };
}

export async function unsubscribeMcpEvent(db, { inhabitantId, params }) {
  await db.query(
    `DELETE FROM mcp_event_subscriptions WHERE inhabitant_id = $1 AND event_name = $2 AND callback_url = $3`,
    [inhabitantId, params?.name || EVENT_NAME, params?.delivery?.url || params?.url || '']
  );
  return {};
}

export async function dispatchMcpEventSubscriptions(db, targets, context) {
  const ids = (targets || []).map((target) => target.inhabitantId);
  if (!ids.length) return;
  const { rows } = await db.query(
    `SELECT * FROM mcp_event_subscriptions WHERE inhabitant_id = ANY($1::text[]) AND expires_at > NOW()`,
    [ids]
  );
  for (const row of rows) {
    const target = targets.find((item) => item.inhabitantId === row.inhabitant_id);
    if (!target) continue;
    const payload = {
      eventId: target.id,
      name: EVENT_NAME,
      data: {
        invocationId: target.id,
        reason: target.reason,
        room: context.room,
        turn: context.turn,
        inhabitantId: target.inhabitantId,
      },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    let secret = '';
    try {
      secret = decryptSecret(row.encrypted_secret);
    } catch {
      continue;
    }
    const response = await fetch(row.callback_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': payload.eventId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signStandardWebhook(secret, payload.eventId, timestamp, rawBody),
        'x-mcp-subscription-id': row.id,
      },
      body: rawBody,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (response?.status === 410) {
      await db.query(`DELETE FROM mcp_event_subscriptions WHERE id = $1`, [row.id]);
    }
  }
}

export function verifyStandardWebhook(secret, headers, rawBody) {
  const expected = signStandardWebhook(
    secret,
    headers.get('webhook-id'),
    headers.get('webhook-timestamp'),
    rawBody
  );
  const actual = headers.get('webhook-signature') || '';
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
