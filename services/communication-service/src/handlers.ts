import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { pool } from './db';
import { bearerToken, verifyAccessTokenAsync, AuthContext } from './auth';
import { env } from './env';

export function jsonError(status: number, error: string, message?: string) {
  return NextResponse.json({ error, message }, { status });
}

export const notFound = () =>
  jsonError(404, 'NOT_FOUND', 'The requested resource does not exist');

export async function internalError(scope: string, err: unknown) {
  console.error(`[communication:${scope}]`, err);
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
// Internal service-to-service guard — POST /api/notifications ONLY.
// Shared API key header (x-internal-api-key), explicitly NOT a user JWT.
// Timing-safe compare; 501 when the deployer never configured a key.
// ---------------------------------------------------------------------------

export function requireInternalKey(request: Request): NextResponse | null {
  const configured = env.INTERNAL_SERVICE_API_KEY;
  if (!configured) {
    return jsonError(501, 'NOT_CONFIGURED', 'Internal API key is not configured');
  }
  const provided =
    request.headers.get('x-internal-api-key') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!provided) {
    return jsonError(401, 'UNAUTHORIZED', 'Missing x-internal-api-key header');
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return jsonError(401, 'UNAUTHORIZED', 'Invalid internal API key');
  }
  return null;
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

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type ConversationRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  created_at: Date;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  safety_result: 'SAFE' | 'CONTACT_INFO' | 'UPI_INFO' | 'OFF_PLATFORM_REQUEST';
  delivered: boolean;
  created_at: Date;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

export async function getConversationRow(id: string): Promise<ConversationRow | null> {
  const res = await pool.query(
    `SELECT id, listing_id, buyer_id, seller_id, created_at FROM conversations WHERE id = $1`,
    [id],
  );
  return (res.rows[0] as ConversationRow) ?? null;
}
