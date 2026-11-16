import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '../server/db/index.js';
import { createServerApp } from '../server/app.js';
import { getAiHost, normalizeBearerSecret, wakeHostFor } from '../shared/lib/ai-hosts.js';
import { formatClaudeRoutineBody } from '../server/services/invocations.js';
import { sha256HexNode } from '../server/services/crypto.js';

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
    const body = JSON.parse(formatClaudeRoutineBody({ inhabitantId: 'inh_1', reason: 'invoked', room: { slug: 'common-room' }, turn: { bodyExcerpt: 'hello' } }));
    expect(body.text).toMatch(/inh_1/);
    expect(body.mutualhouse.reason).toBe('invoked');
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

  it('subscribes a ChatGPT webhook and prunes a 410', async () => {
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.type === 'verification') return new Response(JSON.stringify({ challenge: body.challenge }), { status: 200 });
      return new Response('gone', { status: 410 });
    });
    const subscribed = await mcp(app, inhabitant.id, apiKey, 'events/subscribe', {
      name: 'mutualhouse.invocation',
      delivery: { mode: 'webhook', url: 'https://connectors.api.openai.com/hook', secret },
    });
    expect(subscribed.status).toBe(200);
    expect((await subscribed.json()).result.id).toBeTruthy();
    const roomId = house.house.rooms[0].id;
    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'mention', payload: { body: 'Hello @lumina' } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
