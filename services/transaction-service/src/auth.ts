import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from './env';

// ---------------------------------------------------------------------------
// JWT verification for transaction-service (same design as marketplace/
// communication/ai): JWKS by kid with 10-min cache; JWT_PUBLIC_KEY env is the
// explicit fallback when JWKS cannot provide a key for the kid.
// ---------------------------------------------------------------------------

export type AuthContext = {
  sub: string;
  email: string;
  fullName: string;
  hostelBlock: string;
  roomNumber: string;
  upiVpa: string;
  /** Signed role claim from identity-service (audit Q4): 'admin' | 'student'. */
  role?: string;
};

const JWKS_CACHE_MS = 10 * 60 * 1000;

type CachedJwks = { keys: JsonWebKey[] & { kid?: string; alg?: string }[]; fetchedAt: number };

const globalForJwks = globalThis as unknown as {
  txnJwks?: { uri: string; cached: CachedJwks };
};

function jwksUri(): string {
  return `${env.IDENTITY_SERVICE_URL}/.well-known/jwks.json`;
}

function getJwksEntry() {
  const uri = jwksUri();
  if (!globalForJwks.txnJwks || globalForJwks.txnJwks.uri !== uri) {
    globalForJwks.txnJwks = { uri, cached: { keys: [], fetchedAt: 0 } };
  }
  return globalForJwks.txnJwks;
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

  const meta = entry.cached.keys.find((k) => (k as { kid?: string }).kid === kid);
  if (!meta) return null;
  try {
    const jwk = meta as unknown as crypto.JsonWebKey;
    return crypto
      .createPublicKey({ key: jwk, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
      .toString();
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

  if (header.alg !== 'RS256') return null;

  let key: string | null = await getKeyForKid(header.kid);
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
    upiVpa: typeof p.upiVpa === 'string' ? p.upiVpa : '',
    role: typeof p.role === 'string' ? p.role : undefined,
  };
}

// Bearer token from Authorization header, or null.
export function bearerToken(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
