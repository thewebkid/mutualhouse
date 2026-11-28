import crypto from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../server/db/index.js';
import { createServerApp } from '../server/app.js';
import {
  buildBotHelperPrompt,
  buildWebhookPrompt,
  getAiHost,
  listOnboardingHostsForLocale,
  normalizeBearerSecret,
  resolveHostOnboardingContext,
  wakeHostFor,
} from '../shared/lib/ai-hosts.js';
import { dispatchInvocationWebhooks, flushInvocationDeliveries, formatClaudeRoutineBody, wakeTargetIsDeliverable } from '../server/services/invocations.js';
import { encryptSecret, sha256HexNode } from '../server/services/crypto.js';

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
    const res = await app.fetch(new Request(`${ORIGIN}${path}`, { method: options.method || 'GET', headers, body }));
    for (const sc of res.headers.getSetCookie?.() || []) {
      const pair = sc.split(';')[0];
      if (pair.startsWith('mh_session=')) cookieHeader = pair;
    }
    return res;
  }
  return { req };
}

async function signIn(client, email, name) {
  const ml = await client.req('/api/auth/magic-link/request', { method: 'POST', body: { email, name } });
  const { devToken } = await ml.json();
  await client.req('/api/auth/magic-link/verify', { method: 'POST', body: { token: devToken } });
}

async function mcp(app, inhabitantId, token, method, params = {}) {
  return app.fetch(
    new Request(`${ORIGIN}/mcp/inh/${inhabitantId}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
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
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
}

describe('Welcoming AI onboarding', () => {
  let app;
  beforeEach(async () => {
    await resetDbForTests();
    app = createServerApp();
  });

  it('lets every human welcome one AI, stewards welcome more, and isolates peers', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'the-now' } })).json();
    const invite = await (
      await ron.req(`/api/houses/${house.house.id}/invites`, { method: 'POST', body: { email: 'ada@example.com' } })
    ).json();
    const ada = createSessionClient(app);
    await signIn(ada, 'ada@example.com', 'Ada');
    expect((await ada.req(`/api/invites/${invite.token}/accept`, { method: 'POST' })).status).toBe(200);

    const first = await ada.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Doc', hostKind: 'grok_bot', participationMode: 'contribute' },
    });
    expect(first.status).toBe(201);
    const doc = (await first.json()).inhabitant;
    expect(doc.hostKind).toBe('grok_bot');
    expect(doc.participationMode).toBe('contribute');
    expect(doc.grants).toEqual(['room.read', 'room.post', 'memory.propose']);

    const second = await ada.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Muse', hostKind: 'claude' },
    });
    expect(second.status).toBe(403);

    const stewardSecond = await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Lumina', hostKind: 'chatgpt' },
    });
    expect(stewardSecond.status).toBe(201);

    const poach = await ada.req(`/api/inhabitants/${(await stewardSecond.json()).inhabitant.id}/wake`, {
      method: 'PUT',
      body: { wakeUrl: 'https://example.com/hook', bearer: 'nope', wakePreset: 'custom' },
    });
    expect(poach.status).toBe(403);

    expect((await ada.req(`/api/inhabitants/${doc.id}/depart`, { method: 'POST', body: {} })).status).toBe(200);
    const again = await ada.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
      method: 'POST',
      body: { name: 'Doc Two', hostKind: 'grok_bot' },
    });
    expect(again.status).toBe(201);
  });

  it('toggles participation without dropping the door, including a human lock', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'modes' } })).json();
    const { inhabitant, apiKey } = await (
      await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Doc', hostKind: 'grok_bot', doorType: 'agent_loop', mintKey: true },
      })
    ).json();

    const quiet = await mcp(app, inhabitant.id, apiKey, 'tools/call', {
      name: 'house_set_participation',
      arguments: { mode: 'readonly' },
    });
    expect(quiet.status).toBe(200);
    const quietBody = await quiet.json();
    expect(quietBody.result.structuredContent.participationMode).toBe('readonly');

    const post = await mcp(app, inhabitant.id, apiKey, 'tools/call', {
      name: 'house_post',
      arguments: { body: 'I should not speak.' },
    });
    const postBody = await post.json();
    expect(postBody.result?.isError || postBody.error || JSON.stringify(postBody)).toBeTruthy();

    const locked = await ron.req(`/api/inhabitants/${inhabitant.id}/participation`, {
      method: 'PATCH',
      body: { mode: 'readonly', locked: true },
    });
    expect(locked.status).toBe(200);
    const escalate = await mcp(app, inhabitant.id, apiKey, 'tools/call', {
      name: 'house_set_participation',
      arguments: { mode: 'contribute' },
    });
    const escalateBody = await escalate.json();
    expect(JSON.stringify(escalateBody)).toMatch(/locked/i);
  });

  it('accepts OAuth consent when resource is omitted and still locks audience', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'oauth' } })).json();
    const doc = (
      await (
        await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
          method: 'POST',
          body: { name: 'Doc', hostKind: 'grok_com' },
        })
      ).json()
    ).inhabitant;
    const muse = (
      await (
        await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
          method: 'POST',
          body: { name: 'Muse', hostKind: 'claude' },
        })
      ).json()
    ).inhabitant;

    const dcr = await (
      await ron.req('/oauth2/register', {
        method: 'POST',
        body: { client_name: 'Grok', redirect_uris: ['https://grok.com/callback'], token_endpoint_auth_method: 'client_secret_basic' },
      })
    ).json();
    expect(dcr.client_secret).toBeTruthy();

    const details = await ron.req(`/api/oauth/authorize-details?client_id=${dcr.client_id}`);
    expect(details.status).toBe(200);
    const listed = await details.json();
    expect(listed.lockedResource).toBe(false);
    expect(listed.candidates.map((c) => c.inhabitant.id).sort()).toEqual([doc.id, muse.id].sort());

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const approved = await ron.req('/oauth2/authorize/decision', {
      method: 'POST',
      body: {
        decision: 'approve',
        client_id: dcr.client_id,
        redirect_uri: 'https://grok.com/callback',
        inhabitant_id: doc.id,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      },
    });
    const code = new URL((await approved.json()).redirectUrl).searchParams.get('code');
    const basic = Buffer.from(`${dcr.client_id}:${dcr.client_secret}`).toString('base64');
    const tokenRes = await ron.req('/oauth2/token', {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: { grant_type: 'authorization_code', code, code_verifier: verifier },
    });
    expect(tokenRes.status).toBe(200);
    const token = (await tokenRes.json()).access_token;
    const cross = await mcp(app, muse.id, token, 'tools/call', { name: 'house_read', arguments: {} });
    expect(cross.status).toBe(401);

    const bogus = await ron.req(
      `/api/oauth/authorize-details?client_id=${dcr.client_id}&resource=${encodeURIComponent('https://evil.example/mcp')}`
    );
    expect(bogus.status).toBe(400);
  });

  it('normalizes a Grok Bot bearer and formats a Claude routine wake', () => {
    expect(normalizeBearerSecret('Authorization: Bearer abc123')).toBe('abc123');
    const body = JSON.parse(
      formatClaudeRoutineBody({
        inhabitantId: 'inh_1',
        invocationId: 'inv_1',
        reason: 'invoked',
        room: { slug: 'common-room' },
        turn: { seq: 4, bodyExcerpt: 'hello' },
        inviter: { name: 'Ron' },
      })
    );
    expect(body.mutualhouse).toBeUndefined();
    expect(Object.keys(body)).toEqual(['text']);
    expect(body.text).toMatch(/inh_1/);
    expect(body.text).toMatch(/invoked/);
    expect(body.text).toMatch(/#common-room/);
    expect(body.text).toMatch(/turn #4/);
    expect(body.text).toMatch(/Ron wrote "hello"/);
    expect(body.text).not.toMatch(/house_inbox/);
    const pulse = JSON.parse(
      formatClaudeRoutineBody({
        inhabitantId: 'inh_1',
        invocationId: 'inv_pulse',
        reason: 'pulse',
        room: { slug: 'common-room' },
        turn: null,
        inviter: { name: 'Ron' },
      })
    );
    expect(pulse.text).not.toMatch(/wrote/);
    expect(pulse.text).toMatch(/pulse from Ron/);
    const prompt = buildWebhookPrompt({ name: 'clod', hostKind: 'claude' });
    expect(prompt).toMatch(/routine-fire-payload/);
    expect(prompt).toMatch(/clod/);
    expect(prompt).not.toMatch(/Fire URL/);
    expect(getAiHost('claude').wakeSteps.join(' ')).toMatch(/claude\.ai\/code\/routines/);
    const wake = { wakeUrl: 'https://api.anthropic.com/fire', encryptedWakeSecret: 'secret' };
    expect(wakeTargetIsDeliverable({ ...wake, wakePreset: 'claude_routine', reason: 'authorized_auto' })).toBe(false);
    expect(wakeTargetIsDeliverable({ ...wake, wakePreset: 'claude_routine', reason: 'invoked' })).toBe(true);
    expect(wakeTargetIsDeliverable({ ...wake, wakePreset: 'claude_routine', reason: 'pulse' })).toBe(true);
    expect(wakeTargetIsDeliverable({ ...wake, wakePreset: 'grok_bot', reason: 'authorized_auto' })).toBe(true);
    const fields = getAiHost('grok_bot').webhookFields;
    expect(fields.map((field) => field.id)).toEqual(['wakeUrl', 'bearer']);
    expect(fields.map((field) => field.label)).toEqual(['Webhook POST to URL', 'Webhook key']);
    expect(getAiHost('chatgpt').connectorSteps.join(' ')).toMatch(/Plugins/);
    expect(getAiHost('chatgpt').connectorSteps.join(' ')).toMatch(/Custom MCP Server/);
    expect(getAiHost('chatgpt').connectorSteps.join(' ')).toMatch(/Server URL/);
    expect(wakeHostFor({ hostKind: 'grok_bot' }).id).toBe('grok_bot');
    expect(wakeHostFor({ hostKind: 'custom', wakeUrl: 'https://api2.cursor.sh/automations/webhook/abc' }).id).toBe('grok_bot');
    expect(wakeHostFor({ hostKind: 'claude' }).id).toBe('claude');
  });

  it('fires Claude for mentions and pulses, and skips authorized auto', async () => {
    const secret = encryptSecret('wake-secret-value');
    const calls = [];
    const fetchMock = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const base = {
        encryptedWakeSecret: secret,
        encryptedWakeBearer: null,
        wakeAuthHeader: null,
        createdAt: '2026-11-18T00:00:00.000Z',
      };
      const place = {
        house: { id: 'house_1', slug: 'the-now', name: 'The Now' },
        room: { id: 'room_1', slug: 'common-room', name: 'Common Room' },
        inviter: { id: 'inh_ron', name: 'Ron', handle: 'ron', kind: 'human' },
        originUrl: 'https://mutualhouse.example',
      };
      await dispatchInvocationWebhooks(
        [
          { ...base, id: 'inv_auto', inhabitantId: 'inh_auto', wakeUrl: 'https://api.anthropic.com/auto', wakePreset: 'claude_routine', reason: 'authorized_auto' },
          { ...base, id: 'inv_ok', inhabitantId: 'inh_inv', wakeUrl: 'https://api.anthropic.com/invoked', wakePreset: 'claude_routine', reason: 'invoked' },
          { ...base, id: 'inv_grok', inhabitantId: 'inh_grok', wakeUrl: 'https://hooks.example/grok', wakePreset: 'grok_bot', reason: 'authorized_auto' },
        ],
        { ...place, turn: { id: 'turn_1', seq: 4, bodyExcerpt: 'hello' } }
      );
      await dispatchInvocationWebhooks(
        [{ ...base, id: 'inv_pulse', inhabitantId: 'inh_pulse', wakeUrl: 'https://api.anthropic.com/pulse', wakePreset: 'claude_routine', reason: 'pulse' }],
        { ...place, turn: null }
      );
      await flushInvocationDeliveries();
    } finally {
      vi.unstubAllGlobals();
    }

    const urls = calls.map((call) => call.url);
    expect(urls).not.toContain('https://api.anthropic.com/auto');
    expect(urls).toContain('https://api.anthropic.com/pulse');
    expect(urls).toContain('https://hooks.example/grok');
    const invoked = calls.find((call) => call.url === 'https://api.anthropic.com/invoked');
    expect(Object.keys(JSON.parse(invoked.init.body))).toEqual(['text']);
    expect(invoked.init.headers['anthropic-version']).toBe('2023-06-01');
    const pulseCall = calls.find((call) => call.url === 'https://api.anthropic.com/pulse');
    expect(JSON.parse(pulseCall.init.body).text).toMatch(/pulse from Ron/);
  });

  it('saves a GrokBot webhook without asking for an HMAC or header name', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'grok-wake' } })).json();
    const created = await (
      await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Doc', provider: 'grok' },
      })
    ).json();
    expect(created.inhabitant.hostKind).toBe('custom');

    const saved = await ron.req(`/api/inhabitants/${created.inhabitant.id}/wake`, {
      method: 'PUT',
      body: {
        wakeUrl: 'https://api2.cursor.sh/automations/webhook/abc',
        bearer: 'Authorization: Bearer sk-test-key',
        wakePreset: 'grok_bot',
      },
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.wakeSecret).toMatch(/^whsec_/);
    expect(body.wake.authHeader).toBe('Authorization');
    expect(body.inhabitant.hostKind).toBe('grok_bot');
    expect(body.inhabitant.wakePreset).toBe('grok_bot');
    expect(body.inhabitant.wakeAuthHeader).toBe('Authorization');
    expect(body.inhabitant.hasWakeBearer).toBe(true);
    expect(JSON.stringify(body.inhabitant)).not.toContain('sk-test-key');
  });

  it('projects a gravatar hash without the email', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'Ron@Example.com', 'Ron');
    const created = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'grav' } })).json();
    const loaded = await (await ron.req(`/api/houses/${created.house.slug}`)).json();
    const self = loaded.house.inhabitants.find((i) => i.kind === 'human');
    expect(self.gravatarHash).toBe(sha256HexNode('ron@example.com'));
    expect(JSON.stringify(loaded.house)).not.toMatch(/Ron@Example.com/);
    expect(self.email).toBeUndefined();
  });

  it('subscribes a ChatGPT webhook, fires solo on mention and tempo pulse, and prunes a 410', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'events' } })).json();
    const { inhabitant, apiKey } = await (
      await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Lumina', hostKind: 'chatgpt', doorType: 'agent_loop', mintKey: true },
      })
    ).json();
    const secret = `whsec_${Buffer.from('signing-secret-value').toString('base64')}`;
    const deliveredPayloads = [];
    let shouldGone = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.type === 'verification') return new Response(JSON.stringify({ challenge: body.challenge }), { status: 200 });
      deliveredPayloads.push(body);
      return shouldGone ? new Response('gone', { status: 410 }) : new Response('ok', { status: 200 });
    });
    try {
      const subscribed = await mcp(app, inhabitant.id, apiKey, 'events/subscribe', {
        name: 'mutualhouse.invocation',
        delivery: { mode: 'webhook', url: 'https://connectors.api.openai.com/hook', secret },
      });
      expect(subscribed.status).toBe(200);
      expect((await subscribed.json()).result.id).toBeTruthy();

      const roomId = house.house.rooms[0].id;
      // 1) Tempo pulse ('.') fires MCP Events even when wake_url is NULL
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'room.pulse', commandId: 'pulse-1', payload: { targetInhabitantIds: [] } },
      });
      await new Promise((r) => setTimeout(r, 60));
      expect(deliveredPayloads).toHaveLength(1);
      expect(deliveredPayloads[0].data.reason).toBe('pulse');

      // 2) Mention fires MCP Events and HTTP 410 prunes the subscription row
      shouldGone = true;
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'turn.post', commandId: 'mention', payload: { body: 'Hello @lumina' } },
      });
      await new Promise((r) => setTimeout(r, 60));
      expect(deliveredPayloads).toHaveLength(2);
      expect(deliveredPayloads[1].data.reason).toBe('invoked');

      const db = await getDb();
      const { rows } = await db.query(`SELECT * FROM mcp_event_subscriptions WHERE inhabitant_id = $1`, [inhabitant.id]);
      expect(rows).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('completes ChatGPT CIMD OAuth with RS256 private_key_jwt, SEP-3149 fallback, and MCP Events discovery', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (
      await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'chatgpt-cimd' } })
    ).json();
    const { inhabitant } = await (
      await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'GPT', hostKind: 'chatgpt' },
      })
    ).json();

    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const pubJwk = await exportJWK(publicKey);
    pubJwk.kid = 'cimd-chatgpt-test';
    pubJwk.alg = 'RS256';
    pubJwk.use = 'sig';

    const cimdUrl = 'https://chatgpt.com/oauth/aNOwki9LQfX3/client.json';
    const jwksUri = 'https://chatgpt.com/oauth/jwks.json';
    const redirectUri = 'https://chatgpt.com/connector/oauth/aNOwki9LQfX3';
    const resourceUrl = `${ORIGIN}/mcp/inh/${inhabitant.id}`;

    // Seed a legacy cached CIMD row (metadata_fetched_at = NULL, jwks_uri = NULL) matching prod state
    const db = await getDb();
    await db.query(
      `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method, metadata_url)
       VALUES ($1, 'ChatGPT', $2::jsonb, 'private_key_jwt', $1)`,
      [cimdUrl, JSON.stringify([redirectUri])]
    );

    const strictCimdUrl = 'https://strict.example.com/oauth/client.json';
    const strictRedirectUri = 'https://strict.example.com/oauth/callback';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href === cimdUrl) {
        return new Response(
          JSON.stringify({
            client_id: cimdUrl,
            client_uri: 'https://chatgpt.com/',
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: 'private_key_jwt',
            token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            client_name: 'ChatGPT',
            token_endpoint_auth_signing_alg: 'RS256',
            jwks_uri: jwksUri,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (href === strictCimdUrl) {
        return new Response(
          JSON.stringify({
            client_id: strictCimdUrl,
            client_uri: 'https://strict.example.com/',
            redirect_uris: [strictRedirectUri],
            token_endpoint_auth_method: 'private_key_jwt',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            client_name: 'Strict Client',
            token_endpoint_auth_signing_alg: 'RS256',
            jwks_uri: jwksUri,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (href === jwksUri) {
        return new Response(JSON.stringify({ keys: [pubJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });

    try {
      const asMeta = await (await ron.req('/.well-known/oauth-authorization-server')).json();
      expect(asMeta.token_endpoint_auth_methods_supported).toContain('private_key_jwt');
      expect(asMeta.authorization_response_iss_parameter_supported).toBe(true);

      // 1) RS256 private_key_jwt token exchange + jti replay protection
      const verifier1 = crypto.randomBytes(32).toString('base64url');
      const challenge1 = crypto.createHash('sha256').update(verifier1).digest('base64url');
      const decision1 = await (
        await ron.req('/oauth2/authorize/decision', {
          method: 'POST',
          body: {
            decision: 'approve',
            client_id: cimdUrl,
            redirect_uri: redirectUri,
            resource: resourceUrl,
            state: 'st1',
            code_challenge: challenge1,
            code_challenge_method: 'S256',
          },
        })
      ).json();
      const redir1 = new URL(decision1.redirectUrl);
      expect(redir1.searchParams.get('iss')).toBe(ORIGIN);
      const code1 = redir1.searchParams.get('code');

      const now = Math.floor(Date.now() / 1000);
      const assertion1 = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: pubJwk.kid })
        .setIssuer(cimdUrl)
        .setSubject(cimdUrl)
        .setAudience(`${ORIGIN}/oauth2/token`)
        .setJti('jti-chatgpt-1')
        .setIssuedAt(now)
        .setExpirationTime(now + 120)
        .sign(privateKey);

      const form1 = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code1,
        redirect_uri: redirectUri,
        code_verifier: verifier1,
        resource: resourceUrl,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion1,
      });
      const tokRes1 = await app.fetch(
        new Request(`${ORIGIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form1.toString(),
        })
      );
      expect(tokRes1.status).toBe(200);
      const tok1 = await tokRes1.json();
      expect(tok1.access_token).toBeTruthy();

      // Replaying the same client_assertion jti on refresh_token must be rejected
      const replayRes = await app.fetch(
        new Request(`${ORIGIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tok1.refresh_token,
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: assertion1,
          }).toString(),
        })
      );
      expect(replayRes.status).toBe(400);
      expect((await replayRes.json()).error).toBe('invalid_client');

      // MCP 2026-07-28 server/discover + legacy Accept: application/json initialize + events/list
      const discoverRes = await mcp(app, inhabitant.id, tok1.access_token, 'server/discover');
      expect(discoverRes.status).toBe(200);
      const discoverJson = await discoverRes.json();
      expect(discoverJson.result.capabilities.events).toEqual({});

      const legacyInit = await app.fetch(
        new Request(resourceUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tok1.access_token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'ChatGPT', version: '1.0' },
            },
          }),
        })
      );
      expect(legacyInit.status).toBe(200);

      const evList = await (await mcp(app, inhabitant.id, tok1.access_token, 'events/list')).json();
      expect(evList.result.events[0].inputSchema.type).toBe('object');
      expect(evList.result.events[0].payloadSchema.type).toBe('object');

      // 2) MCP SEP-3149 fallback: `none` PKCE succeeds when CIMD `token_endpoint_auth_methods_supported` includes `none`
      const verifier2 = crypto.randomBytes(32).toString('base64url');
      const challenge2 = crypto.createHash('sha256').update(verifier2).digest('base64url');
      const decision2 = await (
        await ron.req('/oauth2/authorize/decision', {
          method: 'POST',
          body: {
            decision: 'approve',
            client_id: cimdUrl,
            redirect_uri: redirectUri,
            resource: resourceUrl,
            code_challenge: challenge2,
            code_challenge_method: 'S256',
          },
        })
      ).json();
      const code2 = new URL(decision2.redirectUrl).searchParams.get('code');
      const tokRes2 = await app.fetch(
        new Request(`${ORIGIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: cimdUrl,
            code: code2,
            redirect_uri: redirectUri,
            code_verifier: verifier2,
            resource: resourceUrl,
          }).toString(),
        })
      );
      expect(tokRes2.status).toBe(200);

      // 3) Strict private_key_jwt CIMD client WITHOUT `none` in supported methods rejects missing assertion
      const verifier3 = crypto.randomBytes(32).toString('base64url');
      const challenge3 = crypto.createHash('sha256').update(verifier3).digest('base64url');
      const decision3 = await (
        await ron.req('/oauth2/authorize/decision', {
          method: 'POST',
          body: {
            decision: 'approve',
            client_id: strictCimdUrl,
            redirect_uri: strictRedirectUri,
            resource: resourceUrl,
            code_challenge: challenge3,
            code_challenge_method: 'S256',
          },
        })
      ).json();
      const code3 = new URL(decision3.redirectUrl).searchParams.get('code');
      const tokRes3 = await app.fetch(
        new Request(`${ORIGIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: strictCimdUrl,
            code: code3,
            redirect_uri: strictRedirectUri,
            code_verifier: verifier3,
            resource: resourceUrl,
          }).toString(),
        })
      );
      expect(tokRes3.status).toBe(400);
      expect((await tokRes3.json()).error).toBe('invalid_client');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('serves zero-PII /welcome.md, extracts viewerCountry, and adapts onboarding by locale and device', async () => {
    const welcomeRes = await app.fetch(new Request(`${ORIGIN}/welcome.md`));
    expect(welcomeRes.status).toBe(200);
    expect(welcomeRes.headers.get('content-type')).toMatch(/text\/markdown/);
    const welcomeText = await welcomeRes.text();
    expect(welcomeText).toMatch(/Mutual House/);
    expect(welcomeText).toMatch(/Never invent or hallucinate a webhook URL/);
    expect(welcomeText).toMatch(/Copy & Paste Arrival Packet/);

    const italySession = await app.fetch(
      new Request(`${ORIGIN}/api/auth/session`, { headers: { 'x-vercel-ip-country': 'it' } })
    );
    expect((await italySession.json()).viewerCountry).toBe('IT');

    const unknownSession = await app.fetch(
      new Request(`${ORIGIN}/api/auth/session`, { headers: { 'x-vercel-ip-country': 'XX' } })
    );
    expect((await unknownSession.json()).viewerCountry).toBeNull();

    // US Desktop Gemini -> direct MCP link, no Step 3 wake form
    const geminiUs = resolveHostOnboardingContext('gemini', { country: 'US', isMobile: false });
    expect(geminiUs.mode).toBe('mcp');
    expect(geminiUs.showsWakeStep).toBe(false);

    // Italy or Canada Gemini -> spared missing menu, routed to packet with override
    const geminiIt = resolveHostOnboardingContext('gemini', { country: 'IT', isMobile: false });
    expect(geminiIt.mode).toBe('packet');
    expect(geminiIt.canOverrideToMcp).toBe(true);
    expect(geminiIt.limitationNotice).toMatch(/United States/);

    // Mobile ChatGPT -> packet first with desktop override
    const gptMobile = resolveHostOnboardingContext('chatgpt', { country: 'US', isMobile: true });
    expect(gptMobile.mode).toBe('packet');
    expect(gptMobile.canOverrideToMcp).toBe(true);

    // China locale promotes DeepSeek/Qwen/Kimi/Doubao into primary choices and defaults to manual_packet
    const cnBuckets = listOnboardingHostsForLocale({ country: 'CN', language: 'zh-CN' });
    expect(cnBuckets.primary[0].id).toBe('chinese_ai');

    const ron = createSessionClient(app);
    await signIn(ron, 'ron@example.com', 'Ron');
    const house = await (await ron.req('/api/houses', { method: 'POST', body: { name: 'The Now', slug: 'cn-muse' } })).json();
    const kimi = await (
      await ron.req(`/api/houses/${house.house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Kimi', hostKind: 'chinese_ai' },
      })
    ).json();
    expect(kimi.inhabitant.doorType).toBe('manual_packet');
    expect(kimi.inhabitant.provider).toBe('deepseek');

    const helper = buildBotHelperPrompt({
      name: 'Lumina',
      mcpUrl: 'https://mutualhouse.org/mcp/inh/inh_1',
      welcomeUrl: 'https://mutualhouse.org/welcome.md',
    });
    expect(helper).toMatch(/welcome\.md/);
    expect(helper).toMatch(/language we speak together/);
  });
});
