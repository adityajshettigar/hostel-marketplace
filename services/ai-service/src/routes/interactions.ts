import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, parseJsonBody, internalError } from '../handlers';
import { interactionCreateSchema } from '../schemas';

// ---------------------------------------------------------------------------
// POST /api/interactions — behavior log feeding the E7.11 baseline
// recommender. Any authenticated user logs their OWN view/search events
// (user_id always comes from the JWT sub — never from the body). Other
// services/frontend call this with the user's access token.
// ---------------------------------------------------------------------------

export async function createInteraction(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, interactionCreateSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const res = await pool.query(
      `INSERT INTO interactions (user_id, kind, category, query, listing_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, kind, category, query, listing_id, created_at`,
      [auth.auth.sub, b.kind, b.category ?? null, b.query ?? null, b.listingId ?? null],
    );
    const row = res.rows[0] as Record<string, unknown>;

    return NextResponse.json(
      {
        interaction: {
          id: row.id,
          userId: row.user_id,
          kind: row.kind,
          category: row.category,
          query: row.query,
          listingId: row.listing_id,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return internalError('createInteraction', err);
  }
}
