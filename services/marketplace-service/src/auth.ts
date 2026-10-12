import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from './env';

// ---------------------------------------------------------------------------
// JWT verification for marketplace-service (audit Step 3a, user decision Q3):
//   1. Fetch identity-service's /.well-known/jwks.json, cache 10 minutes,
//      select the key by the token's `kid` header.
//   2. JWT_PUBLIC_KEY env is kept ONLY as an explicit fallback when JWKS
//      cannot provide a key for the kid (identity unreachable / key not found).
// Rejects wrong alg / issuer / audience / expired tokens via jwt.verify opts.
// ---------------------------------------------------------------------------

export type AuthContext = {
  sub: string;
  email: string;
  fullName: string;
  hostelBlock: string;
  roomNumber: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | null;
};

const JWKS_CACHE_MS = 10 * 60 * 1000;

type CachedJwks = { keys: JsonWebKey[] & { kid?: string; alg?: string }[]; fetchedAt: number };

const globalForJwks = globalThis as unknown as {
  marketplaceJwks?: { uri: string; cached: CachedJwks };
};

function jwksUri(): string {
  return `${env.IDENTITY_SERVICE_URL}/.well-known/jwks.json`;
}

function getJwksEntry() {
  const uri = jwksUri();
  if (!globalForJwks.marketplaceJwks || globalForJwks.marketplaceJwks.uri !== uri) {
    globalForJwks.marketplaceJwks = {
      uri,
      cached: { keys: [], fetchedAt: 0 },
    };
  }
  return globalForJwks.marketplaceJwks;
}

async function getKeyForKid(kid: string | undefined): Promise<string | null> {
  if (!kid) return null;
  const entry = getJwksEntry();
  const now = Date.now();

  // Refresh the raw JWKS at most every 10 minutes (explicit 10-min cache).
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

  const meta = entry.cached.keys.find((k) => (k as { kid?: string }).kid === kid);
  if (!meta) return null;
  try {
    const jwk = meta as unknown as crypto.JsonWebKey;
    return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({
      type: 'spki',
      format: 'pem',
    }).toString();
  } catch {
    return null;
  }
}

export async function verifyAccessTokenAsync(token: string): Promise<AuthContext | null> {
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

  // Wrong algorithm is rejected outright.
  if (header.alg !== 'RS256') return null;

  let key: string | null = await getKeyForKid(header.kid);

  // Explicit fallback: identity unreachable or kid unknown -> pinned env key.
  if (!key && env.JWT_PUBLIC_KEY) {
    key = env.JWT_PUBLIC_KEY;
  }
  if (!key) return null;

  try {
    const payload = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (typeof payload === 'string') return null;
    return toAuthContext(payload);
  } catch {
    return null;
  }
}

function toAuthContext(p: JwtPayload): AuthContext {
  return {
    sub: String(p.sub ?? ''),
    email: typeof p.email === 'string' ? p.email : '',
    fullName: typeof p.fullName === 'string' ? p.fullName : '',
    hostelBlock: typeof p.hostelBlock === 'string' ? p.hostelBlock : '',
    roomNumber: typeof p.roomNumber === 'string' ? p.roomNumber : '',
    verificationStatus:
      p.verificationStatus === 'VERIFIED' || p.verificationStatus === 'PENDING'
        ? p.verificationStatus
        : null,
  };
}

// Bearer token from Authorization header, or null.
export function bearerToken(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
