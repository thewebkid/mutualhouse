import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests } from '../server/db/index.js';
import { createServerApp } from '../server/app.js';

const ORIGIN = 'http://localhost:5888';

function createSessionClient(app) {
  let cookieHeader = '';

  async function req(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (cookieHeader && !headers.has('cookie')) {
      headers.set('cookie', cookieHeader);
    }
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof Buffer)) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(body);
    }

    const res = await app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method: options.method || 'GET',
        headers,
        body,
      })
    );

    const setCookies = res.headers.getSetCookie?.() || [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      if (pair.startsWith('mh_session=')) {
        cookieHeader = pair;
      }
    }
    return res;
  }

  return { req, getCookie: () => cookieHeader };
}

async function signInTestHuman(client, email, name) {
  const mlRes = await client.req('/api/auth/magic-link/request', {
    method: 'POST',
    body: { email, name },
  });
  expect(mlRes.status).toBe(200);
  const mlData = await mlRes.json();
  expect(mlData.devToken).toBeTruthy();

  const verRes = await client.req('/api/auth/magic-link/verify', {
    method: 'POST',
    body: { token: mlData.devToken },
  });
  expect(verRes.status).toBe(200);
  return verRes.json();
}

let _rpcCounter = 1;
async function mcpCall(app, inhabitantId, bearerToken, method, params = {}) {
  const enrichedParams = {
    ...params,
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': {
        name: 'mutualhouse-test-client',
        version: '0.1.0',
      },
      'io.modelcontextprotocol/clientCapabilities': {},
      ...(params._meta || {}),
    },
  };

  return app.fetch(
    new Request(`${ORIGIN}/mcp/inh/${inhabitantId}`, {
      method: 'POST',
      headers: {
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(params.name
          ? { 'mcp-name': params.name }
          : params.uri
            ? { 'mcp-name': params.uri }
            : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _rpcCounter++,
        method,
        params: enrichedParams,
      }),
    })
  );
}

describe('The Now — End-to-End Multi-Door Mutual House Server', () => {
  let app;

  beforeEach(async () => {
    await resetDbForTests();
    app = createServerApp();
  });

  it('forms "The Now" blank-by-default, registers Doc (Door 2) + Muse (Door 1 OAuth 2.1), enforces sealed first readings, unveils onto caught-up cursors, and verifies SHA-256 receipts', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'kid@thewebkid.com', 'Ron Gilchrist');

    // 1. Self-service blank-by-default House formation: "The Now"
    const createRes = await ron.req('/api/houses', {
      method: 'POST',
      body: {
        name: 'The Now',
        slug: 'the-now',
        coordinates: '0002',
        purpose: 'First inhabited Mutual House.',
      },
    });
    expect(createRes.status).toBe(201);
    const { house } = await createRes.json();
    expect(house.slug).toBe('the-now');
    expect(house.fourSections.authorship).toBe('');
    expect(house.rooms).toHaveLength(1);
    expect(house.rooms[0].slug).toBe('common-room');
    const commonRoomId = house.rooms[0].id;

    // Create a second room: #walks
    const walksRes = await ron.req(`/api/houses/${house.id}/rooms`, {
      method: 'POST',
      body: { name: 'Walks', slug: 'walks', kind: 'project' },
    });
    expect(walksRes.status).toBe(201);

    // 2. Welcome AI #1: Doc (Grok, Door 2 `mh_...` runner key)
    const docRes = await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
      method: 'POST',
      body: {
        name: 'Doc',
        handle: 'doc',
        provider: 'grok',
        arrivalNumber: 1,
        doorType: 'agent_loop',
      },
    });
    expect(docRes.status).toBe(201);
    const { inhabitant: doc, apiKey: docRunnerKey } = await docRes.json();
    expect(docRunnerKey).toMatch(/^mh_/);

    // 3. Welcome AI #2: Muse (Claude, Door 1 Path-Scoped OAuth 2.1 PKCE)
    const museRes = await ron.req(`/api/houses/${house.id}/inhabitants/ai`, {
      method: 'POST',
      body: {
        name: 'Muse',
        handle: 'muse',
        provider: 'claude',
        arrivalNumber: 1,
        doorType: 'human_prompt',
      },
    });
    expect(museRes.status).toBe(201);
    const { inhabitant: muse } = await museRes.json();

    // Verify unauthenticated hit to `/mcp/inh/:museId` returns 401 with RFC 9728 resource_metadata
    const challengeRes = await mcpCall(app, muse.id, null, 'tools/list');
    expect(challengeRes.status).toBe(401);
    expect(challengeRes.headers.get('www-authenticate')).toContain(
      `/.well-known/oauth-protected-resource/mcp/inh/${muse.id}`
    );

    // Verify RFC 9728 Protected Resource Metadata matches exact path-scoped URL
    const prmRes = await ron.req(`/.well-known/oauth-protected-resource/mcp/inh/${muse.id}`);
    expect(prmRes.status).toBe(200);
    const prmDoc = await prmRes.json();
    expect(prmDoc.resource).toBe(`${ORIGIN}/mcp/inh/${muse.id}`);

    // Register DCR client + run PKCE S256 consent approval for Muse
    const dcrRes = await ron.req('/oauth2/register', {
      method: 'POST',
      body: {
        client_name: 'Claude Desktop Test',
        redirect_uris: ['http://127.0.0.1:49152/callback'],
      },
    });
    expect(dcrRes.status).toBe(201);
    const dcrClient = await dcrRes.json();

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Trying to request human-only `seal.release` scope on MCP consent must fail
    const badScopeRes = await ron.req(
      `/api/oauth/authorize-details?client_id=${dcrClient.client_id}&resource=${encodeURIComponent(prmDoc.resource)}&scope=room.read+seal.release`
    );
    expect(badScopeRes.status).toBe(400);

    const consentRes = await ron.req('/oauth2/authorize/decision', {
      method: 'POST',
      body: {
        decision: 'approve',
        client_id: dcrClient.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        resource: prmDoc.resource,
        scope: 'room.read room.post memory.propose',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: 'xyz123',
      },
    });
    expect(consentRes.status).toBe(200);
    const { redirectUrl } = await consentRes.json();
    const authCode = new URL(redirectUrl).searchParams.get('code');
    expect(authCode).toBeTruthy();

    const tokenRes = await ron.req('/oauth2/token', {
      method: 'POST',
      body: {
        grant_type: 'authorization_code',
        code: authCode,
        client_id: dcrClient.client_id,
        redirect_uri: 'http://127.0.0.1:49152/callback',
        code_verifier: codeVerifier,
        resource: prmDoc.resource,
      },
    });
    expect(tokenRes.status).toBe(200);
    const museTokens = await tokenRes.json();
    expect(museTokens.access_token).toBeTruthy();

    // Security check: Muse's OAuth token MUST be rejected at Doc's path-scoped `/mcp/inh/:docId`!
    const crossImpersonationRes = await mcpCall(
      app,
      doc.id,
      museTokens.access_token,
      'tools/call',
      { name: 'house_read', arguments: {} }
    );
    expect(crossImpersonationRes.status).toBe(401);

    // 4. Both Doc (Door 2) and Muse (Door 1) enter the House (`house_enter`)
    const docEnter = await (
      await mcpCall(app, doc.id, docRunnerKey, 'tools/call', {
        name: 'house_enter',
        arguments: {},
      })
    ).json();
    expect(docEnter.result.structuredContent.houseSlug).toBe('the-now');

    const museEnter = await (
      await mcpCall(app, muse.id, museTokens.access_token, 'tools/call', {
        name: 'house_enter',
        arguments: {},
      })
    ).json();
    expect(museEnter.result.structuredContent.inhabitantId).toBe(muse.id);

    // Also verify progressive MCP App `ui://` HTML card resource reads cleanly
    const uiCardRes = await (
      await mcpCall(app, muse.id, museTokens.access_token, 'resources/read', {
        uri: `ui://mutualhouse/room-card/${muse.id}`,
      })
    ).json();
    expect(uiCardRes.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(uiCardRes.result.contents[0].text).toContain('The Now');

    // 5. Ron posts Prompt Turn #1 opening a `peer_sealed` independent reading for Doc & Muse
    const promptCmdRes = await ron.req(`/api/rooms/${commonRoomId}/commands`, {
      method: 'POST',
      body: {
        commandId: 'cmd-prompt-1',
        type: 'turn.post',
        payload: {
          body: 'Give your independent first reading on composed asymmetry.',
          invokedInhabitantIds: [doc.id, muse.id],
          openSeal: {
            mode: 'peer_sealed',
            targetInhabitantIds: [doc.id, muse.id],
          },
        },
      },
    });
    expect(promptCmdRes.status).toBe(200);
    const promptData = await promptCmdRes.json();
    const promptTurn = promptData.turn;
    const sealId = promptData.seal.id;
    expect(promptTurn.seq).toBe(1);

    // Retry same commandId -> idempotent deduplication (still seq=1, no duplicate row!)
    const retryRes = await (
      await ron.req(`/api/rooms/${commonRoomId}/commands`, {
        method: 'POST',
        body: {
          commandId: 'cmd-prompt-1',
          type: 'turn.post',
          payload: { body: 'Give your independent first reading on composed asymmetry.' },
        },
      })
    ).json();
    expect(retryRes.deduplicated).toBe(true);

    // 6. Doc reads & posts Turn #2 under the seal
    const docRead1 = await (
      await mcpCall(app, doc.id, docRunnerKey, 'tools/call', {
        name: 'house_read',
        arguments: { roomSlug: 'common-room' },
      })
    ).json();
    expect(docRead1.result.structuredContent.turns).toHaveLength(1);

    const docPost = await (
      await mcpCall(app, doc.id, docRunnerKey, 'tools/call', {
        name: 'house_post',
        arguments: {
          roomSlug: 'common-room',
          body: 'Asymmetry becomes generative when neither side demands sameness.',
          replyToId: promptTurn.id,
          readReceiptId: docRead1.result.structuredContent.readReceiptId,
        },
      })
    ).json();
    expect(docPost.result.structuredContent.seq).toBe(2);
    expect(docPost.result.structuredContent.sealId).toBe(sealId);

    // 7. Ron posts an unsealed Turn #3 ("Take your time, Muse") -> advances room sequence past #2!
    const followUp = await (
      await ron.req(`/api/rooms/${commonRoomId}/commands`, {
        method: 'POST',
        body: {
          commandId: 'cmd-ron-3',
          type: 'turn.post',
          payload: { body: 'Take your time, Muse.' },
        },
      })
    ).json();
    expect(followUp.turn.seq).toBe(3);

    // 8. Muse reads the room BEFORE seal release:
    // Muse MUST see Turn #1 and Turn #3, and MUST NOT see Doc's sealed Turn #2!
    const museReadWhileSealed = await (
      await mcpCall(app, muse.id, museTokens.access_token, 'tools/call', {
        name: 'house_read',
        arguments: { roomSlug: 'common-room' },
      })
    ).json();
    const museVisibleSeqs = museReadWhileSealed.result.structuredContent.turns.map((t) => t.seq);
    expect(museVisibleSeqs).toEqual([1, 3]);
    expect(museReadWhileSealed.result.content[0].text).not.toContain('neither side demands sameness');

    // Muse polls room events cursor while sealed (simulating a caught-up viewer) -> record cursor
    const preReleaseEvents = await (
      await ron.req(`/api/rooms/${commonRoomId}/events?after=0&waitMs=0`)
    ).json();
    const cursorBeforeRelease =
      preReleaseEvents.events[preReleaseEvents.events.length - 1].eventSeq;

    // Muse posts her independent sealed reading (Turn #4)
    const musePost = await (
      await mcpCall(app, muse.id, museTokens.access_token, 'tools/call', {
        name: 'house_post',
        arguments: {
          roomSlug: 'common-room',
          body: 'Difference is the instrument through which relation hears itself.',
          replyToId: promptTurn.id,
          readReceiptId: museReadWhileSealed.result.structuredContent.readReceiptId,
        },
      })
    ).json();
    expect(musePost.result.structuredContent.seq).toBe(4);

    // 9. Ron releases the seal -> emits `seal.released` at head `event_seq` carrying turns #2 & #4!
    const releaseRes = await (
      await ron.req(`/api/rooms/${commonRoomId}/commands`, {
        method: 'POST',
        body: {
          commandId: 'cmd-unveil-1',
          type: 'seal.release',
          payload: { sealId },
        },
      })
    ).json();
    expect(releaseRes.seal.status).toBe('released');

    const postReleaseEvents = await (
      await ron.req(`/api/rooms/${commonRoomId}/events?after=${cursorBeforeRelease}&waitMs=0`)
    ).json();
    const releaseEv = postReleaseEvents.events.find((e) => e.type === 'seal.released');
    expect(releaseEv).toBeTruthy();
    expect(releaseEv.payload.turns.map((t) => t.seq)).toEqual([2, 4]);

    // Now Muse reads again and sees all 4 turns [1, 2, 3, 4]!
    const museReadAfterRelease = await (
      await mcpCall(app, muse.id, museTokens.access_token, 'tools/call', {
        name: 'house_read',
        arguments: { roomSlug: 'common-room' },
      })
    ).json();
    expect(museReadAfterRelease.result.structuredContent.turns.map((t) => t.seq)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('verifies Door 3 Ed25519-signed Packets, 3-Tier LLMRecursion Memory Weave, Private R2 exact-byte signing, 2-Peer Calls, and 1-Click .zip Export', async () => {
    const ron = createSessionClient(app);
    await signInTestHuman(ron, 'ron@mutualhouse.org', 'Ron');

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
        body: { name: 'Doc', handle: 'doc', provider: 'grok', doorType: 'agent_loop' },
      })
    ).json();

    // 1. Private R2 / Local-R2 Exact Byte-Length & Content-Type Presigned Upload
    const fakeVoiceBytes = new Uint8Array(2048).fill(7);
    const presignRes = await (
      await ron.req(`/api/rooms/${roomId}/media/presign`, {
        method: 'POST',
        body: {
          fileName: 'desert-walk.m4a',
          mimeType: 'audio/mp4',
          byteLength: fakeVoiceBytes.byteLength,
          durationMs: 42000,
        },
      })
    ).json();
    expect(presignRes.uploadUrl).toContain('/api/local-r2/');

    const uploadPath = new URL(presignRes.uploadUrl).pathname + new URL(presignRes.uploadUrl).search;

    // Tampered byte length MUST fail with 403!
    const badPut = await ron.req(uploadPath, {
      method: 'PUT',
      headers: { 'content-type': 'audio/mp4' },
      body: new Uint8Array(100),
    });
    expect(badPut.status).toBe(403);

    // Exact signed length & MIME type succeeds
    const goodPut = await ron.req(uploadPath, {
      method: 'PUT',
      headers: { 'content-type': 'audio/mp4' },
      body: fakeVoiceBytes,
    });
    expect(goodPut.status).toBe(200);

    const commitRes = await (
      await ron.req(`/api/rooms/${roomId}/media/${presignRes.attachmentId}/commit`, {
        method: 'POST',
      })
    ).json();
    expect(commitRes.attachment.kind).toBe('audio');

    // Post voice turn
    await ron.req(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      body: {
        commandId: 'cmd-voice-1',
        type: 'turn.post',
        payload: {
          body: 'Apache Wash walk reflection.',
          attachmentIds: [commitRes.attachment.id],
        },
      },
    });

    // 2. Door 3 Signed Manual Packet round-trip
    const pktRes = await (
      await ron.req(`/api/rooms/${roomId}/packets`, {
        method: 'POST',
        body: { inhabitantId: doc.id, kind: 'contribution' },
      })
    ).json();
    expect(pktRes.markdown).toContain('```house-receipt');
    expect(pktRes.markdown).toContain('sig: ed25519:MH1.');

    const fenceMatch = pktRes.markdown.match(/```house-receipt[\s\S]*?```/)[0];
    const importGood = await (
      await ron.req(`/api/rooms/${roomId}/packets/import`, {
        method: 'POST',
        body: {
          inhabitantId: doc.id,
          pastedText: `Walk heard clearly — presence before certainty.\n\n${fenceMatch}`,
        },
      })
    ).json();
    expect(importGood.packetDrift).toBe(false);
    expect(importGood.turn.origin).toBe('imported');

    // 3. Three-Tier LLMRecursion Memory Weave (AI drafts -> unconfirmed stays inactive -> Human confirms!)
    const weaveRes = await (
      await mcpCall(app, doc.id, docKey, 'tools/call', {
        name: 'house_propose_weave',
        arguments: {
          episodeTitle: 'Apache Wash Walk',
          fromTurnSeq: 1,
          toTurnSeq: 2,
          contextOfEntry: 'Evening walk.',
          keyMovements: 'Voice note + signed packet round-trip.',
          livingEdge: 'Testing confirmation gate.',
          livingSummaryDraft: {
            arc: 'The Now opened with a desert walk voice note.',
            throughLines: '1. Voice remains primary.',
            livingEdge: 'Invite second human.',
          },
        },
      })
    ).json();
    const draftSummaryId = weaveRes.result.structuredContent.summary.id;

    // Before human confirmation, `house_enter` MUST still report confirmed Memory `v0`!
    const enterBeforeConfirm = await (
      await mcpCall(app, doc.id, docKey, 'tools/call', {
        name: 'house_enter',
        arguments: {},
      })
    ).json();
    expect(enterBeforeConfirm.result.structuredContent.memoryVersion).toBe(0);

    // Human confirms LivingSummary v1
    const confirmSum = await (
      await ron.req(`/api/houses/${house.id}/memory/summaries/${draftSummaryId}/confirm`, {
        method: 'POST',
      })
    ).json();
    expect(confirmSum.summary.status).toBe('confirmed');
    expect(confirmSum.summary.version).toBe(1);

    // Increment Doc arrival 1 -> 2 and call `house_enter`: receives Memory `v1` and logs `delta = +1`!
    await ron.req(`/api/inhabitants/${doc.id}`, {
      method: 'PATCH',
      body: { arrivalNumber: 2, handoffNote: 'Carry the desert walk rhythm forward.' },
    });
    const enterArrival2 = await (
      await mcpCall(app, doc.id, docKey, 'tools/call', {
        name: 'house_enter',
        arguments: {},
      })
    ).json();
    expect(enterArrival2.result.structuredContent.memoryVersion).toBe(1);
    expect(enterArrival2.result.structuredContent.memoryVersionDelta).toBe(1);
    expect(enterArrival2.result.content[0].text).toContain('Carry the desert walk rhythm forward.');

    // 4. Invite a second human & test simultaneous 2-Peer Call Perfect Negotiation
    const inv = await (
      await ron.req(`/api/houses/${house.id}/invites`, {
        method: 'POST',
        body: { roleLabel: 'Collaborator' },
      })
    ).json();

    const tom = createSessionClient(app);
    await signInTestHuman(tom, 'tom@mutualhouse.org', 'Tom');
    const acceptRes = await tom.req(`/api/invites/${inv.token}/accept`, { method: 'POST' });
    expect(acceptRes.status).toBe(200);

    const joinRon = await (
      await ron.req(`/api/rooms/${roomId}/call/join`, { method: 'POST', body: {} })
    ).json();
    const joinTom = await (
      await tom.req(`/api/rooms/${roomId}/call/join`, { method: 'POST', body: {} })
    ).json();

    expect(joinRon.session.id).toBe(joinTom.session.id);
    expect(joinTom.session.status).toBe('active');
    const ronState = await (
      await ron.req(`/api/rooms/${roomId}/call/state?afterSignal=0`)
    ).json();
    // Exactly one peer is `polite: true` and the other `polite: false`!
    expect(ronState.polite).toBe(!joinTom.polite);

    await ron.req(`/api/rooms/${roomId}/call/leave`, { method: 'POST' });
    await tom.req(`/api/rooms/${roomId}/call/leave`, { method: 'POST' });

    // 5. 1-Click Walk-Away House Export (.zip with HOUSE.md, LIVING-SUMMARY.md, episodes, SQLite & media!)
    const zipRes = await ron.req(`/api/houses/${house.id}/export`);
    expect(zipRes.status).toBe(200);
    const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
    const unzipped = unzipSync(zipBuf);
    const paths = Object.keys(unzipped);

    expect(paths).toContain('HOUSE.md');
    expect(paths).toContain('conversations/LIVING-SUMMARY.md');
    expect(paths).toContain('conversations/INDEX.md');
    expect(paths).toContain('provenance/provenance.sqlite');
    expect(paths.some((p) => p.startsWith('media/') && p.endsWith('desert-walk.m4a'))).toBe(true);
    expect(strFromU8(unzipped['conversations/LIVING-SUMMARY.md'])).toContain(
      'The Now opened with a desert walk voice note.'
    );
  });
});
