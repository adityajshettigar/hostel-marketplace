import crypto from 'node:crypto';
import { env } from './env';

// ---------------------------------------------------------------------------
// RFC 7638 kid derivation, shared by the JWKS endpoint and every jwt.sign()
// call so tokens and /.well-known/jwks.json always agree on the kid.
// (jsonwebtoken v9 does NOT embed a kid by itself.)
// ---------------------------------------------------------------------------

let cachedKid: string | undefined;

export function signingKid(): string {
  if (!cachedKid) {
    const keyObject = crypto.createPublicKey(env.JWT_PUBLIC_KEY);
    const jwk = keyObject.export({ format: 'jwk' }) as { kty?: string; n?: string; e?: string };
    if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
      throw new Error('JWT_PUBLIC_KEY is not an RSA public key');
    }
    const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
    cachedKid = crypto.createHash('sha256').update(canonical).digest('base64url');
  }
  return cachedKid;
}

export function toRsaJwk(publicKeyPem: string): Record<string, string> | null {
  try {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    if (keyObject.asymmetricKeyType !== 'rsa') return null;
    const jwk = keyObject.export({ format: 'jwk' }) as { kty?: string; n?: string; e?: string };
    if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;
    const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
    const kid = crypto.createHash('sha256').update(canonical).digest('base64url');
    return { kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: jwk.n, e: jwk.e };
  } catch {
    return null;
  }
}
