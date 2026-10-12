import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { bearerToken, verifyAccessTokenAsync, AuthContext } from './auth';
import { env } from './env';

export function jsonError(status: number, error: string, message?: string) {
  return NextResponse.json({ error, message }, { status });
}

export const notFound = () =>
  jsonError(404, 'NOT_FOUND', 'The requested resource does not exist');

export async function internalError(scope: string, err: unknown) {
  console.error(`[ai:${scope}]`, err);
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

export type SuggestionRow = {
  id: string;
  user_id: string;
  kind: 'LISTING' | 'PRICE';
  input_snapshot: Record<string, unknown>;
  suggestion: Record<string, unknown>;
  model_version: string;
  fallback_used: boolean;
  accepted_by_user: boolean;
  created_at: Date;
};

// Persist a suggestion exactly as it was returned (SRS AI-suggestion entity).
export async function logSuggestion(params: {
  userId: string;
  kind: 'LISTING' | 'PRICE';
  inputSnapshot: Record<string, unknown>;
  suggestion: Record<string, unknown>;
  modelVersion: string;
  fallbackUsed: boolean;
}): Promise<SuggestionRow | null> {
  try {
    const { pool } = await import('./db');
    const res = await pool.query(
      `INSERT INTO suggestions (user_id, kind, input_snapshot, suggestion, model_version, fallback_used)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
       RETURNING id, user_id, kind, input_snapshot, suggestion, model_version,
                 fallback_used, accepted_by_user, created_at`,
      [
        params.userId,
        params.kind,
        JSON.stringify(params.inputSnapshot),
        JSON.stringify(params.suggestion),
        params.modelVersion,
        params.fallbackUsed,
      ],
    );
    return res.rows[0] as SuggestionRow;
  } catch (err) {
    // Logging must never break the suggestion flow (SRS 7.12 spirit).
    console.error('[ai:logSuggestion]', err);
    return null;
  }
}

// re-export for internal-key style helpers if needed later
export const _timingSafeEqual = crypto.timingSafeEqual;
