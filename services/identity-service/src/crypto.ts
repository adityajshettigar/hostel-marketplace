import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { env } from './env';

// ---------------------------------------------------------------------------
// RSA-256 key pair (generated once, kept out of the repo)
// ---------------------------------------------------------------------------

// Keys are read lazily: env validation must not run while Next.js imports this
// module during `next build` (page-data collection has no runtime env vars).
function privateKeyPem(): string {
  return env.JWT_PRIVATE_KEY;
}

function publicKeyPem(): string {
  return env.JWT_PUBLIC_KEY;
}

// Sign/verify with RS256 (SHA-256 under RSA). kid/thumbprint is issued
// automatically by the jsonwebtoken engine.
export const jwtSigner = {
  sign: (payload: object, options?: jwt.SignOptions) =>
    jwt.sign(payload, privateKeyPem(), { algorithm: 'RS256', ...options }),
  verify: (token: string, options?: jwt.VerifyOptions) =>
    jwt.verify(token, publicKeyPem(), { algorithms: ['RS256'], ...options }),
  getPublicKeyPem: () => publicKeyPem(),
};

// ---------------------------------------------------------------------------
// JWKS endpoint wiring (used by other services + .well-known/jwks.json)
// ---------------------------------------------------------------------------

// jwks-rsa client is created lazily for the same reason (it reads JWT_ISSUER).
let cachedClient: ReturnType<typeof jwksClient> | undefined;

function getJwksClient() {
  if (!cachedClient) {
    cachedClient = jwksClient({
      jwksUri: `https://${env.JWT_ISSUER}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
      rateLimit: true,
      requestHeaders: { host: env.JWT_ISSUER },
    });
  }
  return cachedClient;
}

export function getSigningKey(kid: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!kid) {
      return reject(new Error('No kid in token header; cannot fetch signing key'));
    }
    getJwksClient().getSigningKey(kid, (err, key) => {
      if (err || !key) return reject(err ?? new Error('Key not found'));
      const signingKey = key.getPublicKey();
      if (!signingKey) return reject(new Error('Empty signing key'));
      resolve(signingKey);
    });
  });
}

// Unified verifier: prefer the cached JWKS key; fall back to the public key
// from the env var (the .well-known endpoint is the source of truth for other
// services; the env var is the bootstrap fallback when no network lookup is wanted).
export async function verifyJwt(token: string, options?: jwt.VerifyOptions) {
  const decoded = jwt.decode(token, { complete: true }) as
    | { header: { kid?: string }; payload?: unknown }
    | null;
  const kid = decoded?.header?.kid;

  if (kid) {
    try {
      const key = await getSigningKey(kid);
      return jwt.verify(token, key, { algorithms: ['RS256'], ...options });
    } catch {
      // Key was refreshed locally but not yet in the cache; fall through.
    }
  }

  return jwt.verify(token, publicKeyPem(), { algorithms: ['RS256'], ...options });
}

// ---------------------------------------------------------------------------
// Refresh token (rotating) hashing
// ---------------------------------------------------------------------------

// We cannot store the refresh token itself — it lives in an httpOnly cookie.
// Only its SHA-256 hash is persisted, so a DB leak does not leak usable tokens.
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Timing-safe comparison of two hex digests of equal intended length
// (M5 audit fix): a plain === leaks prefix-match information through
// early-exit; timingSafeEqual does not.
export function timingSafeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyRefreshToken(token: string, hash: string): boolean {
  return timingSafeHexEqual(hashRefreshToken(token), hash);
}

// ---------------------------------------------------------------------------
// Device fingerprint hashing
// ---------------------------------------------------------------------------

// Client-supplied fingerprint header -> SHA-256 binding stored in the DB so the
// service can detect that a different device tried to use the same credential
// (session binding), while the raw header never touches storage.
export function hashFingerprint(fingerprint: string): string {
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}
