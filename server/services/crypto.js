import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT, jwtVerify, exportJWK, generateKeyPair as joseGenerateKeyPair } from 'jose';

let _masterKey = null;
let _jwtKeysPromise = null;

function getMasterKeyBuffer() {
  if (_masterKey) return _masterKey;
  const envHex = process.env.HOUSE_KEY_MASTER_SECRET || process.env.BETTER_AUTH_SECRET || '';
  if (envHex && envHex.length >= 32) {
    _masterKey = crypto.createHash('sha256').update(envHex).digest();
    return _masterKey;
  }
  const secretFile = path.resolve(process.cwd(), '.data', 'dev-master.key');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  if (fs.existsSync(secretFile)) {
    const raw = fs.readFileSync(secretFile, 'utf8').trim();
    _masterKey = crypto.createHash('sha256').update(raw).digest();
    return _masterKey;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  _masterKey = crypto.createHash('sha256').update(generated).digest();
  return _masterKey;
}

export function sha256HexNode(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function hmacSha256Hex(purpose, message) {
  const key = crypto.createHmac('sha256', getMasterKeyBuffer()).update(purpose).digest();
  return crypto.createHmac('sha256', key).update(String(message)).digest('hex');
}

export function randomId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function randomOpaqueToken(prefix = 'mh', byteLen = 24) {
  return `${prefix}_${crypto.randomBytes(byteLen).toString('base64url')}`;
}

/**
 * AES-256-GCM authenticated encryption for House Ed25519 private keys and
 * optional Phase 1b Door 4 BYOK provider credentials at rest in Postgres.
 */
export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKeyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(sealed) {
  const parts = String(sealed || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKeyBuffer(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return out.toString('utf8');
}

/**
 * Generates an Ed25519 House provenance signing keypair.
 */
export function generateHouseEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const pkcs8Pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return {
    publicKeyEd25519: Buffer.from(spkiDer).toString('base64url'),
    encryptedPrivateKeyEd25519: encryptSecret(pkcs8Pem),
  };
}

export function signWithHouseEd25519(encryptedPrivateKeyEd25519, canonicalPayload) {
  const pem = decryptSecret(encryptedPrivateKeyEd25519);
  const privKey = crypto.createPrivateKey(pem);
  const sig = crypto.sign(null, Buffer.from(String(canonicalPayload), 'utf8'), privKey);
  return `ed25519:MH1.${sig.toString('base64url')}`;
}

export function verifyWithHouseEd25519(publicKeyEd25519, canonicalPayload, signatureHeader) {
  try {
    const prefix = 'ed25519:MH1.';
    if (!String(signatureHeader || '').startsWith(prefix)) return false;
    const sigBuf = Buffer.from(String(signatureHeader).slice(prefix.length), 'base64url');
    const pubDer = Buffer.from(publicKeyEd25519, 'base64url');
    const pubKey = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(String(canonicalPayload), 'utf8'), pubKey, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Deterministic or persisted EdDSA (Ed25519) JWK pair for OAuth 2.1 MCP JWTs.
 */
async function getOAuthSigningKeys() {
  if (_jwtKeysPromise) return _jwtKeysPromise;
  _jwtKeysPromise = (async () => {
    const keyPath = path.resolve(process.cwd(), '.data', 'oauth-eddsa.json');
    if (process.env.VITEST !== 'true' && fs.existsSync(keyPath)) {
      const saved = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      const privateKey = crypto.createPrivateKey(saved.privatePem);
      const publicKey = crypto.createPublicKey(saved.publicPem);
      const publicJwk = await exportJWK(publicKey);
      publicJwk.kid = saved.kid;
      publicJwk.alg = 'EdDSA';
      publicJwk.use = 'sig';
      return { privateKey, publicKey, publicJwk, kid: saved.kid };
    }

    const { publicKey, privateKey } = await joseGenerateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const kid = 'mh-oauth-ed25519-1';
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'EdDSA';
    publicJwk.use = 'sig';

    if (process.env.VITEST !== 'true') {
      try {
        fs.mkdirSync(path.dirname(keyPath), { recursive: true });
        const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
        fs.writeFileSync(keyPath, JSON.stringify({ kid, privatePem, publicPem }), { mode: 0o600 });
      } catch {
        // Read-only serverless filesystem fallback uses in-memory keys safely alongside DB token row check
      }
    }
    return { privateKey, publicKey, publicJwk, kid };
  })();
  return _jwtKeysPromise;
}

export async function getOAuthJwksDocument() {
  const { publicJwk } = await getOAuthSigningKeys();
  return { keys: [publicJwk] };
}

export async function signMcpOAuthJwt({
  issuer,
  audience,
  inhabitantId,
  houseId,
  clientId,
  scopes,
  tokenId,
  ttlSeconds = 600,
}) {
  const { privateKey, kid } = await getOAuthSigningKeys();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  const jwt = await new SignJWT({
    inhabitant_id: inhabitantId,
    house_id: houseId,
    client_id: clientId,
    scope: scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(`inh:${inhabitantId}`)
    .setJti(tokenId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(privateKey);

  return { jwt, expiresAt };
}

export async function verifyMcpOAuthJwt(token, { issuer, expectedAudience }) {
  const { publicKey } = await getOAuthSigningKeys();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
    audience: expectedAudience,
  });
  return payload;
}
