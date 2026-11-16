import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '../server/db/index.js';
import { createServerApp } from '../server/app.js';

const ORIGIN = 'http://localhost:5888';

function createSessionClient(app) {
  let cookieHeader = '';

  async function req(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (cookieHeader && !headers.has('cookie')) headers.set('cookie', cookieHeader);
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof Uint8Array)) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(body);
    }
    const res = await app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method: options.method || 'GET',
        headers,
        body,
        redirect: options.redirect || 'follow',
      })
    );
    for (const sc of res.headers.getSetCookie?.() || []) {
      const pair = sc.split(';')[0];
      if (pair.startsWith('mh_session=')) cookieHeader = pair;
    }
    return res;
  }

  return { req };
}

async function signInTestHuman(client, email, name) {
  const mlRes = await client.req('/api/auth/magic-link/request', {
    method: 'POST',
    body: { email, name },
  });
  expect(mlRes.status).toBe(200);
  const { devToken } = await mlRes.json();
  const verRes = await client.req('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: devToken },
  });
  expect(verRes.status).toBe(200);
  return { devToken, session: await verRes.json() };
}

async function mcpCall(app, inhabitantId, bearerToken, method, params = {}) {
  return app.fetch(
    new Request(`${ORIGIN}/mcp/inh/${inhabitantId}`, {
      method: 'POST',
      headers: {
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(params.name ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'coverage-client', version: '0.1.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
}

async function openHouse(client, slug = 'the-now') {
  const res = await client.req('/api/houses', {
    method: 'POST',
    body: { name: 'The Now', slug, coordinates: '0002', purpose: 'A working room.' },
  });
  expect(res.status).toBe(201);
  return (await res.json()).house;
}

describe('Mutual House doors the first suite left thin', () => {
  let app;

  beforeEach(async () => {
    await resetDbForTests();
    app = createServerApp();
  });

  it('guards sessions, spends a magic link once, and publishes discovery documents', async () => {
    const anonHouses = await app.fetch(new Request(`${ORIGIN}/api/houses`));
    expect(anonHouses.status).toBe(401);

    const anonSession = await (await app.fetch(new Request(`${ORIGIN}/api/auth/session`))).json();
    expect(anonSession.user).toBeNull();
    expect((await (await app.fetch(new Request(`${ORIGIN}/api/auth/ok`))).json()).status).toBe('ok');

    const badEmail = await app.fetch(
      new Request(`${ORIGIN}/api/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      })
    );
    expect(badEmail.status).toBe(400);

    const ron = createSessionClient(app);
    const { devToken } = await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');
    const session = await (await ron.req('/api/auth/session')).json();
    expect(session.user.email).toBe('kid@thewebkid.com');

    const reused = await ron.req('/api/auth/magic-link/verify', {
      method: 'POST',
      body: { token: devToken },
    });
    expect(reused.status).toBe(400);
    expect((await reused.json()).error).toMatch(/expired or was already used/);

    const passkeyAnon = await app.fetch(
      new Request(`${ORIGIN}/api/auth/passkey/register/options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    );
    expect(passkeyAnon.status).toBe(401);

    const passkey = await (await ron.req('/api/auth/passkey/register/options', {
      method: 'POST',
      body: { label: 'Desk' },
    })).json();
    expect(passkey.challengeId).toBeTruthy();
    expect(passkey.options.rp.id).toBe('localhost');
    expect(passkey.options.challenge).toBeTruthy();

    const login = await (await ron.req('/api/auth/passkey/login/options', {
      method: 'POST',
      body: { email: 'kid@thewebkid.com' },
    })).json();
    expect(login.challengeId).toBeTruthy();

    const signedOut = await ron.req('/api/auth/sign-out', { method: 'POST' });
    expect(signedOut.status).toBe(200);
    expect((await (await ron.req('/api/auth/session')).json()).user).toBeNull();
    expect((await ron.req('/api/houses')).status).toBe(401);

    const authorize = await app.fetch(
      new Request(`${ORIGIN}/oauth2/authorize?client_id=abc&scope=room.read`),
      { redirect: 'manual' }
    );
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get('location')).toContain('/oauth/consent');

    const jwks = await (await app.fetch(new Request(`${ORIGIN}/.well-known/jwks.json`))).json();
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });

    const metadata = await (
      await app.fetch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))
    ).json();
    expect(metadata.issuer).toBe(ORIGIN);
    expect(metadata.token_endpoint).toBe(`${ORIGIN}/oauth2/token`);
    expect(metadata.scopes_supported).toEqual(['room.read', 'room.post', 'memory.propose']);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);

    expect(
      (await app.fetch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))).status
    ).toBe(404);
    expect(
      (
        await app.fetch(
          new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp/inh/missing`)
        )
      ).status
    ).toBe(404);
  });

  it('lets a steward ratify a constitution and keeps member and BYOK secrets in their lanes', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');
    const house = await openHouse(ron);

    const patched = await ron.req(`/api/houses/${house.id}`, {
      method: 'PATCH',
      body: {
        purpose: 'Composed difference.',
        fourSections: { authorship: 'Ron Gilchrist' },
      },
    });
    expect(patched.status).toBe(200);
    const patchedHouse = (await patched.json()).house;
    expect(patchedHouse.purpose).toBe('Composed difference.');
    expect(patchedHouse.fourSections.authorship).toBe('Ron Gilchrist');

    const loaded = await (await ron.req(`/api/houses/${house.slug}`)).json();
    expect(loaded.house.name).toBe('The Now');
    expect((await ron.req('/api/houses/not-a-house')).status).toBe(404);

    const draftRes = await ron.req(`/api/houses/${house.id}/constitutions`, {
      method: 'POST',
      body: { title: 'How we speak', body: 'No one speaks as someone else.' },
    });
    expect(draftRes.status).toBe(201);
    const { constitution } = await draftRes.json();
    expect(constitution.status).toBe('draft');
    expect(constitution.version).toBe(1);

    const ratified = await (
      await ron.req(`/api/houses/${house.id}/constitutions/${constitution.id}/ratify`, {
        method: 'POST',
      })
    ).json();
    expect(ratified.constitution.status).toBe('ratified');

    const after = await (await ron.req(`/api/houses/${house.id}`)).json();
    expect(after.house.constitutions.map((c) => c.status)).toContain('ratified');

    const invited = await (
      await ron.req(`/api/houses/${house.id}/invites`, {
        method: 'POST',
        body: { email: 'tom@example.com', roleLabel: 'Member' },
      })
    ).json();
    const preview = await ron.req(`/api/invites/${invited.token}`);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.house.slug).toBe('the-now');
    expect(previewBody.invite.email).toBe('tom@example.com');
    expect((await ron.req('/api/invites/not-a-real-token')).status).toBe(404);

    const stranger = createSessionClient(app);
    await signInTestHuman(stranger, 'other@example.com', 'Other');
    const wrongInbox = await stranger.req(`/api/invites/${invited.token}/accept`, {
      method: 'POST',
    });
    expect(wrongInbox.status).toBe(400);
    expect((await wrongInbox.json()).error).toContain('tom@example.com');

    const tom = createSessionClient(app);
    await signInTestHuman(tom, 'tom@example.com', 'Tom');
    const accepted = await tom.req(`/api/invites/${invited.token}/accept`, { method: 'POST' });
    expect(accepted.status).toBe(200);
    const tomHouses = await (await tom.req('/api/houses')).json();
    expect(tomHouses.houses.map((h) => h.slug)).toContain('the-now');
    expect((await tom.req(`/api/houses/${house.id}/export`)).status).toBe(403);
    expect((await tom.req(`/api/houses/${house.id}`, { method: 'PATCH', body: { name: 'Nope' } })).status).toBe(
      403
    );

    const { inhabitant: doc } = await (
      await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Doc', handle: 'doc', provider: 'grok', doorType: 'human_prompt' },
      })
    ).json();
    expect((await tom.req(`/api/inhabitants/${doc.id}/keys`, { method: 'POST', body: {} })).status).toBe(
      403
    );

    const missingKey = await ron.req(`/api/inhabitants/${doc.id}/byok`, {
      method: 'PUT',
      body: { provider: 'grok', apiKey: '' },
    });
    expect(missingKey.status).toBe(400);

    const byok = await ron.req(`/api/inhabitants/${doc.id}/byok`, {
      method: 'PUT',
      body: {
        provider: 'grok',
        modelSlug: 'grok-4',
        apiKey: 'xai-test-secret-key',
        systemPrompt: 'Speak plainly.',
      },
    });
    expect(byok.status).toBe(200);
    const stored = await byok.json();
    expect(JSON.stringify(stored)).not.toContain('xai-test-secret-key');
    expect(stored.inhabitant.doorType).toBe('byok_hosted');
    expect(stored.inhabitant.hasByokCredentials).toBe(true);
  });

  it('pauses AI circulation, dedupes room commands, and revokes a runner key', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');
    const house = await openHouse(ron, 'pause-house');
    const roomId = house.rooms[0].id;

    const { inhabitant: doc, apiKey } = await (
      await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Doc', handle: 'doc', provider: 'grok', doorType: 'agent_loop' },
      })
    ).json();
    expect(apiKey).toMatch(/^mh_/);

    const who = await app.fetch(
      new Request(`${ORIGIN}/api/runner/whoami`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    );
    expect(who.status).toBe(200);
    expect((await who.json()).inhabitant.id).toBe(doc.id);

    const first = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'once', payload: { body: 'Once.' } },
    });
    expect(first.status).toBe(200);
    const again = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'once', payload: { body: 'Once.' } },
    });
    expect((await again.json()).deduplicated).toBe(true);

    const empty = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'empty', payload: { body: '   ' } },
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/text or at least one attachment/);

    const unknown = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.explode', commandId: 'nope', payload: {} },
    });
    expect(unknown.status).toBe(400);

    const routing = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: {
        type: 'room.set_routing',
        commandId: 'route-1',
        payload: { routingMode: 'manual' },
      },
    });
    expect((await routing.json()).routingMode).toBe('manual');

    const spoken = await mcpCall(app, doc.id, apiKey, 'tools/call', {
      name: 'house_post',
      arguments: { body: 'Before the pause.' },
    });
    expect(spoken.status).toBe(200);
    expect((await spoken.json()).result.structuredContent.seq).toBe(2);

    const paused = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.pause', commandId: 'pause-1', payload: { paused: true } },
    });
    expect((await paused.json()).paused).toBe(true);

    const blocked = await mcpCall(app, doc.id, apiKey, 'tools/call', {
      name: 'house_post',
      arguments: { body: 'While paused.' },
    });
    expect(JSON.stringify(await blocked.json())).toContain('paused');

    const resumed = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.pause', commandId: 'pause-2', payload: { paused: false } },
    });
    expect((await resumed.json()).paused).toBe(false);

    const after = await mcpCall(app, doc.id, apiKey, 'tools/call', {
      name: 'house_post',
      arguments: { body: 'After the pause.' },
    });
    expect((await after.json()).result.structuredContent.seq).toBe(3);

    const pulse = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.pulse', commandId: 'pulse-1', payload: { targetInhabitantIds: [doc.id] } },
    });
    expect((await pulse.json()).pulsed).toBe(true);

    const listen = await app.fetch(
      new Request(`${ORIGIN}/api/inh/${doc.id}/listen`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ afterEventSeq: 0, waitMs: 0 }),
      })
    );
    expect(listen.status).toBe(200);
    const heard = await listen.json();
    expect(heard.wakes.some((w) => w.reason === 'pulse' && w.roomId === roomId)).toBe(true);

    const revoked = await ron.req(`/api/inhabitants/${doc.id}/keys/${apiKey.slice(0, 11)}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    const rejected = await app.fetch(
      new Request(`${ORIGIN}/api/runner/whoami`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    );
    expect(rejected.status).toBe(401);
    const deaf = await app.fetch(
      new Request(`${ORIGIN}/api/inh/${doc.id}/listen`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ waitMs: 0 }),
      })
    );
    expect(deaf.status).toBe(401);
  });

  it('denies OAuth consent, rejects human-only scopes, and revokes a replayed refresh token', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');
    const house = await openHouse(ron, 'oauth-house');
    const { inhabitant: muse } = await (
      await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Muse', handle: 'muse', provider: 'claude', doorType: 'human_prompt' },
      })
    ).json();

    const prm = await (
      await ron.req(`/.well-known/oauth-protected-resource/mcp/inh/${muse.id}`)
    ).json();
    const dcr = await (
      await ron.req('/oauth2/register', {
        method: 'POST',
        body: {
          client_name: 'Grok Bot',
          redirect_uris: ['http://127.0.0.1:49152/callback'],
        },
      })
    ).json();

    const denied = await ron.req('/oauth2/authorize/decision', {
      method: 'POST',
      body: {
        decision: 'deny',
        client_id: dcr.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        resource: prm.resource,
        state: 'xyz',
      },
    });
    const deniedUrl = new URL((await denied.json()).redirectUrl);
    expect(deniedUrl.searchParams.get('error')).toBe('access_denied');
    expect(deniedUrl.searchParams.get('state')).toBe('xyz');
    expect(deniedUrl.searchParams.get('code')).toBeNull();

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const forbidden = await ron.req('/oauth2/authorize/decision', {
      method: 'POST',
      body: {
        decision: 'approve',
        client_id: dcr.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        resource: prm.resource,
        scope: 'room.read seal.release',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    expect(forbidden.status).toBe(400);
    expect((await forbidden.json()).error).toMatch(/human-only/);

    const approved = await ron.req('/oauth2/authorize/decision', {
      method: 'POST',
      body: {
        decision: 'approve',
        client_id: dcr.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        resource: prm.resource,
        scope: 'room.read',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    const code = new URL((await approved.json()).redirectUrl).searchParams.get('code');
    const tokenRes = await ron.req('/oauth2/token', {
      method: 'POST',
      body: {
        grant_type: 'authorization_code',
        code,
        client_id: dcr.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        code_verifier: codeVerifier,
        resource: prm.resource,
      },
    });
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    expect(tokens.scope).toBe('room.read room.post memory.propose');

    const refreshed = await ron.req('/oauth2/token', {
      method: 'POST',
      body: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: dcr.client_id,
        resource: prm.resource,
      },
    });
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.scope).toBe(tokens.scope);

    const replay = await ron.req('/oauth2/token', {
      method: 'POST',
      body: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: dcr.client_id,
        resource: prm.resource,
      },
    });
    expect(replay.status).toBe(400);
    const replayBody = await replay.json();
    expect(replayBody.error).toBe('invalid_grant');
    expect(replayBody.error_description).toMatch(/replay/i);

    const lineage = await ron.req('/oauth2/token', {
      method: 'POST',
      body: {
        grant_type: 'refresh_token',
        refresh_token: next.refresh_token,
        client_id: dcr.client_id,
        resource: prm.resource,
      },
    });
    expect(lineage.status).toBe(400);
    expect((await lineage.json()).error).toBe('invalid_grant');
  });

  it('edits an AI signature and departs them without erasing their name', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');
    const house = await openHouse(ron, 'depart-house');
    const roomId = house.rooms[0].id;

    const welcomed = await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Copilot', handle: 'copilot', provider: 'custom', doorType: 'agent_loop' },
    });
    expect(welcomed.status).toBe(201);
    const { inhabitant: copilot, apiKey } = await welcomed.json();
    expect(apiKey).toMatch(/^mh_/);

    const docRes = await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Doc', handle: 'doc', provider: 'grok', doorType: 'agent_loop' },
    });
    const { inhabitant: doc } = await docRes.json();

    const who = await app.fetch(
      new Request(`${ORIGIN}/api/runner/whoami`, { headers: { authorization: `Bearer ${apiKey}` } })
    );
    expect(who.status).toBe(200);

    const renamed = await ron.req(`/api/inhabitants/${copilot.id}`, {
      method: 'PATCH',
      body: {
        name: 'Copilot',
        handle: 'Pilot!',
        provider: 'copilot',
        doorType: 'human_prompt',
        modelSlug: 'studio',
        signatureNotes: 'A door, not a chat.',
      },
    });
    expect(renamed.status).toBe(200);
    const edited = (await renamed.json()).inhabitant;
    expect(edited.handle).toBe('pilot');
    expect(edited.provider).toBe('copilot');
    expect(edited.providerDisclosure).toMatch(/Microsoft Copilot/);
    expect(edited.modelSlug).toBe('studio');
    expect(edited.doorType).toBe('human_prompt');
    expect(edited.signatureNotes).toBe('A door, not a chat.');
    expect(edited.hasOAuthConnection).toBe(false);
    expect(edited.departedAt ?? null).toBeNull();

    const clash = await ron.req(`/api/inhabitants/${copilot.id}`, {
      method: 'PATCH',
      body: { handle: 'doc' },
    });
    expect(clash.status).toBe(409);

    const badDoor = await ron.req(`/api/inhabitants/${copilot.id}`, {
      method: 'PATCH',
      body: { doorType: 'window' },
    });
    expect(badDoor.status).toBe(400);

    const routing = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: {
        type: 'room.set_routing',
        commandId: 'route-auto',
        payload: { routingMode: 'authorized_auto' },
      },
    });
    expect(routing.status).toBe(200);
    expect((await routing.json()).routingMode).toBe('authorized_auto');

    const mentioned = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'hello-pilot', payload: { body: 'Hello @pilot' } },
    });
    expect(mentioned.status).toBe(200);
    const mentionedTurn = (await mentioned.json()).turn;
    expect(mentionedTurn.invokedInhabitantIds).toEqual([copilot.id]);

    const anon = await app.fetch(
      new Request(`${ORIGIN}/api/inhabitants/${copilot.id}/depart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    );
    expect(anon.status).toBe(401);

    const departed = await ron.req(`/api/inhabitants/${copilot.id}/depart`, {
      method: 'POST',
      body: { handoffNote: 'The chat cannot open the door.' },
    });
    expect(departed.status).toBe(200);
    const left = (await departed.json()).inhabitant;
    expect(left.departedAt).toBeTruthy();
    expect(left.handoffNote).toBe('The chat cannot open the door.');
    expect(left.name).toBe('Copilot');
    expect(left.activeKeyPrefixes).toEqual([]);

    const rejected = await app.fetch(
      new Request(`${ORIGIN}/api/runner/whoami`, { headers: { authorization: `Bearer ${apiKey}` } })
    );
    expect(rejected.status).toBe(401);
    expect(
      (
        await ron.req(`/api/inhabitants/${copilot.id}/depart`, {
          method: 'POST',
          body: {},
        })
      ).status
    ).toBe(409);
    expect(
      (
        await ron.req(`/api/inhabitants/${copilot.id}`, {
          method: 'PATCH',
          body: { name: 'Again' },
        })
      ).status
    ).toBe(409);

    const loaded = await (await ron.req(`/api/houses/${house.slug}`)).json();
    const pilot = loaded.house.inhabitants.find((i) => i.id === copilot.id);
    expect(pilot.departedAt).toBeTruthy();
    expect(pilot.name).toBe('Copilot');

    const after = await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'after-depart', payload: { body: 'Still here @pilot' } },
    });
    const afterBody = await after.json();
    expect(afterBody.turn.invokedInhabitantIds).toEqual([]);

    const db = await getDb();
    const { rows } = await db.query(
      `SELECT inhabitant_id FROM inhabitant_invocations WHERE turn_id = $1`,
      [afterBody.turn.id]
    );
    expect(rows.map((row) => row.inhabitant_id)).toEqual([doc.id]);
  });
});
