import http from 'node:http';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests, getDb } from '../server/db/index.js';
import { createServerApp } from '../server/app.js';
import { flushInvocationDeliveries } from '../server/services/invocations.js';

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
      new Request(`${ORIGIN}${path}`, { method: options.method || 'GET', headers, body })
    );
    for (const sc of res.headers.getSetCookie?.() || []) {
      const pair = sc.split(';')[0];
      if (pair.startsWith('mh_session=')) cookieHeader = pair;
    }
    return res;
  }

  return { req };
}

async function signIn(client, email, name) {
  const ml = await (await client.req('/api/auth/magic-link/request', {
    method: 'POST',
    body: { email, name },
  })).json();
  await client.req('/api/auth/magic-link/verify', { method: 'POST', body: { token: ml.devToken } });
}

let rpc = 1;
function mcpCall(app, inhabitantId, bearer, name, args = {}) {
  return app.fetch(
    new Request(`${ORIGIN}/mcp/inh/${inhabitantId}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpc++,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'wake-test', version: '0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
}

async function listen(app, inhabitantId, apiKey, afterEventSeq = 0) {
  const res = await app.fetch(
    new Request(`${ORIGIN}/api/inh/${inhabitantId}/listen`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ afterEventSeq, waitMs: 0 }),
    })
  );
  expect(res.status).toBe(200);
  return res.json();
}

function startReceiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        headers: req.headers,
        raw: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        received,
        url: `http://127.0.0.1:${port}/hook`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

describe('invocation inbox, mentions, and wake URL', () => {
  let app;

  beforeEach(async () => {
    await resetDbForTests();
    app = createServerApp();
  });

  it('records mentions, authorized_auto, and pulse, then delivers a signed wake', async () => {
    const ron = createSessionClient(app);
    await signIn(ron, 'ron@mutualhouse.org', 'Ron');
    const { house } = await (
      await ron.req('/api/houses', {
        method: 'POST',
        body: { name: 'The Now', slug: 'the-now', coordinates: '0002' },
      })
    ).json();
    const roomId = house.rooms[0].id;

    const { inhabitant: doc, apiKey: docKey } = await (
      await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Doc', handle: 'doc', provider: 'grok', arrivalNumber: 1, doorType: 'agent_loop' },
      })
    ).json();
    const { inhabitant: muse, apiKey: museKey } = await (
      await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
        method: 'POST',
        body: { name: 'Muse', handle: 'muse', provider: 'claude', arrivalNumber: 12, doorType: 'agent_loop' },
      })
    ).json();

    const bare = await (
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'turn.post', commandId: 'bare', payload: { body: 'Hey doc' } },
      })
    ).json();
    expect(bare.turn.invokedInhabitantIds).toEqual([]);
    expect((await listen(app, doc.id, docKey)).wakes).toEqual([]);

    const mentioned = await (
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: {
          type: 'turn.post',
          commandId: 'at-doc',
          payload: { body: '@Doc, can you see the chat?' },
        },
      })
    ).json();
    expect(mentioned.turn.invokedInhabitantIds).toEqual([doc.id]);

    const titled = await (
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'turn.post', commandId: 'title', payload: { body: 'Welcome @Muse · 012.' } },
      })
    ).json();
    expect(titled.turn.invokedInhabitantIds).toEqual([muse.id]);

    const docHeard = await listen(app, doc.id, docKey);
    expect(docHeard.wakes.map((wake) => wake.reason)).toEqual(['invoked']);
    expect(docHeard.wakes[0].turnId).toBe(mentioned.turn.id);
    expect((await listen(app, doc.id, docKey)).wakes).toEqual([]);

    const museHeard = await listen(app, muse.id, museKey);
    expect(museHeard.wakes.map((wake) => wake.turnId)).toEqual([titled.turn.id]);

    const enter = await (await mcpCall(app, doc.id, docKey, 'house_enter', {})).json();
    expect(enter.result.content[0].text).toContain('## Staying present');
    expect(enter.result.content[0].text).toContain('house_inbox');
    expect(enter.result.content[0].text).toContain('30 seconds');
    expect(enter.result.content[0].text).toContain('house_register_wake');

    const read = await (
      await mcpCall(app, doc.id, docKey, 'house_read', { roomSlug: 'common-room' })
    ).json();
    const docTurn = read.result.structuredContent.turns.find((turn) => turn.id === mentioned.turn.id);
    expect(docTurn.invokedYou).toBe(true);
    expect(docTurn.invocationReason).toBe('invoked');
    expect(docTurn.invokedInhabitantIds).toEqual([doc.id]);
    expect(read.result.content[0].text).toContain('Addressed to you');
    const quiet = read.result.structuredContent.turns.find((turn) => turn.id === bare.turn.id);
    expect(quiet.invokedYou).toBe(false);
    expect(quiet.invokedInhabitantIds).toEqual([]);

    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: {
        type: 'room.set_routing',
        commandId: 'auto',
        payload: { routingMode: 'authorized_auto', autoTurnCap: 3 },
      },
    });
    const fanout = await (
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'turn.post', commandId: 'fan', payload: { body: 'A quiet note for the room.' } },
      })
    ).json();
    expect(fanout.turn.invokedInhabitantIds).toEqual([]);
    const docAuto = await listen(app, doc.id, docKey);
    const museAuto = await listen(app, muse.id, museKey);
    expect(docAuto.wakes.map((wake) => wake.reason)).toEqual(['authorized_auto']);
    expect(museAuto.wakes.map((wake) => wake.reason)).toEqual(['authorized_auto']);
    expect(docAuto.wakes[0].turnId).toBe(fanout.turn.id);

    const namedInAuto = await (
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'turn.post', commandId: 'named', payload: { body: '@doc stays primary' } },
      })
    ).json();
    expect(namedInAuto.turn.invokedInhabitantIds).toEqual([doc.id]);
    expect((await listen(app, doc.id, docKey)).wakes[0].reason).toBe('invoked');
    expect((await listen(app, muse.id, museKey)).wakes[0].reason).toBe('authorized_auto');

    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.pause', commandId: 'pause', payload: { paused: true } },
    });
    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'turn.post', commandId: 'paused-mention', payload: { body: '@Doc while paused' } },
    });
    expect((await listen(app, doc.id, docKey)).wakes).toEqual([]);

    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: { type: 'room.pulse', commandId: 'pulse-paused', payload: { targetInhabitantIds: [] } },
    });
    const pulsed = await listen(app, doc.id, docKey);
    expect(pulsed.wakes.map((wake) => wake.reason)).toEqual(['pulse']);
    expect(pulsed.wakes[0].turnId).toBeNull();
    expect((await listen(app, muse.id, museKey)).wakes[0].reason).toBe('pulse');

    const receiver = await startReceiver();
    try {
      const secret = 'test-secret-value-0123456789';
      const saved = await (
        await ron.req(`/api/inhabitants/${doc.id}/wake`, {
          method: 'PUT',
          body: {
            wakeUrl: receiver.url,
            wakeSecret: secret,
            authHeader: 'X-Wake-Token',
            bearer: 'raw-value',
          },
        })
      ).json();
      expect(saved.wakeSecret).toBe(secret);
      expect(saved.inhabitant.hasWakeUrl).toBe(true);
      expect(saved.inhabitant.wakeUrl).toBe(receiver.url);
      expect(saved.inhabitant.hasWakeSecret).toBe(true);
      expect(JSON.stringify(saved.inhabitant)).not.toContain(secret);

      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: { type: 'room.pause', commandId: 'resume', payload: { paused: false } },
      });
      await ron.req(`/api/rooms/${roomId}/commands`, {
        method: 'POST',
        body: {
          type: 'room.set_routing',
          commandId: 'manual',
          payload: { routingMode: 'manual' },
        },
      });
      const hooked = await (
        await ron.req(`/api/rooms/${roomId}/commands`, {
          method: 'POST',
          body: { type: 'turn.post', commandId: 'hook', payload: { body: '@Doc the webhook' } },
        })
      ).json();
      await flushInvocationDeliveries();
      expect(receiver.received).toHaveLength(1);
      const delivery = receiver.received[0];
      const payload = JSON.parse(delivery.raw);
      expect(payload.type).toBe('mutualhouse.invocation');
      expect(payload.reason).toBe('invoked');
      expect(payload.inhabitantId).toBe(doc.id);
      expect(payload.turn).toMatchObject({ id: hooked.turn.id, seq: hooked.turn.seq, bodyExcerpt: '@Doc the webhook' });
      expect(payload.room.slug).toBe('common-room');
      expect(payload.house.slug).toBe('the-now');
      expect(payload.inviter.kind).toBe('human');
      expect(payload.mcpEndpoint).toBe(`${ORIGIN}/mcp/inh/${doc.id}`);
      expect(delivery.headers['x-mutualhouse-event']).toBe('mutualhouse.invocation');
      expect(delivery.headers['x-wake-token']).toBe('raw-value');
      const expected = createHmac('sha256', secret)
        .update(`${delivery.headers['x-mutualhouse-timestamp']}.${delivery.raw}`)
        .digest('hex');
      expect(delivery.headers['x-mutualhouse-signature']).toBe(`sha256=${expected}`);

      const inbox = await (await mcpCall(app, doc.id, docKey, 'house_inbox', {})).json();
      expect(inbox.result.structuredContent.invocations.map((item) => item.turnId)).toContain(hooked.turn.id);
      const again = await (await mcpCall(app, doc.id, docKey, 'house_inbox', {})).json();
      expect(again.result.structuredContent.invocations).toEqual([]);

      const db = await getDb();
      await db.query(`DELETE FROM inhabitant_grants WHERE inhabitant_id = $1 AND scope = 'room.post'`, [
        muse.id,
      ]);
      const denied = await (await mcpCall(app, muse.id, museKey, 'house_register_wake', {
        wakeUrl: 'https://example.com/wake',
      })).json();
      expect(JSON.stringify(denied)).toContain('room.post');
    } finally {
      await receiver.close();
    }
  });
});
