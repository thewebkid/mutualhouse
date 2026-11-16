import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { inferAttachmentKind } from '../../shared/models/turn.js';
import { hmacSha256Hex, randomId } from './crypto.js';
import { emitRoomWake } from './wake-bus.js';

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB cap in Phase 1a
const CALL_TTL_MS = 20_000; // 20s heartbeat staleness TTL

let _s3Client = null;

function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

function getR2Client() {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // Critical 2026 AWS SDK v3 setting: prevent default x-amz-checksum-* query headers
    // that browsers won't send on raw fetch PUT!
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _s3Client;
}

function sanitizeFileName(name = 'attachment') {
  return String(name)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'attachment';
}

export function buildLocalMediaSignature({ r2Key, method, byteLength = null, mimeType = null, expiresAt }) {
  return hmacSha256Hex(
    'mh-local-r2-v1',
    `${method}|${r2Key}|${byteLength ?? ''}|${mimeType ?? ''}|${expiresAt}`
  );
}

/**
 * Mints a short-lived (300s) presigned PUT URL locked to the exact `byteLength`
 * and `mimeType`, creating a `pending` attachment row in Postgres.
 */
export async function presignRoomMediaUpload(
  db,
  { originUrl, houseId, roomId, actor, fileName, mimeType, byteLength, durationMs = null }
) {
  const size = Number(byteLength);
  if (!Number.isFinite(size) || size < 1) {
    throw new Error('Attachment byteLength must be greater than 0.');
  }
  if (size > MAX_MEDIA_BYTES) {
    throw new Error(`Attachment exceeds the 25 MB limit (${size} bytes).`);
  }
  const cleanMime = String(mimeType || 'application/octet-stream').trim();
  const kind = inferAttachmentKind(cleanMime);
  const attachmentId = randomId('att');
  const safeName = sanitizeFileName(fileName);
  const r2Key = `houses/${houseId}/rooms/${roomId}/${attachmentId}-${safeName}`;

  await db.query(
    `INSERT INTO attachments (
      id, house_id, room_id, uploaded_by_inhabitant_id, kind, file_name,
      mime_type, byte_length, r2_key, duration_ms, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
    [
      attachmentId,
      houseId,
      roomId,
      actor.id,
      kind,
      safeName,
      cleanMime,
      size,
      r2Key,
      durationMs ? Math.round(Number(durationMs)) : null,
    ]
  );

  let uploadUrl;
  if (isR2Configured()) {
    const cmd = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: cleanMime,
      ContentLength: size,
    });
    uploadUrl = await getSignedUrl(getR2Client(), cmd, {
      expiresIn: 300,
      signableHeaders: new Set(['content-type']),
    });
  } else {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const sig = buildLocalMediaSignature({
      r2Key,
      method: 'PUT',
      byteLength: size,
      mimeType: cleanMime,
      expiresAt,
    });
    const params = new URLSearchParams({
      len: String(size),
      type: cleanMime,
      exp: String(expiresAt),
      sig,
    });
    uploadUrl = `${originUrl}/api/local-r2/${encodeURIComponent(r2Key)}?${params.toString()}`;
  }

  return {
    attachmentId,
    r2Key,
    uploadUrl,
    expiresIn: 300,
  };
}

export async function presignInhabitantAvatar(originUrl, { houseId, inhabitantId, mimeType, byteLength }) {
  const size = Number(byteLength);
  if (!Number.isFinite(size) || size < 1 || size > 2 * 1024 * 1024) {
    throw new Error('Avatar must be an image under 2 MB.');
  }
  const cleanMime = String(mimeType || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(cleanMime)) {
    throw new Error('Avatar must be jpeg, png, or webp.');
  }
  const r2Key = `houses/${houseId}/avatars/${inhabitantId}`;
  let uploadUrl;
  if (isR2Configured()) {
    const cmd = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: cleanMime,
      ContentLength: size,
    });
    uploadUrl = await getSignedUrl(getR2Client(), cmd, { expiresIn: 300, signableHeaders: new Set(['content-type']) });
  } else {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const sig = buildLocalMediaSignature({ r2Key, method: 'PUT', byteLength: size, mimeType: cleanMime, expiresAt });
    const params = new URLSearchParams({ len: String(size), type: cleanMime, exp: String(expiresAt), sig });
    uploadUrl = `${originUrl}/api/local-r2/${encodeURIComponent(r2Key)}?${params.toString()}`;
  }
  return { r2Key, uploadUrl, expiresIn: 300 };
}

export async function mintSignedReadUrl(originUrl, attachmentRow, ttlSec = 900) {
  if (!attachmentRow || attachmentRow.status === 'withdrawn') return null;
  if (isR2Configured()) {
    const cmd = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: attachmentRow.r2_key,
    });
    return getSignedUrl(getR2Client(), cmd, { expiresIn: ttlSec });
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = buildLocalMediaSignature({
    r2Key: attachmentRow.r2_key,
    method: 'GET',
    expiresAt,
  });
  return `${originUrl}/api/local-r2/${encodeURIComponent(attachmentRow.r2_key)}?exp=${expiresAt}&sig=${sig}`;
}

export async function commitRoomMediaUpload(db, { originUrl, roomId, attachmentId }) {
  const { rows } = await db.query(
    `SELECT * FROM attachments WHERE id = $1 AND room_id = $2`,
    [attachmentId, roomId]
  );
  const att = rows[0];
  if (!att) throw new Error('Pending attachment not found.');

  if (isR2Configured()) {
    const head = await getR2Client().send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: att.r2_key,
      })
    );
    if (Number(head.ContentLength) !== Number(att.byte_length)) {
      throw new Error('Uploaded object size did not match presigned ContentLength.');
    }
  } else {
    const filePath = getLocalR2Path(att.r2_key);
    if (!fs.existsSync(filePath)) {
      throw new Error('Media object was not uploaded before commit.');
    }
    const stat = fs.statSync(filePath);
    if (stat.size !== Number(att.byte_length)) {
      fs.unlinkSync(filePath);
      throw new Error('Uploaded object size did not match presigned ContentLength.');
    }
  }

  const { rows: updated } = await db.query(
    `UPDATE attachments SET status = 'committed' WHERE id = $1 RETURNING *`,
    [attachmentId]
  );
  const signedUrl = await mintSignedReadUrl(originUrl, updated[0]);
  return mapAttachmentRow(updated[0], signedUrl);
}

export function getLocalR2Path(r2Key) {
  const safeRel = String(r2Key).replace(/\.\./g, '_');
  return path.resolve(process.cwd(), '.data', 'r2-local', safeRel);
}

export async function readRawAttachmentBytes(r2Key) {
  if (isR2Configured()) {
    const res = await getR2Client().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: r2Key,
      })
    );
    const bytes = await res.Body.transformToByteArray();
    return Uint8Array.from(bytes);
  }
  const filePath = getLocalR2Path(r2Key);
  if (!fs.existsSync(filePath)) return null;
  return new Uint8Array(fs.readFileSync(filePath));
}

export function mapAttachmentRow(row, signedUrl = null) {
  return {
    id: row.id,
    turnId: row.turn_id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    sha256: row.sha256,
    r2Key: row.r2_key,
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    transcriptText: row.transcript_text,
    transcriptTurnId: row.transcript_turn_id,
    signedUrl,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// =============================================================================
// 2-OCCUPANT BROWSER-NATIVE ROOM CALLS (`RTCPeerConnection` + Cloudflare TURN)
// =============================================================================

export async function mintTurnIceServers() {
  const tokenId = process.env.CF_TURN_TOKEN_ID;
  const apiToken = process.env.CF_TURN_API_TOKEN;
  const fallback = [{ urls: 'stun:stun.cloudflare.com:3478' }];

  if (!tokenId || !apiToken) return fallback;

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(tokenId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ttl: 7200 }),
      }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const servers = Array.isArray(data.iceServers) ? data.iceServers : fallback;
    // Strip port 53 URLs (browsers block port 53 and stall non-trickle ICE gathering)
    return servers
      .map((srv) => {
        const urls = (Array.isArray(srv.urls) ? srv.urls : [srv.urls]).filter(
          (u) => typeof u === 'string' && !u.includes(':53')
        );
        return { ...srv, urls };
      })
      .filter((s) => s.urls.length > 0);
  } catch {
    return fallback;
  }
}

function pruneStaleCallParticipants(participants = [], nowMs = Date.now()) {
  return participants.filter((p) => {
    const beat = new Date(p.lastHeartbeatAt || p.joinedAt || 0).getTime();
    return nowMs - beat <= CALL_TTL_MS;
  });
}

export async function joinRoomCallInDb(
  db,
  { houseId, roomId, actor, audioEnabled = true, videoEnabled = true }
) {
  if (!actor.isHuman) {
    throw new Error('AI inhabitants cannot join live room audio/video calls.');
  }

  const nowIso = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT * FROM room_call_sessions
       WHERE room_id = $1 AND status IN ('ringing', 'active')
       LIMIT 1`,
      [roomId]
    );

    let session = rows[0];
    if (session) {
      const fresh = pruneStaleCallParticipants(session.participants);
      const others = fresh.filter((p) => p.inhabitantId !== actor.id);
      if (others.length >= 2) {
        throw new Error('This room already has 2 active call occupants.');
      }
      const updatedParticipants = [
        ...others,
        {
          inhabitantId: actor.id,
          joinedAt: nowIso,
          lastHeartbeatAt: nowIso,
          audioEnabled: Boolean(audioEnabled),
          videoEnabled: Boolean(videoEnabled),
          screenSharing: false,
        },
      ];
      const nextStatus = updatedParticipants.length >= 2 ? 'active' : 'ringing';
      const { rows: saved } = await tx.query(
        `UPDATE room_call_sessions
         SET participants = $1::jsonb, status = $2
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(updatedParticipants), nextStatus, session.id]
      );
      session = saved[0];
    } else {
      const participants = [
        {
          inhabitantId: actor.id,
          joinedAt: nowIso,
          lastHeartbeatAt: nowIso,
          audioEnabled: Boolean(audioEnabled),
          videoEnabled: Boolean(videoEnabled),
          screenSharing: false,
        },
      ];
      const { rows: created } = await tx.query(
        `INSERT INTO room_call_sessions (id, house_id, room_id, status, participants, signals)
         VALUES ($1,$2,$3,'ringing',$4::jsonb,'[]'::jsonb)
         RETURNING *`,
        [randomId('call'), houseId, roomId, JSON.stringify(participants)]
      );
      session = created[0];
    }

    await tx.query(
      `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
       VALUES ($1,$2,$3,$4,$5,'call.updated',$6::jsonb)`,
      [
        randomId('ev'),
        houseId,
        roomId,
        actor.id,
        randomId('cmd'),
        JSON.stringify({ callSession: mapCallRow(session) }),
      ]
    );
    return session;
  });

  emitRoomWake(roomId);
  const iceServers = await mintTurnIceServers();
  const peer = (result.participants || []).find((p) => p.inhabitantId !== actor.id) ?? null;
  const polite = peer ? String(actor.id) > String(peer.inhabitantId) : false;
  const signals = Array.isArray(result.signals) ? result.signals : [];

  return {
    session: mapCallRow(result),
    iceServers,
    polite,
    peerInhabitantId: peer?.inhabitantId ?? null,
    lastSignalSeq: signals.length ? signals[signals.length - 1].seq : 0,
  };
}

export async function appendCallSignalInDb(db, { roomId, actor, description }) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT * FROM room_call_sessions WHERE room_id = $1 AND status IN ('ringing', 'active') LIMIT 1`,
      [roomId]
    );
    const session = rows[0];
    if (!session) throw new Error('No active call session in this room.');
    const signals = Array.isArray(session.signals) ? [...session.signals] : [];
    const nextSeq = (signals[signals.length - 1]?.seq ?? 0) + 1;
    signals.push({
      seq: nextSeq,
      fromInhabitantId: actor.id,
      description,
      createdAt: new Date().toISOString(),
    });
    await tx.query(`UPDATE room_call_sessions SET signals = $1::jsonb WHERE id = $2`, [
      JSON.stringify(signals.slice(-30)),
      session.id,
    ]);
    return { seq: nextSeq };
  });
}

export async function pollCallStateInDb(db, { roomId, actor, afterSignalSeq = 0 }) {
  const { rows } = await db.query(
    `SELECT * FROM room_call_sessions WHERE room_id = $1 AND status IN ('ringing', 'active') LIMIT 1`,
    [roomId]
  );
  const session = rows[0];
  if (!session) {
    return { session: null, signals: [], polite: false, peerInhabitantId: null };
  }

  const fresh = pruneStaleCallParticipants(session.participants);
  if (fresh.length === 0) {
    await db.query(
      `UPDATE room_call_sessions SET status = 'ended', participants = '[]'::jsonb, ended_at = NOW() WHERE id = $1`,
      [session.id]
    );
    return { session: null, signals: [], polite: false, peerInhabitantId: null };
  }
  if (fresh.length !== session.participants.length) {
    await db.query(`UPDATE room_call_sessions SET participants = $1::jsonb WHERE id = $2`, [
      JSON.stringify(fresh),
      session.id,
    ]);
    session.participants = fresh;
  }

  const peer = fresh.find((p) => p.inhabitantId !== actor.id) ?? null;
  const polite = peer ? String(actor.id) > String(peer.inhabitantId) : false;
  const signals = (session.signals || []).filter(
    (s) => s.seq > Number(afterSignalSeq) && s.fromInhabitantId !== actor.id
  );

  return {
    session: mapCallRow(session),
    polite,
    peerInhabitantId: peer?.inhabitantId ?? null,
    signals,
  };
}

export async function heartbeatRoomCallInDb(
  db,
  { roomId, actor, audioEnabled = true, videoEnabled = true, screenSharing = false }
) {
  const { rows } = await db.query(
    `SELECT * FROM room_call_sessions WHERE room_id = $1 AND status IN ('ringing', 'active') LIMIT 1`,
    [roomId]
  );
  const session = rows[0];
  if (!session) return { ok: false };
  const fresh = pruneStaleCallParticipants(session.participants).map((p) =>
    p.inhabitantId === actor.id
      ? {
          ...p,
          lastHeartbeatAt: new Date().toISOString(),
          audioEnabled: Boolean(audioEnabled),
          videoEnabled: Boolean(videoEnabled),
          screenSharing: Boolean(screenSharing),
        }
      : p
  );
  await db.query(`UPDATE room_call_sessions SET participants = $1::jsonb WHERE id = $2`, [
    JSON.stringify(fresh),
    session.id,
  ]);
  return { ok: true };
}

export async function leaveRoomCallInDb(db, { houseId, roomId, actor }) {
  const updated = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT * FROM room_call_sessions WHERE room_id = $1 AND status IN ('ringing', 'active') LIMIT 1`,
      [roomId]
    );
    const session = rows[0];
    if (!session) return null;
    const remaining = pruneStaleCallParticipants(session.participants).filter(
      (p) => p.inhabitantId !== actor.id
    );
    const nextStatus = remaining.length === 0 ? 'ended' : 'ringing';
    const { rows: saved } = await tx.query(
      `UPDATE room_call_sessions
       SET participants = $1::jsonb,
           status = $2,
           ended_at = CASE WHEN $2 = 'ended' THEN NOW() ELSE ended_at END
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(remaining), nextStatus, session.id]
    );
    await tx.query(
      `INSERT INTO room_events (id, house_id, room_id, actor_inhabitant_id, command_id, type, payload)
       VALUES ($1,$2,$3,$4,$5,'call.updated',$6::jsonb)`,
      [
        randomId('ev'),
        houseId,
        roomId,
        actor.id,
        randomId('cmd'),
        JSON.stringify({ callSession: nextStatus === 'ended' ? null : mapCallRow(saved[0]) }),
      ]
    );
    return saved[0];
  });
  emitRoomWake(roomId);
  return { session: updated ? mapCallRow(updated) : null };
}

export function mapCallRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    roomId: row.room_id,
    status: row.status,
    participants: row.participants ?? [],
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  };
}
