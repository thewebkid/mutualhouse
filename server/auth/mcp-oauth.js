import crypto from 'node:crypto';
import {
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
} from '@modelcontextprotocol/server';
import {
  isCimdClientIdUrlCandidate,
  validateClientIdUrl,
  validateCimdMetadata,
} from '@better-auth/cimd';
import { INHABITANT_GRANTS } from '../../shared/models/inhabitant.js';
import {
  getOAuthJwksDocument,
  randomId,
  randomOpaqueToken,
  sha256HexNode,
  signMcpOAuthJwt,
  verifyMcpOAuthJwt,
} from '../services/crypto.js';

export const ALLOWED_MCP_SCOPES = Object.freeze([
  INHABITANT_GRANTS.ROOM_READ,
  INHABITANT_GRANTS.ROOM_POST,
  INHABITANT_GRANTS.MEMORY_PROPOSE,
]);

/**
 * Human steward privileges. An MCP connector must never be able to request these,
 * even by naming them in the authorization or registration request.
 */
const FORBIDDEN_MCP_SCOPES = Object.freeze([
  INHABITANT_GRANTS.SEAL_RELEASE,
  INHABITANT_GRANTS.ROOM_PAUSE,
  INHABITANT_GRANTS.MEMORY_CONFIRM,
  INHABITANT_GRANTS.CONSTITUTION_RATIFY,
  INHABITANT_GRANTS.CREDENTIAL_REVOKE,
  INHABITANT_GRANTS.HOUSE_MANAGE,
]);

export function parseScopeList(rawScope) {
  const text = Array.isArray(rawScope) ? rawScope.join(' ') : String(rawScope || '');
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rejectForbiddenMcpScopes(scopes) {
  for (const scope of scopes) {
    if (FORBIDDEN_MCP_SCOPES.includes(scope)) {
      throw new Error(`Scope "${scope}" is human-only and never granted to MCP connectors.`);
    }
  }
}

/** Live inhabitant grants that an MCP token is allowed to carry, in stable order. */
export function entitledMcpScopes(liveScopes = []) {
  const granted = new Set(liveScopes);
  return ALLOWED_MCP_SCOPES.filter((scope) => granted.has(scope));
}

/**
 * Scopes to advertise on a Bearer challenge.
 * When the inhabitant has MCP grants, advertise exactly those — clients treat
 * the challenge `scope` as authoritative and will not also request
 * `scopes_supported`. When nothing is known yet (unknown id, or no grants
 * loaded), advertise the full catalog so a connector is not stuck on `room.read`.
 */
export function advertisedMcpScopes(liveScopes = []) {
  const entitled = entitledMcpScopes(liveScopes);
  return entitled.length ? entitled : [...ALLOWED_MCP_SCOPES];
}

/**
 * Scopes delegated when a human approves an MCP connector.
 * Human-only scopes are rejected. The grant is whatever this inhabitant is
 * entitled to, not the narrower set a client echoed from an old challenge.
 */
export function scopesGrantedForMcpConsent(rawScopeString, liveScopes = []) {
  rejectForbiddenMcpScopes(parseScopeList(rawScopeString));
  const entitled = entitledMcpScopes(liveScopes);
  if (!entitled.length) {
    throw new Error('This AI inhabitant has no MCP grants to delegate.');
  }
  return entitled;
}

/**
 * Dynamic Client Registration `scope`.
 * Omitted or empty requests default to every supported MCP scope. An explicit
 * subset of supported scopes is preserved. Forbidden scopes are rejected.
 */
export function scopesForDynamicClientRegistration(rawScope) {
  const requested = parseScopeList(rawScope);
  if (!requested.length) return [...ALLOWED_MCP_SCOPES];
  rejectForbiddenMcpScopes(requested);
  const allowed = ALLOWED_MCP_SCOPES.filter((scope) => requested.includes(scope));
  return allowed.length ? allowed : [...ALLOWED_MCP_SCOPES];
}

/**
 * Per-tool step-up. Returns the inhabitant's full entitled scope set when the
 * token is missing a scope they are allowed to hold, so a client that replaces
 * (rather than unions) its scopes does not drop `room.read` on the way to
 * `room.post`. Returns undefined when the token is sufficient, or when the
 * inhabitant is not entitled (re-auth cannot help; the tool handler explains).
 */
export function mcpScopeStepUp(requiredScope, liveOrEntitledScopes = []) {
  const entitled = entitledMcpScopes(liveOrEntitledScopes);
  return ({ authInfo } = {}) => {
    const held = Array.isArray(authInfo?.scopes) ? authInfo.scopes : [];
    if (held.includes(requiredScope)) return undefined;
    if (!entitled.includes(requiredScope)) return undefined;
    return {
      scopes: entitled,
      errorDescription: `Token lacks ${requiredScope} scope.`,
    };
  };
}

/**
 * Replace the `scope` parameter on a Bearer `WWW-Authenticate` challenge.
 * `requireBearerAuth` copies `requiredScopes` into that parameter, and the
 * gate only requires `room.read` so read tools keep working. Callers pass the
 * inhabitant's advertised scopes so the 401 (and a gate-level 403) tells
 * clients to request the whole door.
 */
export function rewriteBearerChallengeScopes(response, scopes) {
  if (!(response instanceof Response)) return response;
  const scopesToAdvertise = Array.isArray(scopes) ? scopes.filter(Boolean) : [];
  if (!scopesToAdvertise.length) return response;
  const current = response.headers.get('www-authenticate');
  if (!current) return response;

  const scopeParam = `scope="${scopesToAdvertise.join(' ')}"`;
  let next = current;
  if (/\bscope="[^"]*"/.test(current)) {
    next = current.replace(/\bscope="[^"]*"/, scopeParam);
  } else if (/\bresource_metadata="/.test(current)) {
    next = current.replace(/\bresource_metadata="/, `${scopeParam}, resource_metadata="`);
  } else {
    next = `${current}, ${scopeParam}`;
  }
  if (next === current) return response;

  const headers = new Headers(response.headers);
  headers.set('www-authenticate', next);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function getOriginUrl(reqUrl) {
  const u = new URL(reqUrl);
  return `${u.protocol}//${u.host}`;
}

export function buildInhabitantResourceUrl(originUrl, inhabitantId) {
  return `${originUrl}/mcp/inh/${encodeURIComponent(inhabitantId)}`;
}

export function buildAuthServerMetadata(originUrl) {
  return {
    issuer: originUrl,
    authorization_endpoint: `${originUrl}/oauth/consent`,
    token_endpoint: `${originUrl}/oauth2/token`,
    registration_endpoint: `${originUrl}/oauth2/register`,
    jwks_uri: `${originUrl}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...ALLOWED_MCP_SCOPES],
    client_id_metadata_document_supported: true,
  };
}

/**
 * Builds RFC 9728 Protected Resource Metadata strictly for `/mcp/inh/:inhabitantId`
 * so `resource` equals the exact path-scoped inhabitant URL.
 */
export function buildInhabitantProtectedResourceMetadata(
  originUrl,
  inhabitant,
  scopesSupported = ALLOWED_MCP_SCOPES
) {
  const resourceUrl = new URL(buildInhabitantResourceUrl(originUrl, inhabitant.id));
  const isLocal =
    resourceUrl.hostname === 'localhost' || resourceUrl.hostname === '127.0.0.1';
  const scopes = scopesSupported?.length ? [...scopesSupported] : [...ALLOWED_MCP_SCOPES];
  return buildOAuthProtectedResourceMetadata({
    oauthMetadata: buildAuthServerMetadata(originUrl),
    resourceServerUrl: resourceUrl,
    scopesSupported: scopes,
    resourceName: `Mutual House · ${inhabitant.name}`,
    dangerouslyAllowInsecureIssuerUrl: isLocal,
  });
}

/**
 * Resolves an OAuth 2.1 client via:
 *  1. Pre-registered or DCR row in `oauth_clients`
 *  2. MCP `2026-07-28` Client ID Metadata Document (`@better-auth/cimd` validators)
 */
export async function resolveOAuthClient(db, clientId) {
  if (!clientId) return null;
  const { rows } = await db.query(`SELECT * FROM oauth_clients WHERE client_id = $1 LIMIT 1`, [
    clientId,
  ]);
  if (rows[0]) {
    return {
      clientId: rows[0].client_id,
      name: rows[0].client_name,
      redirectUris: rows[0].redirect_uris ?? [],
      tokenEndpointAuthMethod: rows[0].token_endpoint_auth_method,
    };
  }

  if (isCimdClientIdUrlCandidate(clientId)) {
    const urlErr = validateClientIdUrl(clientId);
    if (urlErr) throw new Error(`Invalid CIMD client_id URL: ${urlErr}`);

    const res = await fetch(clientId, {
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to fetch CIMD metadata (${res.status})`);
    const rawJson = await res.json();
    const checked = validateCimdMetadata(clientId, rawJson, {
      metadataProfile: 'mcp-2026-07-28',
    });
    if (!checked.valid) {
      throw new Error(`Invalid CIMD document: ${checked.error}`);
    }

    const meta = checked.metadata;
    await db.query(
      `INSERT INTO oauth_clients (
        client_id, client_name, redirect_uris, token_endpoint_auth_method, metadata_url
      ) VALUES ($1,$2,$3::jsonb,$4,$5)
      ON CONFLICT (client_id) DO UPDATE
        SET client_name = EXCLUDED.client_name,
            redirect_uris = EXCLUDED.redirect_uris`,
      [
        clientId,
        meta.client_name || clientId,
        JSON.stringify(meta.redirect_uris || []),
        meta.token_endpoint_auth_method || 'none',
        clientId,
      ]
    );
    return {
      clientId,
      name: meta.client_name || clientId,
      redirectUris: meta.redirect_uris || [],
      tokenEndpointAuthMethod: meta.token_endpoint_auth_method || 'none',
    };
  }

  // Fallback public PKCE client auto-registration for consumer connectors passing simple client_ids
  return {
    clientId,
    name: clientId,
    redirectUris: [],
    tokenEndpointAuthMethod: 'none',
  };
}

/**
 * Dynamic Client Registration (`POST /oauth2/register`) fallback for Grok web & 2025-era MCP hosts.
 */
export async function registerDynamicOAuthClient(db, body = {}) {
  const clientName = String(body.client_name || 'MCP Connector').slice(0, 120);
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirectUris.length) {
    throw new Error('redirect_uris is required for Dynamic Client Registration.');
  }
  const authMethod =
    body.token_endpoint_auth_method === 'client_secret_post' ? 'client_secret_post' : 'none';
  const clientId = randomOpaqueToken('mhc', 16);
  const clientSecret = authMethod === 'client_secret_post' ? randomOpaqueToken('mhs', 24) : null;
  const scopes = scopesForDynamicClientRegistration(body.scope);

  await db.query(
    `INSERT INTO oauth_clients (
      client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method
    ) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [
      clientId,
      clientSecret ? sha256HexNode(clientSecret) : null,
      clientName,
      JSON.stringify(redirectUris),
      authMethod,
    ]
  );

  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: scopes.join(' '),
  };
}

export function extractInhabitantIdFromResource(resourceUrl = '') {
  try {
    const u = new URL(resourceUrl);
    const m = u.pathname.match(/^\/mcp\/inh\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = String(resourceUrl).match(/\/mcp\/inh\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

export async function mintAuthorizationCode(
  db,
  {
    user,
    inhabitantId,
    clientId,
    redirectUri,
    resource,
    scopes,
    codeChallenge,
    codeChallengeMethod = 'S256',
  }
) {
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    throw new Error('OAuth 2.1 PKCE S256 code_challenge is required.');
  }

  const rawCode = randomOpaqueToken('mhcode', 24);
  const codeHash = sha256HexNode(rawCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.query(
    `INSERT INTO oauth_codes (
      code_hash, client_id, user_id, inhabitant_id, resource, scopes,
      redirect_uri, code_challenge, code_challenge_method, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'S256',$9)`,
    [
      codeHash,
      clientId,
      user.id,
      inhabitantId,
      resource,
      JSON.stringify(scopes),
      redirectUri,
      codeChallenge,
      expiresAt.toISOString(),
    ]
  );

  return rawCode;
}

export async function exchangeOAuthToken(db, { originUrl, grantType, params }) {
  if (grantType === 'authorization_code') {
    const codeHash = sha256HexNode(String(params.code || ''));
    const { rows } = await db.query(
      `UPDATE oauth_codes
       SET consumed_at = NOW()
       WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING *`,
      [codeHash]
    );
    const codeRow = rows[0];
    if (!codeRow) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Invalid or expired authorization code.');
    }
    if (params.redirect_uri && params.redirect_uri !== codeRow.redirect_uri) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'redirect_uri mismatch.');
    }
    if (params.client_id && params.client_id !== codeRow.client_id) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'client_id mismatch.');
    }

    // Verify PKCE S256 code_verifier
    const verifier = String(params.code_verifier || '');
    const computedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!verifier || computedChallenge !== codeRow.code_challenge) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'PKCE code_verifier check failed.');
    }

    if (params.resource && params.resource !== codeRow.resource) {
      throw new OAuthError(OAuthErrorCode.InvalidTarget, 'Requested resource does not match grant.');
    }

    const { rows: inhRows } = await db.query(`SELECT * FROM inhabitants WHERE id = $1`, [
      codeRow.inhabitant_id,
    ]);
    if (!inhRows[0]) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'AI inhabitant no longer exists.');
    }

    return issueTokenPair(db, {
      originUrl,
      clientId: codeRow.client_id,
      userId: codeRow.user_id,
      inhabitantId: codeRow.inhabitant_id,
      houseId: inhRows[0].house_id,
      resource: codeRow.resource,
      scopes: codeRow.scopes ?? [...ALLOWED_MCP_SCOPES],
    });
  }

  if (grantType === 'refresh_token') {
    const rawRefresh = String(params.refresh_token || '');
    const refreshHash = sha256HexNode(rawRefresh);

    const { rows } = await db.query(
      `SELECT * FROM oauth_tokens WHERE refresh_token_hash = $1 LIMIT 1`,
      [refreshHash]
    );
    const tokRow = rows[0];
    if (!tokRow) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Unknown refresh token.');
    }

    // `refreshTokenReuseInterval: 0` — strict replay detection!
    if (tokRow.revoked_at) {
      await db.query(
        `UPDATE oauth_tokens SET revoked_at = NOW() WHERE inhabitant_id = $1 AND client_id = $2`,
        [tokRow.inhabitant_id, tokRow.client_id]
      );
      throw new OAuthError(
        OAuthErrorCode.InvalidGrant,
        'Refresh token replay detected; lineage revoked.'
      );
    }
    if (tokRow.refresh_expires_at && new Date(tokRow.refresh_expires_at) <= new Date()) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'Refresh token expired.');
    }
    if (params.resource && params.resource !== tokRow.resource) {
      throw new OAuthError(OAuthErrorCode.InvalidTarget, 'Cannot change resource on refresh.');
    }

    await db.query(`UPDATE oauth_tokens SET revoked_at = NOW() WHERE id = $1`, [tokRow.id]);

    const { rows: inhRows } = await db.query(`SELECT * FROM inhabitants WHERE id = $1`, [
      tokRow.inhabitant_id,
    ]);
    if (!inhRows[0]) {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'AI inhabitant no longer exists.');
    }

    return issueTokenPair(db, {
      originUrl,
      clientId: tokRow.client_id,
      userId: tokRow.user_id,
      inhabitantId: tokRow.inhabitant_id,
      houseId: inhRows[0].house_id,
      resource: tokRow.resource,
      scopes: tokRow.scopes ?? [...ALLOWED_MCP_SCOPES],
      rotatedFromId: tokRow.id,
    });
  }

  throw new OAuthError(OAuthErrorCode.UnsupportedGrantType, `Unsupported grant_type: ${grantType}`);
}

async function issueTokenPair(
  db,
  { originUrl, clientId, userId, inhabitantId, houseId, resource, scopes, rotatedFromId = null }
) {
  const tokenId = randomId('tok');
  const { jwt, expiresAt } = await signMcpOAuthJwt({
    issuer: originUrl,
    audience: resource,
    inhabitantId,
    houseId,
    clientId,
    scopes,
    tokenId,
    ttlSeconds: 600, // 10 minutes
  });

  const rawRefresh = randomOpaqueToken('mhr', 32);
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO oauth_tokens (
      id, access_token_hash, refresh_token_hash, client_id, user_id,
      inhabitant_id, resource, scopes, expires_at, refresh_expires_at, rotated_from_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    [
      tokenId,
      sha256HexNode(jwt),
      sha256HexNode(rawRefresh),
      clientId,
      userId,
      inhabitantId,
      resource,
      JSON.stringify(scopes),
      new Date(expiresAt * 1000).toISOString(),
      refreshExpiresAt.toISOString(),
      rotatedFromId,
    ]
  );

  return {
    access_token: jwt,
    token_type: 'Bearer',
    expires_in: 600,
    refresh_token: rawRefresh,
    scope: scopes.join(' '),
  };
}

// =============================================================================
// DOOR 2 (`mh_...` AGENT RUNNER KEYS) & UNIFIED INHABITANT TOKEN VERIFIER
// =============================================================================

export async function mintInhabitantApiKeyInDb(db, { houseId, inhabitantId, label = 'Runner Key' }) {
  const rawKey = randomOpaqueToken('mh', 24);
  const prefix = rawKey.slice(0, 11);
  const keyHash = sha256HexNode(rawKey);
  const id = randomId('key');

  await db.query(
    `INSERT INTO inhabitant_api_keys (id, house_id, inhabitant_id, label, key_prefix, key_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, houseId, inhabitantId, String(label || 'Runner Key'), prefix, keyHash]
  );

  return { id, keyPrefix: prefix, apiKey: rawKey };
}

/**
 * Verifies a Bearer token for `/mcp/inh/:inhabitantId` (supports BOTH Door 1
 * OAuth 2.1 JWTs and Door 2 `mh_...` hashed runner keys) and checks live DB grants!
 */
export function createInhabitantTokenVerifier(db, { originUrl, expectedInhabitantId }) {
  const expectedResource = buildInhabitantResourceUrl(originUrl, expectedInhabitantId);

  return {
    expectedResource: new URL(expectedResource),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(expectedResource)),
    verifier: {
      async verifyAccessToken(token) {
        // Door 2: `mh_...` SHA-256 runner key
        if (String(token).startsWith('mh_')) {
          const keyHash = sha256HexNode(token);
          const { rows } = await db.query(
            `SELECT k.*, i.house_id, i.kind
             FROM inhabitant_api_keys k
             JOIN inhabitants i ON i.id = k.inhabitant_id
             WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND i.departed_at IS NULL
             LIMIT 1`,
            [keyHash]
          );
          const keyRow = rows[0];
          if (!keyRow || keyRow.inhabitant_id !== expectedInhabitantId || keyRow.kind !== 'ai') {
            throw new OAuthError(
              OAuthErrorCode.InvalidToken,
              'Invalid, revoked, or mismatched inhabitant runner key.'
            );
          }

          await db.query(`UPDATE inhabitant_api_keys SET last_used_at = NOW() WHERE id = $1`, [
            keyRow.id,
          ]);
          const liveScopes = await loadLiveInhabitantScopes(db, expectedInhabitantId);
          return {
            token,
            clientId: `runner:${keyRow.key_prefix}`,
            scopes: liveScopes,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            resource: new URL(expectedResource),
            extra: {
              inhabitantId: expectedInhabitantId,
              houseId: keyRow.house_id,
              doorType: 'agent_loop',
            },
          };
        }

        // Door 1: Path-scoped OAuth 2.1 JWT
        try {
          const claims = await verifyMcpOAuthJwt(token, {
            issuer: originUrl,
            expectedAudience: expectedResource,
          });
          if (claims.inhabitant_id !== expectedInhabitantId) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'Inhabitant audience mismatch.');
          }

          const { rows: tokRows } = await db.query(
            `SELECT t.id
             FROM oauth_tokens t
             JOIN inhabitants i ON i.id = t.inhabitant_id
             WHERE t.id = $1 AND t.revoked_at IS NULL AND i.departed_at IS NULL
             LIMIT 1`,
            [claims.jti]
          );
          if (!tokRows[0]) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, 'Access token has been revoked.');
          }

          const liveScopes = await loadLiveInhabitantScopes(db, expectedInhabitantId);
          const tokenScopes = String(claims.scope || '')
            .split(/\s+/)
            .filter((s) => liveScopes.includes(s));

          return {
            token,
            clientId: String(claims.client_id || 'mcp-oauth'),
            scopes: tokenScopes,
            expiresAt: Number(claims.exp),
            resource: new URL(expectedResource),
            extra: {
              inhabitantId: expectedInhabitantId,
              houseId: String(claims.house_id),
              doorType: 'human_prompt',
            },
          };
        } catch (err) {
          if (err instanceof OAuthError) throw err;
          throw new OAuthError(OAuthErrorCode.InvalidToken, err.message || 'Invalid OAuth token.');
        }
      },
    },
  };
}

export async function verifyDirectRunnerBearer(db, authHeader, expectedInhabitantId = null) {
  const m = String(authHeader || '').match(/^Bearer\s+(mh_[A-Za-z0-9_-]+)$/i);
  if (!m) return null;
  const keyHash = sha256HexNode(m[1]);
  const { rows } = await db.query(
    `SELECT k.*, i.house_id, i.kind
     FROM inhabitant_api_keys k
     JOIN inhabitants i ON i.id = k.inhabitant_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND i.departed_at IS NULL
     LIMIT 1`,
    [keyHash]
  );
  const row = rows[0];
  if (!row || row.kind !== 'ai') return null;
  if (expectedInhabitantId && row.inhabitant_id !== expectedInhabitantId) return null;
  await db.query(`UPDATE inhabitant_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id]);
  return {
    inhabitantId: row.inhabitant_id,
    houseId: row.house_id,
    keyId: row.id,
  };
}

export async function loadLiveInhabitantScopes(db, inhabitantId) {
  const { rows } = await db.query(
    `SELECT DISTINCT scope FROM inhabitant_grants WHERE inhabitant_id = $1`,
    [inhabitantId]
  );
  return rows.map((r) => r.scope);
}

export { getOAuthJwksDocument };
