import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, jsonError, internalError } from '../handlers';

// ---------------------------------------------------------------------------
// PATCH /api/suggestions/:id/accept — the seller tells the system they kept
// the suggestion (accepted_by_user = TRUE). Owner-only; idempotent (already
// accepted returns the row unchanged with accepted: true).
// ---------------------------------------------------------------------------

export async function acceptSuggestion(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query(
      `UPDATE suggestions SET accepted_by_user = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, kind, suggestion, model_version, fallback_used,
                 accepted_by_user, created_at`,
      [id, auth.auth.sub],
    );
    if (!res.rows[0]) {
      // Not mine or not found — no existence leak.
      return jsonError(404, 'NOT_FOUND', 'Suggestion not found for this user');
    }
    const row = res.rows[0] as Record<string, unknown>;
    return NextResponse.json({
      suggestion: {
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        suggestion: row.suggestion,
        modelVersion: row.model_version,
        fallbackUsed: row.fallback_used,
        acceptedByUser: row.accepted_by_user,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      },
      accepted: true,
    });
  } catch (err) {
    return internalError('acceptSuggestion', err);
  }
}
