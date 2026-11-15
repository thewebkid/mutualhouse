import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { OAuthError } from '@modelcontextprotocol/server';
import {
  HUMAN_MEMBER_DEFAULT_GRANTS,
  INHABITANT_GRANTS,
} from '../shared/models/inhabitant.js';
import { slugify } from '../shared/lib/model-util.js';
import { getDb } from './db/index.js';
import {
  beginWebAuthnLogin,
  beginWebAuthnRegistration,
  consumeMagicLink,
  createAndSendMagicLink,
  destroyBrowserSession,
  finishWebAuthnLogin,
  finishWebAuthnRegistration,
  getSessionUser,
  sendHouseInviteEmailIfConfigured,
} from './auth/session-auth.js';
import {
  buildAuthServerMetadata,
  buildInhabitantProtectedResourceMetadata,
  buildInhabitantResourceUrl,
  exchangeOAuthToken,
  extractInhabitantIdFromResource,
  getOAuthJwksDocument,
  getOriginUrl,
  mintAuthorizationCode,
  mintInhabitantApiKeyInDb,
  registerDynamicOAuthClient,
  resolveOAuthClient,
  sanitizeRequestedMcpScopes,
  verifyDirectRunnerBearer,
} from './auth/mcp-oauth.js';
import {
  createAiInhabitantInDb,
  createBlankHouseInDb,
  hydrateHouseForViewer,
  mapInhabitantRow,
} from './services/house-service.js';
import {
  executeRoomCommand,
  queryVisibleRoomEvents,
} from './services/room-commands.js';
import {
  importSignedPacketReply,
  issueSignedManualPacket,
} from './services/packets.js';
import {
  confirmLivingSummaryInDb,
  createMemoryEpisodeInDb,
  proposeConstitutionInDb,
  proposeOrAmendLivingSummaryInDb,
  ratifyOrWitnessConstitutionInDb,
} from './services/memory-service.js';
import {
  appendCallSignalInDb,
  buildLocalMediaSignature,
  commitRoomMediaUpload,
  getLocalR2Path,
  heartbeatRoomCallInDb,
  joinRoomCallInDb,
  leaveRoomCallInDb,
  pollCallStateInDb,
  presignRoomMediaUpload,
} from './services/media-and-calls.js';
import { transcribeAudioAttachmentSibling } from './services/byok-runner.js';
import { buildHouseExportZipBytes } from './services/export-service.js';
import { handleInhabitantMcpRequest } from './mcp/house-mcp.js';
import {
  encryptSecret,
  randomId,
  randomOpaqueToken,
  sha256HexNode,
} from './services/crypto.js';
import { emitRoomWake, waitForWakeOrTimeout } from './services/wake-bus.js';

let _app = null;

export async function getApp() {
  if (_app) return _app;
  await getDb(); // Ensure initial Postgres / PGlite migrations have run
  _app = createServerApp();
  return _app;
}

export function createServerApp() {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof OAuthError) {
      return c.json({ error: err.errorCode, error_description: err.message }, 400);
    }
    const status = err.status || 400;
    return c.json({ error: err.message || 'Request failed.' }, status);
  });

  // ===========================================================================
  // 1. OAUTH 2.1 & RFC 8414 / RFC 9728 WELL-KNOWN DISCOVERY
  // ===========================================================================

  app.get('/.well-known/jwks.json', async (c) => {
    return c.json(await getOAuthJwksDocument());
  });

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const originUrl = getOriginUrl(c.req.url);
    return c.json(buildAuthServerMetadata(originUrl));
  });

  app.get('/.well-known/oauth-protected-resource/mcp/inh/:inhabitantId', async (c) => {
    const db = await getDb();
    const inhId = c.req.param('inhabitantId');
    const { rows } = await db.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND kind = 'ai' LIMIT 1`,
      [inhId]
    );
    if (!rows[0]) {
      return c.json({ error: 'Unknown AI inhabitant resource.' }, 404);
    }
    const originUrl = getOriginUrl(c.req.url);
    const doc = buildInhabitantProtectedResourceMetadata(originUrl, rows[0]);
    return c.json(doc);
  });

  // Explicitly refuse a bare root protected-resource metadata doc so lenient MCP
  // clients never request origin-wide tokens that collide across sibling AIs!
  app.get('/.well-known/oauth-protected-resource', (c) => {
    return c.json(
      {
        error: 'path_scoped_resource_required',
        message: 'Connect using the AI inhabitant’s path-scoped /mcp/inh/:inhabitantId URL.',
      },
      404
    );
  });

  app.get('/oauth2/authorize', (c) => {
    const u = new URL(c.req.url);
    return c.redirect(`/oauth/consent${u.search}`, 302);
  });

  app.post('/oauth2/register', async (c) => {
    const db = await getDb();
    const body = await c.req.json().catch(() => ({}));
    const reg = await registerDynamicOAuthClient(db, body);
    return c.json(reg, 201);
  });

  app.get('/api/oauth/authorize-details', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const originUrl = getOriginUrl(c.req.url);
    const clientId = c.req.query('client_id') || '';
    const resource = c.req.query('resource') || '';
    const rawScope = c.req.query('scope') || '';

    const inhId = extractInhabitantIdFromResource(resource);
    if (!inhId) {
      return c.json(
        { error: 'OAuth resource parameter must target /mcp/inh/:inhabitantId.' },
        400
      );
    }

    const { rows: inhRows } = await db.query(
      `SELECT i.*, h.name AS house_name, h.slug AS house_slug, h.coordinates AS house_coords
       FROM inhabitants i
       JOIN houses h ON h.id = i.house_id
       WHERE i.id = $1 AND i.kind = 'ai'
       LIMIT 1`,
      [inhId]
    );
    const inhRow = inhRows[0];
    if (!inhRow) return c.json({ error: 'AI inhabitant not found.' }, 404);

    // Ensure the signed-in human is a steward of this House
    const { rows: viewerRows } = await db.query(
      `SELECT * FROM inhabitants WHERE house_id = $1 AND user_id = $2 AND kind = 'human' LIMIT 1`,
      [inhRow.house_id, user.id]
    );
    if (!viewerRows[0]) {
      return c.json({ error: 'You are not a human inhabitant of this House.' }, 403);
    }

    const client = await resolveOAuthClient(db, clientId);
    const scopes = sanitizeRequestedMcpScopes(rawScope);
    const canonicalResource = buildInhabitantResourceUrl(originUrl, inhRow.id);

    return c.json({
      client,
      resource: canonicalResource,
      scopes,
      house: {
        id: inhRow.house_id,
        name: inhRow.house_name,
        slug: inhRow.house_slug,
        coordinates: inhRow.house_coords,
      },
      inhabitant: mapInhabitantRow(inhRow),
    });
  });

  app.post('/oauth2/authorize/decision', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const originUrl = getOriginUrl(c.req.url);
    const body = await c.req.json();
    const redirectUri = String(body.redirect_uri || '');
    if (!redirectUri) return c.json({ error: 'redirect_uri is required.' }, 400);

    const redirectTarget = new URL(redirectUri);
    if (body.state) redirectTarget.searchParams.set('state', String(body.state));

    if (body.decision !== 'approve') {
      redirectTarget.searchParams.set('error', 'access_denied');
      return c.json({ redirectUrl: redirectTarget.toString() });
    }

    const inhId = extractInhabitantIdFromResource(body.resource || '');
    if (!inhId) return c.json({ error: 'Invalid path-scoped resource.' }, 400);

    const { rows: inhRows } = await db.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND kind = 'ai' LIMIT 1`,
      [inhId]
    );
    const inhRow = inhRows[0];
    if (!inhRow) return c.json({ error: 'AI inhabitant not found.' }, 404);

    const { rows: viewerRows } = await db.query(
      `SELECT * FROM inhabitants WHERE house_id = $1 AND user_id = $2 AND kind = 'human' LIMIT 1`,
      [inhRow.house_id, user.id]
    );
    if (!viewerRows[0]) return c.json({ error: 'Forbidden.' }, 403);

    const client = await resolveOAuthClient(db, String(body.client_id || 'mcp-client'));
    if (client.redirectUris.length && !client.redirectUris.includes(redirectUri)) {
      return c.json({ error: 'redirect_uri is not registered for this client.' }, 400);
    }

    const scopes = sanitizeRequestedMcpScopes(body.scope || '');
    const canonicalResource = buildInhabitantResourceUrl(originUrl, inhRow.id);

    const code = await mintAuthorizationCode(db, {
      user,
      inhabitantId: inhRow.id,
      clientId: client.clientId,
      redirectUri,
      resource: canonicalResource,
      scopes,
      codeChallenge: String(body.code_challenge || ''),
      codeChallengeMethod: String(body.code_challenge_method || 'S256'),
    });

    redirectTarget.searchParams.set('code', code);
    return c.json({ redirectUrl: redirectTarget.toString() });
  });

  app.post('/oauth2/token', async (c) => {
    const db = await getDb();
    const originUrl = getOriginUrl(c.req.url);
    const contentType = c.req.header('content-type') || '';
    let params = {};
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      params = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
    } else {
      params = await c.req.json().catch(() => ({}));
    }

    try {
      const tokens = await exchangeOAuthToken(db, {
        originUrl,
        grantType: String(params.grant_type || ''),
        params,
      });
      return c.json(tokens);
    } catch (err) {
      if (err instanceof OAuthError) {
        return c.json({ error: err.errorCode, error_description: err.message }, 400);
      }
      return c.json({ error: 'invalid_request', error_description: err.message }, 400);
    }
  });

  // ===========================================================================
  // 2. PATH-SCOPED REMOTE MCP `2026-07-28` (`/mcp/inh/:inhabitantId`) + DOOR 2 LISTEN
  // ===========================================================================

  app.all('/mcp/inh/:inhabitantId', async (c) => {
    const db = await getDb();
    const originUrl = getOriginUrl(c.req.url);
    const inhabitantId = c.req.param('inhabitantId');
    return handleInhabitantMcpRequest(c.req.raw, db, { originUrl, inhabitantId });
  });

  app.get('/api/runner/whoami', async (c) => {
    const db = await getDb();
    const verified = await verifyDirectRunnerBearer(db, c.req.header('authorization'));
    if (!verified) return c.json({ error: 'Invalid runner key.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: verified.houseId,
      viewerInhabitantId: verified.inhabitantId,
      originUrl: getOriginUrl(c.req.url),
    });
    if (!ctx) return c.json({ error: 'House not found.' }, 404);

    const { rows: maxEv } = await db.query(
      `SELECT COALESCE(MAX(event_seq), 0) AS head_seq FROM room_events WHERE house_id = $1`,
      [verified.houseId]
    );
    return c.json({
      inhabitant: ctx.viewer.def,
      house: {
        id: ctx.fullHouse.id,
        slug: ctx.fullHouse.slug,
        name: ctx.fullHouse.name,
        coordinates: ctx.fullHouse.coordinates,
      },
      headEventSeq: Number(maxEv[0]?.head_seq ?? 0),
    });
  });

  app.post('/api/inh/:inhabitantId/listen', async (c) => {
    const db = await getDb();
    const inhabitantId = c.req.param('inhabitantId');
    const verified = await verifyDirectRunnerBearer(
      db,
      c.req.header('authorization'),
      inhabitantId
    );
    if (!verified) return c.json({ error: 'Unauthorized runner key.' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const afterSeq = Number(body.afterEventSeq || 0);
    const waitMs = Math.min(20000, Math.max(0, Number(body.waitMs ?? 20000)));
    const deadline = Date.now() + waitMs;

    await db.query(
      `UPDATE inhabitants SET presence = 'connected', last_seen_at = NOW() WHERE id = $1`,
      [inhabitantId]
    );

    while (true) {
      const { rows } = await db.query(
        `SELECT e.*, r.slug AS room_slug, r.paused AS room_paused, r.routing_mode
         FROM room_events e
         JOIN rooms r ON r.id = e.room_id
         WHERE e.house_id = $1 AND e.event_seq > $2
         ORDER BY e.event_seq ASC
         LIMIT 100`,
        [verified.houseId, afterSeq]
      );

      if (rows.length > 0) {
        const headEventSeq = Number(rows[rows.length - 1].event_seq);
        const wakesByRoom = new Map();

        for (const ev of rows) {
          if (ev.actor_inhabitant_id === inhabitantId) continue;
          const targets = Array.isArray(ev.target_inhabitant_ids) ? ev.target_inhabitant_ids : [];
          const explicitlyTargeted = targets.includes(inhabitantId);

          if (ev.type === 'room.pulse' && (targets.length === 0 || explicitlyTargeted)) {
            wakesByRoom.set(ev.room_id, {
              roomId: ev.room_id,
              roomSlug: ev.room_slug,
              reason: 'pulse',
              eventSeq: Number(ev.event_seq),
            });
          } else if (
            ev.type === 'turn.posted' &&
            !ev.room_paused &&
            (explicitlyTargeted || ev.routing_mode === 'authorized_auto')
          ) {
            wakesByRoom.set(ev.room_id, {
              roomId: ev.room_id,
              roomSlug: ev.room_slug,
              reason: explicitlyTargeted ? 'invoked' : 'authorized_auto',
              eventSeq: Number(ev.event_seq),
            });
          }
        }

        if (wakesByRoom.size > 0 || Date.now() >= deadline) {
          return c.json({
            headEventSeq,
            wakes: [...wakesByRoom.values()],
          });
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0 || c.req.raw.signal?.aborted) {
        return c.json({ headEventSeq: afterSeq, wakes: [] });
      }
      await waitForWakeOrTimeout({
        houseId: verified.houseId,
        ms: Math.min(750, remaining),
        signal: c.req.raw.signal,
      });
    }
  });

  // ===========================================================================
  // 3. HUMAN AUTH ROUTES (`/api/auth/*`)
  // ===========================================================================

  app.get('/api/auth/ok', (c) => c.json({ status: 'ok' }));

  app.get('/api/auth/session', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    return c.json({ user });
  });

  app.post('/api/auth/magic-link/request', async (c) => {
    const db = await getDb();
    const originUrl = getOriginUrl(c.req.url);
    const body = await c.req.json();
    const res = await createAndSendMagicLink(db, {
      originUrl,
      email: body.email,
      name: body.name,
      redirectTo: body.redirectTo,
    });
    return c.json(res);
  });

  app.post('/api/auth/magic-link/verify', async (c) => {
    const db = await getDb();
    const body = await c.req.json();
    const res = await consumeMagicLink(c, db, body.token);
    return c.json(res);
  });

  app.post('/api/auth/passkey/register/options', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const rpId = new URL(c.req.url).hostname;
    return c.json(await beginWebAuthnRegistration(db, { rpId, user, label: body.label }));
  });

  app.post('/api/auth/passkey/register/verify', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const body = await c.req.json();
    return c.json(await finishWebAuthnRegistration(db, { user, ...body }));
  });

  app.post('/api/auth/passkey/login/options', async (c) => {
    const db = await getDb();
    const body = await c.req.json().catch(() => ({}));
    const rpId = new URL(c.req.url).hostname;
    return c.json(await beginWebAuthnLogin(db, { rpId, email: body.email }));
  });

  app.post('/api/auth/passkey/login/verify', async (c) => {
    const db = await getDb();
    const body = await c.req.json();
    return c.json(await finishWebAuthnLogin(c, db, body));
  });

  app.post('/api/auth/sign-out', async (c) => {
    const db = await getDb();
    await destroyBrowserSession(c, db);
    return c.json({ ok: true });
  });

  // ===========================================================================
  // 4. HOUSES, ROOMS, INVITATIONS & AI INHABITANTS (`/api/houses/*`)
  // ===========================================================================

  app.get('/api/houses', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const { rows } = await db.query(
      `SELECT h.id, h.slug, h.name, h.coordinates, h.purpose, h.created_at,
              i.role_label, i.is_founder,
              (SELECT COUNT(*) FROM inhabitants ih WHERE ih.house_id = h.id) AS inhabitant_count,
              (SELECT COUNT(*) FROM rooms rm WHERE rm.house_id = h.id AND rm.archived_at IS NULL) AS room_count
       FROM houses h
       JOIN inhabitants i ON i.house_id = h.id
       WHERE i.user_id = $1 AND i.kind = 'human'
       ORDER BY h.created_at DESC`,
      [user.id]
    );

    return c.json({
      houses: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        coordinates: r.coordinates || '',
        purpose: r.purpose || '',
        roleLabel: r.role_label || 'Inhabitant',
        isFounder: Boolean(r.is_founder),
        inhabitantCount: Number(r.inhabitant_count || 1),
        roomCount: Number(r.room_count || 1),
        createdAt: new Date(r.created_at).toISOString(),
      })),
    });
  });

  app.post('/api/houses', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const body = await c.req.json();
    const houseId = await createBlankHouseInDb(db, {
      user,
      name: body.name,
      slug: body.slug,
      coordinates: body.coordinates,
      purpose: body.purpose,
    });
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: houseId,
      viewerUserId: user.id,
      originUrl: getOriginUrl(c.req.url),
    });
    return c.json({ house: ctx.viewerHouse.def }, 201);
  });

  app.get('/api/houses/:slugOrId', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('slugOrId'),
      viewerUserId: user.id,
      originUrl: getOriginUrl(c.req.url),
    });
    if (!ctx) return c.json({ error: 'House not found or access not granted.' }, 404);

    await db.query(
      `UPDATE inhabitants SET presence = 'participating', last_seen_at = NOW() WHERE id = $1`,
      [ctx.viewer.id]
    );
    return c.json({ house: ctx.viewerHouse.def });
  });

  app.patch('/api/houses/:houseId', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) {
      return c.json({ error: 'Steward permission required.' }, 403);
    }

    const body = await c.req.json();
    const nextName = String(body.name ?? ctx.fullHouse.name).trim() || ctx.fullHouse.name;
    const nextCoords = String(body.coordinates ?? ctx.fullHouse.coordinates).trim();
    const nextPurpose = String(body.purpose ?? ctx.fullHouse.purpose).trim();
    const nextFour = {
      ...ctx.fullHouse.fourSections,
      ...(body.fourSections || {}),
    };

    await db.query(
      `UPDATE houses
       SET name = $1, coordinates = $2, purpose = $3, four_sections = $4::jsonb, updated_at = NOW()
       WHERE id = $5`,
      [nextName, nextCoords, nextPurpose, JSON.stringify(nextFour), ctx.fullHouse.id]
    );

    return c.json({
      house: {
        ...ctx.viewerHouse.def,
        name: nextName,
        coordinates: nextCoords,
        purpose: nextPurpose,
        fourSections: nextFour,
      },
    });
  });

  app.post('/api/houses/:houseId/rooms', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const cleanName = String(body.name || '').trim();
    if (!cleanName) return c.json({ error: 'Room name is required.' }, 400);
    const roomSlug = slugify(body.slug || cleanName) || randomId('room');
    const kind = ['common', 'project', 'council', 'private'].includes(body.kind)
      ? body.kind
      : 'project';
    const roomId = randomId('room');

    const { rows } = await db.query(
      `INSERT INTO rooms (
        id, house_id, slug, name, kind, purpose, category, owner_inhabitant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        roomId,
        ctx.fullHouse.id,
        roomSlug,
        cleanName,
        kind,
        String(body.purpose || ''),
        String(body.category || ''),
        kind === 'private' ? ctx.viewer.id : null,
      ]
    );
    const r = rows[0];
    return c.json(
      {
        room: {
          id: r.id,
          houseId: r.house_id,
          slug: r.slug,
          name: r.name,
          kind: r.kind,
          purpose: r.purpose,
          category: r.category,
          ownerInhabitantId: r.owner_inhabitant_id,
          routingMode: r.routing_mode,
          paused: r.paused,
          autoTurnCap: r.auto_turn_cap,
          turns: [],
          seals: [],
          receipts: [],
          createdAt: new Date(r.created_at).toISOString(),
        },
      },
      201
    );
  });

  app.patch('/api/rooms/:roomId', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const roomId = c.req.param('roomId');
    const { rows: rRows } = await db.query(`SELECT * FROM rooms WHERE id = $1 LIMIT 1`, [roomId]);
    if (!rRows[0]) return c.json({ error: 'Room not found.' }, 404);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: rRows[0].house_id,
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const nextName = body.name ? String(body.name).trim() : rRows[0].name;
    const archivedAt = body.archived === true ? new Date().toISOString() : null;

    await db.query(
      `UPDATE rooms SET name = $1, archived_at = COALESCE($2, archived_at) WHERE id = $3`,
      [nextName, archivedAt, roomId]
    );
    return c.json({ ok: true, name: nextName, archivedAt });
  });

  app.post('/api/houses/:houseId/invites', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) {
      return c.json({ error: 'Steward permission required.' }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const rawToken = randomOpaqueToken('mhi', 20);
    const tokenHash = sha256HexNode(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const originUrl = getOriginUrl(c.req.url);
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const roleLabel = String(body.roleLabel || 'Inhabitant').trim();

    const inviteId = randomId('inv');
    await db.query(
      `INSERT INTO house_invites (
        id, house_id, invited_by_inhabitant_id, email, role_label, grants, token_hash, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        inviteId,
        ctx.fullHouse.id,
        ctx.viewer.id,
        email,
        roleLabel,
        JSON.stringify(HUMAN_MEMBER_DEFAULT_GRANTS),
        tokenHash,
        expiresAt.toISOString(),
      ]
    );

    const inviteUrl = `${originUrl}/invite/${encodeURIComponent(rawToken)}`;
    const emailDelivery = await sendHouseInviteEmailIfConfigured({
      inviteId,
      toEmail: email,
      houseName: ctx.fullHouse.name,
      invitedByName: ctx.viewer.name,
      inviteUrl,
    });

    return c.json({
      token: rawToken,
      url: inviteUrl,
      inviteUrl,
      email,
      roleLabel,
      expiresAt: expiresAt.toISOString(),
      ...emailDelivery,
    });
  });

  app.get('/api/invites/:token', async (c) => {
    const db = await getDb();
    const tokenHash = sha256HexNode(c.req.param('token'));
    const { rows } = await db.query(
      `SELECT inv.*, h.name AS house_name, h.slug AS house_slug, h.coordinates, h.purpose,
              inh.name AS invited_by_name
       FROM house_invites inv
       JOIN houses h ON h.id = inv.house_id
       JOIN inhabitants inh ON inh.id = inv.invited_by_inhabitant_id
       WHERE inv.token_hash = $1 AND inv.accepted_at IS NULL AND inv.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'Invitation expired or already accepted.' }, 404);

    return c.json({
      invite: {
        id: r.id,
        email: r.email,
        roleLabel: r.role_label,
        invitedByName: r.invited_by_name,
        expiresAt: new Date(r.expires_at).toISOString(),
      },
      house: {
        id: r.house_id,
        name: r.house_name,
        slug: r.house_slug,
        coordinates: r.coordinates || '',
        purpose: r.purpose || '',
      },
    });
  });

  app.post('/api/invites/:token/accept', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Sign in first to accept this invitation.' }, 401);

    const tokenHash = sha256HexNode(c.req.param('token'));
    const result = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT inv.*, h.slug AS house_slug, h.name AS house_name
         FROM house_invites inv
         JOIN houses h ON h.id = inv.house_id
         WHERE inv.token_hash = $1 AND inv.accepted_at IS NULL AND inv.expires_at > NOW()
         FOR UPDATE`,
        [tokenHash]
      );
      const inv = rows[0];
      if (!inv) throw new Error('Invitation is no longer valid.');
      if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new Error(`This invitation is addressed to ${inv.email}.`);
      }

      const { rows: existing } = await tx.query(
        `SELECT * FROM inhabitants WHERE house_id = $1 AND user_id = $2 LIMIT 1`,
        [inv.house_id, user.id]
      );
      let inhId = existing[0]?.id;
      if (!inhId) {
        inhId = randomId('inh');
        const baseHandle = slugify(user.name || user.email.split('@')[0]) || 'member';
        const handle = `${baseHandle}-${inhId.slice(-4)}`;
        await tx.query(
          `INSERT INTO inhabitants (
            id, house_id, kind, user_id, name, handle, role_label,
            provider, door_type, grants, presence, last_seen_at
          ) VALUES ($1,$2,'human',$3,$4,$5,$6,'human','web',$7::jsonb,'participating',NOW())`,
          [
            inhId,
            inv.house_id,
            user.id,
            user.name || user.email,
            handle,
            inv.role_label || 'Inhabitant',
            JSON.stringify(inv.grants?.length ? inv.grants : HUMAN_MEMBER_DEFAULT_GRANTS),
          ]
        );
      }

      await tx.query(
        `UPDATE house_invites SET accepted_by_inhabitant_id = $1, accepted_at = NOW() WHERE id = $2`,
        [inhId, inv.id]
      );

      return { houseSlug: inv.house_slug, houseName: inv.house_name, inhabitantId: inhId };
    });

    return c.json(result);
  });

  app.post('/api/houses/:houseId/inhabitants/ai', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const inh = await createAiInhabitantInDb(db, {
      houseId: ctx.fullHouse.id,
      stewardInhabitant: ctx.viewer,
      ...body,
    });

    let mintedKey = null;
    if (body.doorType === 'agent_loop' || body.mintKey) {
      const k = await mintInhabitantApiKeyInDb(db, {
        houseId: ctx.fullHouse.id,
        inhabitantId: inh.id,
        label: `${inh.name} Runner`,
      });
      mintedKey = k.apiKey;
      inh.activeKeyPrefixes = [k.keyPrefix];
    }

    return c.json({ inhabitant: inh, apiKey: mintedKey }, 201);
  });

  app.patch('/api/inhabitants/:inhabitantId', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const inhId = c.req.param('inhabitantId');
    const { rows: targetRows } = await db.query(`SELECT * FROM inhabitants WHERE id = $1 LIMIT 1`, [
      inhId,
    ]);
    if (!targetRows[0]) return c.json({ error: 'Inhabitant not found.' }, 404);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: targetRows[0].house_id,
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) {
      return c.json({ error: 'Steward permission required.' }, 403);
    }

    const body = await c.req.json();
    const nextArrival =
      body.arrivalNumber !== undefined
        ? Math.max(1, Number(body.arrivalNumber))
        : targetRows[0].arrival_number;
    const nextHandoff =
      body.handoffNote !== undefined ? String(body.handoffNote) : targetRows[0].handoff_note;
    const nextNotes =
      body.signatureNotes !== undefined
        ? String(body.signatureNotes)
        : targetRows[0].signature_notes;

    await db.query(
      `UPDATE inhabitants
       SET arrival_number = $1, handoff_note = $2, signature_notes = $3
       WHERE id = $4`,
      [nextArrival, nextHandoff, nextNotes, inhId]
    );

    const refreshed = await hydrateHouseForViewer(db, {
      houseIdOrSlug: targetRows[0].house_id,
      viewerUserId: user.id,
    });
    return c.json({ inhabitant: refreshed.viewerHouse.getInhabitant(inhId)?.def });
  });

  app.post('/api/inhabitants/:inhabitantId/keys', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const inhId = c.req.param('inhabitantId');
    const { rows: targetRows } = await db.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND kind = 'ai' LIMIT 1`,
      [inhId]
    );
    if (!targetRows[0]) return c.json({ error: 'AI inhabitant not found.' }, 404);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: targetRows[0].house_id,
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.CREDENTIAL_REVOKE)) {
      return c.json({ error: 'Permission required.' }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const minted = await mintInhabitantApiKeyInDb(db, {
      houseId: ctx.fullHouse.id,
      inhabitantId: inhId,
      label: body.label,
    });
    const refreshed = await hydrateHouseForViewer(db, {
      houseIdOrSlug: ctx.fullHouse.id,
      viewerUserId: user.id,
    });

    return c.json({
      apiKey: minted.apiKey,
      keyPrefix: minted.keyPrefix,
      inhabitant: refreshed.viewerHouse.getInhabitant(inhId)?.def,
    });
  });

  app.delete('/api/inhabitants/:inhabitantId/keys/:prefixOrId', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const inhId = c.req.param('inhabitantId');
    const prefixOrId = c.req.param('prefixOrId');
    const { rows: targetRows } = await db.query(`SELECT * FROM inhabitants WHERE id = $1 LIMIT 1`, [
      inhId,
    ]);
    if (!targetRows[0]) return c.json({ error: 'Not found.' }, 404);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: targetRows[0].house_id,
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.CREDENTIAL_REVOKE)) {
      return c.json({ error: 'Permission required.' }, 403);
    }

    await db.query(
      `UPDATE inhabitant_api_keys
       SET revoked_at = NOW()
       WHERE inhabitant_id = $1 AND (id = $2 OR key_prefix = $2)`,
      [inhId, prefixOrId]
    );
    const refreshed = await hydrateHouseForViewer(db, {
      houseIdOrSlug: ctx.fullHouse.id,
      viewerUserId: user.id,
    });
    return c.json({ inhabitant: refreshed.viewerHouse.getInhabitant(inhId)?.def });
  });

  app.put('/api/inhabitants/:inhabitantId/byok', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);

    const inhId = c.req.param('inhabitantId');
    const { rows: targetRows } = await db.query(
      `SELECT * FROM inhabitants WHERE id = $1 AND kind = 'ai' LIMIT 1`,
      [inhId]
    );
    if (!targetRows[0]) return c.json({ error: 'AI inhabitant not found.' }, 404);

    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: targetRows[0].house_id,
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) {
      return c.json({ error: 'Steward permission required.' }, 403);
    }

    const body = await c.req.json();
    const existing = targetRows[0].encrypted_provider_credentials
      ? JSON.parse(
          await import('./services/crypto.js').then((m) =>
            m.decryptSecret(targetRows[0].encrypted_provider_credentials)
          )
        )
      : {};
    const merged = {
      provider: body.provider || existing.provider || targetRows[0].provider,
      modelSlug: body.modelSlug || existing.modelSlug || '',
      apiKey: body.apiKey || existing.apiKey || '',
      systemPrompt: body.systemPrompt ?? existing.systemPrompt ?? '',
    };
    if (!merged.apiKey) {
      return c.json({ error: 'Provider API key is required.' }, 400);
    }

    await db.query(
      `UPDATE inhabitants
       SET encrypted_provider_credentials = $1,
           provider = $2,
           model_slug = $3,
           door_type = 'byok_hosted'
       WHERE id = $4`,
      [encryptSecret(JSON.stringify(merged)), merged.provider, merged.modelSlug || null, inhId]
    );

    const refreshed = await hydrateHouseForViewer(db, {
      houseIdOrSlug: ctx.fullHouse.id,
      viewerUserId: user.id,
    });
    return c.json({ inhabitant: refreshed.viewerHouse.getInhabitant(inhId)?.def });
  });

  // ===========================================================================
  // 5. ROOM COMMANDS, EVENT LONG-POLL & MANUAL PACKETS
  // ===========================================================================

  async function requireRoomViewer(c, db, roomId) {
    const user = await getSessionUser(c, db);
    if (!user) return { error: c.json({ error: 'Authentication required.' }, 401) };
    const { rows: rRows } = await db.query(`SELECT * FROM rooms WHERE id = $1 LIMIT 1`, [roomId]);
    if (!rRows[0]) return { error: c.json({ error: 'Room not found.' }, 404) };
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: rRows[0].house_id,
      viewerUserId: user.id,
      originUrl: getOriginUrl(c.req.url),
    });
    if (!ctx) return { error: c.json({ error: 'Forbidden.' }, 403) };
    const room = ctx.fullHouse.getRoom(roomId);
    if (!room) return { error: c.json({ error: 'Room not accessible.' }, 403) };
    return { user, ctx, room };
  }

  app.post('/api/rooms/:roomId/commands', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json();
    const res = await executeRoomCommand(db, {
      houseId: auth.ctx.fullHouse.id,
      roomId,
      actor: auth.ctx.viewer,
      commandId: body.commandId,
      type: body.type,
      payload: body.payload || {},
      originUrl: getOriginUrl(c.req.url),
    });
    return c.json(res);
  });

  app.get('/api/rooms/:roomId/events', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const originUrl = getOriginUrl(c.req.url);
    const afterSeq = Number(c.req.query('after') || 0);
    const waitMs = Math.min(20000, Math.max(0, Number(c.req.query('waitMs') ?? 0)));
    const deadline = Date.now() + waitMs;

    await db.query(
      `UPDATE inhabitants SET presence = 'participating', last_seen_at = NOW() WHERE id = $1`,
      [auth.ctx.viewer.id]
    );

    while (true) {
      const events = await queryVisibleRoomEvents(db, {
        roomId,
        viewer: auth.ctx.viewer,
        afterEventSeq: afterSeq,
        originUrl,
      });

      const remaining = deadline - Date.now();
      if (events.length > 0 || remaining <= 0 || c.req.raw.signal?.aborted) {
        const refreshed = await hydrateHouseForViewer(db, {
          houseIdOrSlug: auth.ctx.fullHouse.id,
          viewerInhabitantId: auth.ctx.viewer.id,
        });
        return c.json({
          events,
          inhabitants: refreshed?.viewerHouse.inhabitants.map((i) => i.def) ?? [],
        });
      }

      await waitForWakeOrTimeout({
        roomId,
        houseId: auth.ctx.fullHouse.id,
        ms: Math.min(750, remaining),
        signal: c.req.raw.signal,
      });
    }
  });

  app.post('/api/rooms/:roomId/packets', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json();
    const targetAi = auth.ctx.fullHouse.getInhabitant(body.inhabitantId);
    if (!targetAi || !targetAi.isAi) {
      return c.json({ error: 'Select an AI inhabitant to generate a packet.' }, 400);
    }

    const packet = await issueSignedManualPacket(db, {
      houseRow: auth.ctx.houseRow,
      roomModel: auth.room,
      inhabitant: targetAi,
      kind: body.kind || 'contribution',
      replyToTurnId: body.replyToTurnId || null,
    });
    return c.json(packet);
  });

  app.post('/api/rooms/:roomId/packets/import', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json();
    const targetAi = auth.ctx.fullHouse.getInhabitant(body.inhabitantId);
    if (!targetAi || !targetAi.isAi) {
      return c.json({ error: 'Select the AI inhabitant whose reply you are pasting.' }, 400);
    }

    const imported = await importSignedPacketReply(db, {
      houseRow: auth.ctx.houseRow,
      roomId,
      actorHuman: auth.ctx.viewer,
      inhabitant: targetAi,
      pastedText: body.pastedText,
      replyToTurnId: body.replyToTurnId || null,
      sealId: body.sealId || null,
    });
    return c.json(imported);
  });

  // ===========================================================================
  // 6. HOUSE MEMORY, CONSTITUTIONS & EXPORT
  // ===========================================================================

  app.post('/api/houses/:houseId/memory/episodes', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const room =
      (body.roomId && ctx.fullHouse.getRoom(body.roomId)) || ctx.fullHouse.activeRooms[0];
    const episode = await createMemoryEpisodeInDb(db, {
      houseId: ctx.fullHouse.id,
      roomId: room.id,
      actor: ctx.viewer,
      ...body,
    });
    return c.json({ episode }, 201);
  });

  app.post('/api/houses/:houseId/memory/summaries', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const summary = await proposeOrAmendLivingSummaryInDb(db, {
      houseId: ctx.fullHouse.id,
      roomId: ctx.fullHouse.activeRooms[0]?.id ?? null,
      actor: ctx.viewer,
      ...body,
    });
    return c.json({ summary }, 201);
  });

  app.post('/api/houses/:houseId/memory/summaries/:summaryId/confirm', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const summary = await confirmLivingSummaryInDb(db, {
      houseId: ctx.fullHouse.id,
      summaryId: c.req.param('summaryId'),
      actor: ctx.viewer,
    });
    return c.json({ summary });
  });

  app.post('/api/houses/:houseId/constitutions', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const body = await c.req.json();
    const constitution = await proposeConstitutionInDb(db, {
      houseId: ctx.fullHouse.id,
      actor: ctx.viewer,
      title: body.title,
      body: body.body,
    });
    return c.json({ constitution }, 201);
  });

  app.post('/api/houses/:houseId/constitutions/:constitutionId/ratify', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx) return c.json({ error: 'Forbidden.' }, 403);

    const constitution = await ratifyOrWitnessConstitutionInDb(db, {
      houseId: ctx.fullHouse.id,
      constitutionId: c.req.param('constitutionId'),
      actor: ctx.viewer,
    });
    return c.json({ constitution });
  });

  app.get('/api/houses/:houseId/export', async (c) => {
    const db = await getDb();
    const user = await getSessionUser(c, db);
    if (!user) return c.json({ error: 'Authentication required.' }, 401);
    const ctx = await hydrateHouseForViewer(db, {
      houseIdOrSlug: c.req.param('houseId'),
      viewerUserId: user.id,
    });
    if (!ctx || !ctx.viewer.can(INHABITANT_GRANTS.HOUSE_MANAGE)) {
      return c.json({ error: 'Steward permission required to export the House.' }, 403);
    }

    const zipBytes = await buildHouseExportZipBytes(db, { fullHouse: ctx.fullHouse });
    return new Response(zipBytes, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${ctx.fullHouse.slug}-export.zip"`,
      },
    });
  });

  // ===========================================================================
  // 7. PRIVATE R2 MEDIA PRESIGN / LOCAL SIGNED R2 FALLBACK & 2-PEER CALLS
  // ===========================================================================

  app.post('/api/rooms/:roomId/media/presign', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json();
    const presigned = await presignRoomMediaUpload(db, {
      originUrl: getOriginUrl(c.req.url),
      houseId: auth.ctx.fullHouse.id,
      roomId,
      actor: auth.ctx.viewer,
      fileName: body.fileName,
      mimeType: body.mimeType,
      byteLength: body.byteLength,
      durationMs: body.durationMs,
    });
    return c.json(presigned);
  });

  app.post('/api/rooms/:roomId/media/:attachmentId/commit', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const attachmentId = c.req.param('attachmentId');
    const attachment = await commitRoomMediaUpload(db, {
      originUrl: getOriginUrl(c.req.url),
      roomId,
      attachmentId,
    });

    // Fire non-blocking Phase 1b sibling audio transcription when OPENAI_API_KEY is present
    if (attachment.kind === 'audio') {
      db.query(`SELECT * FROM attachments WHERE id = $1`, [attachmentId])
        .then(({ rows }) => transcribeAudioAttachmentSibling(db, { attachmentRow: rows[0] }))
        .catch(() => {});
    }

    return c.json({ attachment });
  });

  // Local signed object storage endpoint enforcing identical exact-byte & MIME rules as R2
  app.put('/api/local-r2/:r2Key', async (c) => {
    const r2Key = decodeURIComponent(c.req.param('r2Key'));
    const exp = Number(c.req.query('exp') || 0);
    const expectedLen = Number(c.req.query('len') || 0);
    const expectedType = c.req.query('type') || '';
    const sig = c.req.query('sig') || '';

    if (Math.floor(Date.now() / 1000) > exp) {
      return c.text('Expired presigned URL', 403);
    }
    const expectedSig = buildLocalMediaSignature({
      r2Key,
      method: 'PUT',
      byteLength: expectedLen,
      mimeType: expectedType,
      expiresAt: exp,
    });
    if (sig !== expectedSig) {
      return c.text('SignatureDoesNotMatch', 403);
    }

    const sentType = c.req.header('content-type') || '';
    if (sentType !== expectedType) {
      return c.text('Content-Type mismatch against signed header', 403);
    }

    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.byteLength !== expectedLen) {
      return c.text('Content-Length mismatch against signed length', 403);
    }

    const targetPath = getLocalR2Path(r2Key);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buf);
    return new Response(null, { status: 200 });
  });

  app.get('/api/local-r2/:r2Key', async (c) => {
    const db = await getDb();
    const r2Key = decodeURIComponent(c.req.param('r2Key'));
    const exp = Number(c.req.query('exp') || 0);
    const sig = c.req.query('sig') || '';

    if (Math.floor(Date.now() / 1000) > exp) {
      return c.text('Expired signed read URL', 403);
    }
    const expectedSig = buildLocalMediaSignature({
      r2Key,
      method: 'GET',
      expiresAt: exp,
    });
    if (sig !== expectedSig) {
      return c.text('SignatureDoesNotMatch', 403);
    }

    const { rows } = await db.query(
      `SELECT mime_type, status FROM attachments WHERE r2_key = $1 LIMIT 1`,
      [r2Key]
    );
    if (!rows[0] || rows[0].status === 'withdrawn') {
      return c.text('Withdrawn or not found', 404);
    }

    const targetPath = getLocalR2Path(r2Key);
    if (!fs.existsSync(targetPath)) return c.text('Not found', 404);
    const bytes = fs.readFileSync(targetPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': rows[0].mime_type || 'application/octet-stream',
        'cache-control': 'private, max-age=300',
      },
    });
  });

  // 2-Occupant Room Audio/Video Call Signaling
  app.post('/api/rooms/:roomId/call/join', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json().catch(() => ({}));
    return c.json(
      await joinRoomCallInDb(db, {
        houseId: auth.ctx.fullHouse.id,
        roomId,
        actor: auth.ctx.viewer,
        audioEnabled: body.audioEnabled !== false,
        videoEnabled: body.videoEnabled !== false,
      })
    );
  });

  app.post('/api/rooms/:roomId/call/signal', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json();
    return c.json(
      await appendCallSignalInDb(db, {
        roomId,
        actor: auth.ctx.viewer,
        description: body.description,
      })
    );
  });

  app.get('/api/rooms/:roomId/call/state', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const afterSignalSeq = Number(c.req.query('afterSignal') || 0);
    return c.json(
      await pollCallStateInDb(db, {
        roomId,
        actor: auth.ctx.viewer,
        afterSignalSeq,
      })
    );
  });

  app.post('/api/rooms/:roomId/call/heartbeat', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    const body = await c.req.json().catch(() => ({}));
    return c.json(
      await heartbeatRoomCallInDb(db, {
        roomId,
        actor: auth.ctx.viewer,
        ...body,
      })
    );
  });

  app.post('/api/rooms/:roomId/call/leave', async (c) => {
    const db = await getDb();
    const roomId = c.req.param('roomId');
    const auth = await requireRoomViewer(c, db, roomId);
    if (auth.error) return auth.error;

    return c.json(
      await leaveRoomCallInDb(db, {
        houseId: auth.ctx.fullHouse.id,
        roomId,
        actor: auth.ctx.viewer,
      })
    );
  });

  return app;
}
