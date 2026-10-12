import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from './env';

// ---------------------------------------------------------------------------
// JWT verification for the gateway: identity-service JWKS by kid, cached with
// a 10-minute TTL; JWT_PUBLIC_KEY env is the explicit fallback when the JWKS
// has no key for the kid. Same design as the services (established precedent).
// ---------------------------------------------------------------------------

export type AuthContext = {
  sub: string;
  email: string;
  fullName: string;
};

const JWKS_CACHE_MS = 10 * 60 * 1000; // mandated: 10-min TTL

type CachedJwks = { keys: (crypto.JsonWebKey & { kid?: string; alg?: string })[]; fetchedAt: number };

const globalForJwks = globalThis as unknown as {
  gatewayJwks?: { uri: string; cached: CachedJwks };
};

function jwksUri(): string {
  return `${env.SERVICE_IDENTITY_URL}/.well-known/jwks.json`;
}

function getJwksEntry() {
  const uri = jwksUri();
  if (!globalForJwks.gatewayJwks || globalForJwks.gatewayJwks.uri !== uri) {
    globalForJwks.gatewayJwks = { uri, cached: { keys: [], fetchedAt: 0 } };
  }
  return globalForJwks.gatewayJwks;
}

async function getKeyForKid(kid: string | undefined): Promise<string | null> {
  if (!kid) return null;
  const entry = getJwksEntry();
  const now = Date.now();

  if (now - entry.cached.fetchedAt > JWKS_CACHE_MS) {
    try {
      const res = await fetch(entry.uri, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const body = (await res.json()) as CachedJwks;
        entry.cached = { keys: body.keys, fetchedAt: now };
      }
    } catch {
      // network error -> keep whatever cache exists; may be empty
    }
  }

  const meta = entry.cached.keys.find((k) => k.kid === kid);
  if (!meta) return null;
  try {
    return crypto
      .createPublicKey({ key: meta, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
      .toString();
  } catch {
    return null;
  }
}

export async function verifyAccessToken(token: string): Promise<AuthContext | null> {
  let header: { kid?: string; alg?: string };
  try {
    const decoded = jwt.decode(token, { complete: true }) as {
      header: { kid?: string; alg?: string };
    } | null;
    if (!decoded) return null;
    header = decoded.header;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  let key: string | null = await getKeyForKid(header.kid);
  if (!key && env.JWT_PUBLIC_KEY) key = env.JWT_PUBLIC_KEY;
  if (!key) return null;

  try {
    const payload = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (typeof payload === 'string') return null;
    const p = payload as jwt.JwtPayload;
    return {
      sub: String(p.sub ?? ''),
      email: typeof p.email === 'string' ? p.email : '',
      fullName: typeof p.fullName === 'string' ? p.fullName : '',
    };
  } catch {
    return null;
  }
}

// Bearer token from Authorization header, or null.
export function bearerToken(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
