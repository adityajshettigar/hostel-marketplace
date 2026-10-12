import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { env } from './env';
import { bearerToken, verifyAccessTokenAsync, AuthContext } from './auth';

export function jsonError(status: number, error: string, message?: string) {
  return NextResponse.json({ error, message }, { status });
}

export const notFound = () =>
  jsonError(404, 'NOT_FOUND', 'The requested resource does not exist');

export async function internalError(scope: string, err: unknown) {
  console.error(`[transaction:${scope}]`, err);
  return jsonError(500, 'INTERNAL', 'Internal server error');
}

// ---------------------------------------------------------------------------
// JWT guard (RS256 via identity JWKS, env-key fallback)
// ---------------------------------------------------------------------------

export async function requireAuth(
  request: Request,
): Promise<{ auth: AuthContext } | { response: NextResponse }> {
  const token = bearerToken(request);
  if (!token) {
    return { response: jsonError(401, 'UNAUTHORIZED', 'Missing Bearer token') };
  }
  const auth = await verifyAccessTokenAsync(token);
  if (!auth) {
    return { response: jsonError(401, 'UNAUTHORIZED', 'Invalid or expired token') };
  }
  return { auth };
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export function parseQuery<T>(url: URL, schema: ZodSchema<T>) {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success || result.data === undefined) {
    return {
      ok: false as const,
      response: jsonError(
        400,
        'VALIDATION_ERROR',
        result.error?.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') ?? 'invalid query',
      ),
    };
  }
  return { ok: true as const, data: result.data };
}

// ---------------------------------------------------------------------------
// Admin guard (audit Q4): the JWT's SIGNED `role` claim minted by
// identity-service (from its ADMIN_USER_IDS allowlist) is authoritative when
// present. The local ADMIN_USER_IDS env list remains as a fallback for tokens
// minted before the role claim existed. No self-serve admin creation exists.
// ---------------------------------------------------------------------------

export function isAdminUserId(sub: string): boolean {
  const ids = env.ADMIN_USER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(sub);
}

export function requireAdmin(
  auth: AuthContext,
): NextResponse | null {
  const role = (auth as { role?: unknown }).role;
  if (typeof role === 'string' && role.length > 0) {
    if (role !== 'admin') {
      return jsonError(403, 'FORBIDDEN', 'Admin only');
    }
    return null;
  }
  // Legacy tokens without a role claim: fall back to the env allowlist.
  if (!isAdminUserId(auth.sub)) {
    return jsonError(403, 'FORBIDDEN', 'Admin only');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body parsing (ZodError → 400 VALIDATION_ERROR)
// ---------------------------------------------------------------------------

export async function parseJsonBody<T>(request: Request, schema: { parseAsync: (v: unknown) => Promise<T> }) {
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
