import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  cleanseText,
  cyrb53,
  deepPlain,
  raw,
  sha256Hex,
  slugify,
} from '../shared/lib/model-util.js';
import { signatureIndex, signatureStyle, SIGNATURE_COUNT } from '../client/src/lib/signature.js';
import { parseHouseReceiptFence } from '../server/services/packets.js';
import {
  decryptSecret,
  encryptSecret,
  hmacSha256Hex,
  randomId,
  randomOpaqueToken,
  sha256HexNode,
  signMcpOAuthJwt,
  signWithHouseEd25519,
  verifyMcpOAuthJwt,
  verifyWithHouseEd25519,
  generateHouseEd25519KeyPair,
} from '../server/services/crypto.js';
import { emitRoomWake, waitForWakeOrTimeout } from '../server/services/wake-bus.js';
import { buildMcpRoomCardHtml } from '../server/mcp/house-mcp.js';

describe('canonical records and text', () => {
  it('sorts object keys, normalizes unicode, and skips undefined values', () => {
    const composed = 'e\u0301';
    expect(canonicalJson({ b: 1, a: composed, z: undefined })).toBe(
      canonicalJson({ a: 'é', b: 1 })
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(['b', { z: true, a: false }])).toBe('["b",{"a":false,"z":true}]');
  });

  it('hashes the same record to the same 53-bit value', () => {
    expect(cyrb53({ room: 'common', seq: 3 })).toBe(cyrb53({ seq: 3, room: 'common' }));
    expect(cyrb53('the now')).not.toBe(cyrb53('the now', 1));
  });

  it('matches the SHA-256 test vector and strips control characters', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256HexNode('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(cleanseText('keep\u0000this')).toBe('keepthis');
    expect(slugify('  The Now / Walks! ')).toBe('the-now-walks');
  });

  it('unwraps Vue raw proxies and drops functions from plain copies', () => {
    const inner = { id: 'inh-1', speak() {} };
    expect(raw({ __v_raw: { __v_raw: inner } })).toBe(inner);
    expect(deepPlain(inner)).toEqual({ id: 'inh-1' });
    expect(deepPlain(new Date('2026-11-15T16:00:00.000Z'))).toBe('2026-11-15T16:00:00.000Z');
  });
});

describe('inhabitant signature hues', () => {
  it('keeps one hue per inhabitant id and stays inside the eight-hue set', () => {
    const muse = { id: 'inh-muse', name: 'Muse' };
    expect(signatureIndex(muse)).toBe(signatureIndex({ id: 'inh-muse', name: 'Someone else' }));
    expect(signatureIndex(muse)).toBeGreaterThanOrEqual(1);
    expect(signatureIndex(muse)).toBeLessThanOrEqual(SIGNATURE_COUNT);
    expect(signatureStyle(muse)).toEqual({ '--sig': `var(--sig-${signatureIndex(muse)})` });
    expect(signatureIndex({})).toBeNull();
    expect(signatureStyle(null)).toEqual({});
  });
});

describe('house receipt fences', () => {
  it('lifts the house-receipt block and leaves the spoken text', () => {
    const pasted = [
      'The room was already speaking.',
      '',
      '```house-receipt',
      'schema: mutualhouse.packet/1',
      'receipt_id: rr_1',
      'reply_to: null',
      'sig: ed25519:MH1.abc',
      '```',
    ].join('\n');
    const { cleanBody, parsedReceipt } = parseHouseReceiptFence(pasted);
    expect(cleanBody).toBe('The room was already speaking.');
    expect(parsedReceipt).toEqual({
      schema: 'mutualhouse.packet/1',
      receipt_id: 'rr_1',
      reply_to: 'null',
      sig: 'ed25519:MH1.abc',
    });
  });

  it('returns the whole paste when there is no fence', () => {
    expect(parseHouseReceiptFence('  just a turn  ')).toEqual({
      cleanBody: 'just a turn',
      parsedReceipt: null,
    });
  });
});

describe('house secrets and OAuth signing', () => {
  it('round-trips AES-GCM secrets and rejects a tampered seal', () => {
    const sealed = encryptSecret('provider-key');
    expect(decryptSecret(sealed)).toBe('provider-key');
    expect(hmacSha256Hex('packet', 'same')).toBe(hmacSha256Hex('packet', 'same'));
    expect(hmacSha256Hex('packet', 'same')).not.toBe(hmacSha256Hex('other', 'same'));
    const [version, iv, tag, body] = sealed.split('.');
    const flipped = body.slice(0, -1) + (body.endsWith('a') ? 'b' : 'a');
    expect(() => decryptSecret(`${version}.${iv}.${tag}.${flipped}`)).toThrow();
    expect(() => decryptSecret('nope')).toThrow(/Invalid encrypted secret/);
    expect(randomId('inh')).toMatch(/^inh_[0-9a-f]+$/);
    expect(randomOpaqueToken('mh', 24)).toMatch(/^mh_[A-Za-z0-9_-]+$/);
  });

  it('signs and verifies Ed25519 packet payloads', () => {
    const keys = generateHouseEd25519KeyPair();
    const payload = canonicalJson({ house: 'the-now', seq: 4 });
    const sig = signWithHouseEd25519(keys.encryptedPrivateKeyEd25519, payload);
    expect(sig.startsWith('ed25519:MH1.')).toBe(true);
    expect(verifyWithHouseEd25519(keys.publicKeyEd25519, payload, sig)).toBe(true);
    expect(verifyWithHouseEd25519(keys.publicKeyEd25519, canonicalJson({ seq: 5 }), sig)).toBe(
      false
    );
    expect(verifyWithHouseEd25519(keys.publicKeyEd25519, payload, 'not-a-signature')).toBe(false);
  });

  it('issues an EdDSA access token that verifies only for its audience', async () => {
    const audience = 'http://localhost:5888/mcp/inh/inh_1';
    const { jwt } = await signMcpOAuthJwt({
      issuer: 'http://localhost:5888',
      audience,
      inhabitantId: 'inh_1',
      houseId: 'house_1',
      clientId: 'mhc_test',
      scopes: ['room.read', 'room.post'],
      tokenId: 'tok_1',
      ttlSeconds: 60,
    });
    const claims = await verifyMcpOAuthJwt(jwt, {
      issuer: 'http://localhost:5888',
      expectedAudience: audience,
    });
    expect(claims.scope).toBe('room.read room.post');
    expect(claims.inhabitant_id).toBe('inh_1');
    await expect(
      verifyMcpOAuthJwt(jwt, {
        issuer: 'http://localhost:5888',
        expectedAudience: 'http://localhost:5888/mcp/inh/inh_other',
      })
    ).rejects.toThrow();
  });
});

describe('room wake bus', () => {
  it('wakes a waiting listener and also resolves on abort or timeout', async () => {
    const roomId = `room-${randomId('wake')}`;
    const woken = waitForWakeOrTimeout({ roomId, ms: 2000 });
    emitRoomWake(roomId);
    await woken;

    const controller = new AbortController();
    const aborted = waitForWakeOrTimeout({ houseId: `house-${roomId}`, ms: 2000, signal: controller.signal });
    controller.abort();
    await aborted;

    await waitForWakeOrTimeout({ roomId: `quiet-${roomId}`, ms: 15 });
  });
});

describe('MCP room card', () => {
  it('escapes turn text inside the inline room card', () => {
    const html = buildMcpRoomCardHtml({
      house: {
        name: 'The Now',
        memory: { activeMemoryVersion: 3 },
        getInhabitant: () => ({ name: 'Muse' }),
      },
      room: {
        slug: 'common-room',
        activeSeals: [{}],
        visibleTurnsFor: () => [{ authorId: 'inh-muse', seq: 2, body: 'Hello <script>' }],
      },
      inhabitant: { id: 'inh-muse', displayTitle: 'Muse 003' },
    });
    expect(html).toContain('Hello &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Muse 003');
    expect(html).toContain('Active sealed first reading');
  });
});
