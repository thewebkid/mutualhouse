import { describe, expect, it } from 'vitest';
import { INHABITANT_GRANTS } from '../shared/models/inhabitant.js';
import {
  advertisedMcpScopes,
  mcpScopeStepUp,
  rewriteBearerChallengeScopes,
  scopesForDynamicClientRegistration,
  scopesGrantedForMcpConsent,
} from '../server/auth/mcp-oauth.js';

const ALL = ['room.read', 'room.post', 'memory.propose'];

describe('MCP OAuth scope selection', () => {
  it('advertises every grant the inhabitant holds, in catalog order', () => {
    expect(advertisedMcpScopes(['memory.propose', 'room.read', 'seal.release'])).toEqual([
      'room.read',
      'memory.propose',
    ]);
    expect(advertisedMcpScopes([])).toEqual(ALL);
  });

  it('delegates the inhabitant’s grants at consent, and rejects human-only scopes', () => {
    expect(scopesGrantedForMcpConsent('room.read', ALL)).toEqual(ALL);
    expect(scopesGrantedForMcpConsent('', ['room.read', 'room.post'])).toEqual([
      'room.read',
      'room.post',
    ]);
    expect(() => scopesGrantedForMcpConsent('room.read seal.release', ALL)).toThrow(/human-only/);
    expect(() => scopesGrantedForMcpConsent('room.read', [])).toThrow(/no MCP grants/);
  });

  it('defaults dynamic client registration to every supported scope when none is requested', () => {
    expect(scopesForDynamicClientRegistration(undefined)).toEqual(ALL);
    expect(scopesForDynamicClientRegistration('')).toEqual(ALL);
    expect(scopesForDynamicClientRegistration('room.read')).toEqual(['room.read']);
    expect(scopesForDynamicClientRegistration(['room.read', 'memory.propose'])).toEqual([
      'room.read',
      'memory.propose',
    ]);
    expect(scopesForDynamicClientRegistration('openid profile')).toEqual(ALL);
    expect(() => scopesForDynamicClientRegistration('seal.release')).toThrow(/human-only/);
  });

  it('rewrites a room.read bearer challenge to the advertised scope set', async () => {
    const original = new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate':
          'Bearer error="invalid_token", error_description="Missing Authorization header", scope="room.read", resource_metadata="https://mutualhouse.vercel.app/.well-known/oauth-protected-resource/mcp/inh/inh_1"',
      },
    });
    const rewritten = rewriteBearerChallengeScopes(original, ALL);
    expect(rewritten.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token", error_description="Missing Authorization header", scope="room.read room.post memory.propose", resource_metadata="https://mutualhouse.vercel.app/.well-known/oauth-protected-resource/mcp/inh/inh_1"'
    );
    expect(rewritten.status).toBe(401);
    expect(await rewritten.json()).toEqual({ error: 'invalid_token' });
  });

  it('inserts a scope parameter when the bearer challenge omitted one', () => {
    const original = new Response(null, {
      status: 401,
      headers: {
        'www-authenticate':
          'Bearer error="invalid_token", resource_metadata="https://mutualhouse.vercel.app/.well-known/oauth-protected-resource/mcp/inh/inh_1"',
      },
    });
    const rewritten = rewriteBearerChallengeScopes(original, ['room.read']);
    expect(rewritten.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token", scope="room.read", resource_metadata="https://mutualhouse.vercel.app/.well-known/oauth-protected-resource/mcp/inh/inh_1"'
    );
    expect(rewriteBearerChallengeScopes(original, [])).toBe(original);
    const notAResponse = { headers: new Headers() };
    expect(rewriteBearerChallengeScopes(notAResponse, ALL)).toBe(notAResponse);
  });

  it('steps up with the full entitled set only when re-auth can grant the missing scope', () => {
    const stepUp = mcpScopeStepUp(INHABITANT_GRANTS.ROOM_POST, ALL);
    expect(stepUp({ authInfo: { scopes: ['room.read'] } })).toEqual({
      scopes: ALL,
      errorDescription: 'Token lacks room.post scope.',
    });
    expect(stepUp({ authInfo: { scopes: ALL } })).toBeUndefined();
    const revoked = mcpScopeStepUp(INHABITANT_GRANTS.ROOM_POST, ['room.read']);
    expect(revoked({ authInfo: { scopes: ['room.read'] } })).toBeUndefined();
  });
});
