import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { pool } from './db';
import { bearerToken, verifyAccessTokenAsync, AuthContext } from './auth';
import { env } from './env';
import { withSecurity } from '@/lib/security';

export function jsonError(status: number, error: string, message?: string, request?: Request) {
  const r = NextResponse.json({ error, message }, { status });
  return request ? withSecurity(r, request) : r;
}
export const notFound = (request?: Request) =>
  jsonError(404, 'NOT_FOUND', 'The requested resource does not exist', request);

export async function internalError(scope: string, err: unknown, request?: Request) {
  console.error(`[marketplace:${scope}]`, err);
  return jsonError(500, 'INTERNAL', 'Internal server error', request);
}

// ---------------------------------------------------------------------------
// JWT guards
// ---------------------------------------------------------------------------

export async function requireAuth(
  request: Request,
): Promise<{ auth: AuthContext } | { response: NextResponse }> {
  const token = bearerToken(request);
  if (!token) {
    return { response: jsonError(401, 'UNAUTHORIZED', 'Missing Bearer token', request) };
  }
  const auth = await verifyAccessTokenAsync(token);
  if (!auth) {
    return { response: jsonError(401, 'UNAUTHORIZED', 'Invalid or expired token', request) };
  }
  return { auth };
}

// Seller guard: JWT must verify AND the account must be VERIFIED per
// identity-service. Claim-first if identity-service embeds the claim;
// otherwise fall back to its authoritative /api/users/:id/public endpoint.
export async function requireVerifiedSeller(
  request: Request,
): Promise<{ auth: AuthContext } | { response: NextResponse }> {
  const r = await requireAuth(request);
  if ('response' in r) return r;
  const { auth } = r;

  if (auth.verificationStatus === 'VERIFIED') return { auth };

  // VERIFIED enforcement per user decision Q4: keep the REST call to
  // identity-service /api/users/:id/public (field confirmed present there).
  // Audit Step 2a: present the shared x-service-key (identity gates direct
  // traffic since the N2 fix).
  try {
    const res = await fetch(`${env.IDENTITY_SERVICE_URL}/api/users/${auth.sub}/public`, {
      headers: { 'x-service-key': env.INTERNAL_SERVICE_API_KEY },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const body = (await res.json()) as { verificationStatus?: string };
      if (body.verificationStatus === 'VERIFIED') return { auth };
      // identity answered but the account is not VERIFIED -> 403.
      return {
        response: jsonError(
          403,
          'SELLER_NOT_VERIFIED',
          'Only VERIFIED students can publish or edit listings. Complete email verification first.',
        ),
      };
    }
    // identity reachable but errored (5xx) -> fail closed with 503.
    return {
      response: jsonError(503, 'IDENTITY_UNAVAILABLE', 'Cannot verify seller status; try again'),
    };
  } catch {
    // identity-service unreachable -> fail closed with 503 (Step 3b).
    return {
      response: jsonError(503, 'IDENTITY_UNAVAILABLE', 'Cannot verify seller status; try again'),
    };
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type ListingRow = {
  id: string;
  seller_id: string;
  seller_block: string; // denormalised at creation — source of the MH/LH group
  title: string;
  description: string | null;
  category: string;
  condition: string;
  price: string; // pg numeric arrives as string
  quantity: number;
  image_urls: string[] | null;
  status: string;
  /** TRUE only for the simulated demonstration listing (see db/schema.sql). */
  demo: boolean;
  created_at: Date;
  updated_at: Date;
};

export type OfferRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  offered_price: string;
  quantity: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'WITHDRAWN' | 'EXPIRED';
  counter_of: string | null;
  created_at: Date;
  updated_at: Date;
};

// Cheap UUID-shape guard for id path segments. Without it a malformed id
// (e.g. GET /api/listings/not-a-uuid) reached Postgres and raised `invalid
// input syntax for type uuid`, which surfaced as a 500 plus a logged
// exception. An id that CANNOT exist is treated exactly like one that does
// not: the callers' existing `notFound` mapping answers 404 NOT_FOUND, the
// same answer the cross-hostel isolation path gives (no existence leak).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getListingRow(id: string): Promise<ListingRow | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await pool.query(
    `SELECT id, seller_id, seller_block, title, description, category, condition, price, quantity,
            image_urls, status, demo, created_at, updated_at
     FROM listings WHERE id = $1`,
    [id],
  );
  return (res.rows[0] as ListingRow) ?? null;
}

export async function getOfferRow(id: string): Promise<OfferRow | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await pool.query(
    `SELECT id, listing_id, buyer_id, offered_price, quantity, status, counter_of,
            created_at, updated_at
     FROM offers WHERE id = $1`,
    [id],
  );
  return (res.rows[0] as OfferRow) ?? null;
}

// ---------------------------------------------------------------------------
// Body/query parsing
// ---------------------------------------------------------------------------

export async function parseJsonBody<T>(request: Request, schema: ZodSchema<T>) {
  try {
    return { ok: true as const, data: await schema.parseAsync(await request.json()) };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false as const,
        response: jsonError(
          400,
          'VALIDATION_ERROR',
          err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        ),
      };
    }
    return { ok: false as const, response: jsonError(400, 'INVALID_BODY', 'Request body is not valid JSON') };
  }
}

export function parseQuery<T>(url: URL, schema: ZodSchema<T>) {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false as const,
      response: jsonError(
        400,
        'VALIDATION_ERROR',
        result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      ),
    };
  }
  return { ok: true as const, data: result.data };
}
