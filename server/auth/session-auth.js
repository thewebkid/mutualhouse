import crypto from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Resend } from 'resend';
import {
  randomId,
  randomOpaqueToken,
  sha256HexNode,
} from '../services/crypto.js';

const SESSION_COOKIE = 'mh_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const MAGIC_LINK_TTL_SEC = 60 * 20; // 20 minutes

export async function getSessionUser(c, db) {
  const rawToken = getCookie(c, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = sha256HexNode(rawToken);

  const { rows } = await db.query(
    `SELECT s.id AS session_id, u.id, u.email, u.name, u.email_verified,
            EXISTS(SELECT 1 FROM mh_passkeys p WHERE p.user_id = u.id) AS has_passkey
     FROM mh_sessions s
     JOIN mh_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    email: rows[0].email,
    name: rows[0].name,
    emailVerified: Boolean(rows[0].email_verified),
    hasPasskey: Boolean(rows[0].has_passkey),
    sessionId: rows[0].session_id,
  };
}

export async function issueBrowserSession(c, db, userId) {
  const rawToken = randomOpaqueToken('mhs', 32);
  const tokenHash = sha256HexNode(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);

  await db.query(
    `INSERT INTO mh_sessions (id, user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomId('sess'),
      userId,
      tokenHash,
      c.req.header('x-forwarded-for') || null,
      c.req.header('user-agent') || null,
      expiresAt.toISOString(),
    ]
  );

  const isHttps = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });

  return rawToken;
}

export async function destroyBrowserSession(c, db) {
  const rawToken = getCookie(c, SESSION_COOKIE);
  if (rawToken) {
    await db.query(`DELETE FROM mh_sessions WHERE token_hash = $1`, [sha256HexNode(rawToken)]);
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function createAndSendMagicLink(
  db,
  { originUrl, email, name = '', redirectTo = '/houses' }
) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please provide a valid email address.');
  }

  const rawToken = randomOpaqueToken('mhl', 24);
  const tokenHash = sha256HexNode(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SEC * 1000);

  await db.query(
    `INSERT INTO mh_magic_links (id, email, name, token_hash, redirect_to, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      randomId('ml'),
      cleanEmail,
      String(name || '').trim() || null,
      tokenHash,
      String(redirectTo || '/houses'),
      expiresAt.toISOString(),
    ]
  );

  const verifyUrl = `${originUrl}/auth/verify?token=${encodeURIComponent(rawToken)}&redirect=${encodeURIComponent(redirectTo || '/houses')}`;

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Mutual House <porch@mutualhouse.org>',
      to: cleanEmail,
      subject: 'Your door into The Mutual House',
      text: `Open this single-use link within 20 minutes to enter The Mutual House:\n\n${verifyUrl}\n\nIf you did not ask for this link, you may safely ignore it.`,
    });
    return { sent: true };
  }

  // Local development convenience: log & surface link when Resend isn't configured
  if (process.env.VITEST !== 'true') {
    console.info(`\n[Mutual House Dev Magic Link for ${cleanEmail}]:\n  ${verifyUrl}\n`);
  }
  return {
    sent: true,
    devVerifyUrl: verifyUrl,
    devToken: process.env.VITEST === 'true' ? rawToken : undefined,
  };
}

export async function consumeMagicLink(c, db, rawToken) {
  const tokenHash = sha256HexNode(String(rawToken || '').trim());
  const { rows } = await db.query(
    `UPDATE mh_magic_links
     SET consumed_at = NOW()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING *`,
    [tokenHash]
  );
  const ml = rows[0];
  if (!ml) {
    throw new Error('This sign-in link has expired or was already used.');
  }

  const fallbackName = ml.name || ml.email.split('@')[0];
  const { rows: userRows } = await db.query(
    `INSERT INTO mh_users (id, email, name, email_verified)
     VALUES ($1,$2,$3,TRUE)
     ON CONFLICT (email) DO UPDATE
       SET email_verified = TRUE,
           name = CASE WHEN mh_users.name = '' THEN EXCLUDED.name ELSE mh_users.name END,
           updated_at = NOW()
     RETURNING *`,
    [randomId('usr'), ml.email, fallbackName]
  );

  const user = userRows[0];
  await issueBrowserSession(c, db, user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: true,
    },
    redirectTo: ml.redirect_to || '/houses',
  };
}

// =============================================================================
// WEBAUTHN PASSKEYS (ECDSA P-256 / Ed25519 verification via Node 24 crypto)
// =============================================================================

export async function beginWebAuthnRegistration(db, { rpId, user, label = 'This device' }) {
  const challenge = crypto.randomBytes(32).toString('base64url');
  const challengeId = randomId('wac');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.query(
    `INSERT INTO mh_webauthn_challenges (id, user_id, challenge, purpose, expires_at)
     VALUES ($1,$2,$3,'register',$4)`,
    [challengeId, user.id, challenge, expiresAt.toISOString()]
  );

  const { rows: existing } = await db.query(
    `SELECT credential_id FROM mh_passkeys WHERE user_id = $1`,
    [user.id]
  );

  return {
    challengeId,
    label,
    options: {
      challenge,
      rp: { name: 'The Mutual House', id: rpId },
      user: {
        id: Buffer.from(user.id, 'utf8').toString('base64url'),
        name: user.email,
        displayName: user.name || user.email,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256
        { alg: -8, type: 'public-key' }, // EdDSA
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: existing.map((r) => ({
        id: r.credential_id,
        type: 'public-key',
      })),
    },
  };
}

export async function finishWebAuthnRegistration(
  db,
  {
    user,
    challengeId,
    credentialId,
    publicKeySpki,
    algorithm = -7,
    clientDataJSON,
    transports = [],
    label = 'This device',
  }
) {
  const { rows: chRows } = await db.query(
    `DELETE FROM mh_webauthn_challenges
     WHERE id = $1 AND user_id = $2 AND purpose = 'register' AND expires_at > NOW()
     RETURNING *`,
    [challengeId, user.id]
  );
  if (!chRows[0]) throw new Error('Passkey registration challenge expired.');

  const clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  if (clientData.type !== 'webauthn.create' || clientData.challenge !== chRows[0].challenge) {
    throw new Error('Passkey challenge mismatch.');
  }
  if (!credentialId || !publicKeySpki) {
    throw new Error('Browser did not supply SPKI public key for passkey.');
  }

  await db.query(
    `INSERT INTO mh_passkeys (
      id, user_id, credential_id, public_key_spki, algorithm, transports, label
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      randomId('pk'),
      user.id,
      credentialId,
      publicKeySpki,
      Number(algorithm || -7),
      JSON.stringify(Array.isArray(transports) ? transports : []),
      String(label || 'Passkey'),
    ]
  );

  return { ok: true };
}

export async function beginWebAuthnLogin(db, { rpId, email = '' }) {
  const challenge = crypto.randomBytes(32).toString('base64url');
  const challengeId = randomId('wac');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  let allowCredentials = [];
  if (email && String(email).includes('@')) {
    const { rows } = await db.query(
      `SELECT p.credential_id, p.transports
       FROM mh_passkeys p
       JOIN mh_users u ON u.id = p.user_id
       WHERE u.email = $1`,
      [String(email).trim().toLowerCase()]
    );
    allowCredentials = rows.map((r) => ({
      id: r.credential_id,
      type: 'public-key',
      transports: r.transports ?? [],
    }));
  }

  await db.query(
    `INSERT INTO mh_webauthn_challenges (id, challenge, purpose, expires_at)
     VALUES ($1,$2,'login',$3)`,
    [challengeId, challenge, expiresAt.toISOString()]
  );

  return {
    challengeId,
    options: {
      challenge,
      rpId,
      timeout: 60000,
      userVerification: 'preferred',
      ...(allowCredentials.length ? { allowCredentials } : {}),
    },
  };
}

export async function finishWebAuthnLogin(
  c,
  db,
  { challengeId, credentialId, authenticatorData, clientDataJSON, signature }
) {
  const { rows: chRows } = await db.query(
    `DELETE FROM mh_webauthn_challenges
     WHERE id = $1 AND purpose = 'login' AND expires_at > NOW()
     RETURNING *`,
    [challengeId]
  );
  if (!chRows[0]) throw new Error('Passkey sign-in challenge expired.');

  const clientDataBuf = Buffer.from(clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataBuf.toString('utf8'));
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== chRows[0].challenge) {
    throw new Error('Passkey challenge verification failed.');
  }

  const { rows: pkRows } = await db.query(
    `SELECT p.*, u.email, u.name
     FROM mh_passkeys p
     JOIN mh_users u ON u.id = p.user_id
     WHERE p.credential_id = $1
     LIMIT 1`,
    [credentialId]
  );
  const pk = pkRows[0];
  if (!pk) throw new Error('Unknown passkey credential.');

  const authDataBuf = Buffer.from(authenticatorData, 'base64url');
  const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
  const signedData = Buffer.concat([authDataBuf, clientDataHash]);
  const pubKey = crypto.createPublicKey({
    key: Buffer.from(pk.public_key_spki, 'base64url'),
    format: 'der',
    type: 'spki',
  });
  const sigBuf = Buffer.from(signature, 'base64url');

  const alg = Number(pk.algorithm) === -8 ? null : 'sha256';
  const valid = crypto.verify(alg, signedData, pubKey, sigBuf);
  if (!valid) throw new Error('Passkey cryptographic signature invalid.');

  await issueBrowserSession(c, db, pk.user_id);
  return {
    user: {
      id: pk.user_id,
      email: pk.email,
      name: pk.name,
      hasPasskey: true,
    },
  };
}
