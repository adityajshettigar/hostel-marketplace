import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { pool } from '../db';
import { env } from '../env';
import { REFRESH_TOKEN_TTL_MS, toIso } from '../session';
import { hashRefreshToken } from '../crypto';
import { signingKid } from '../jwks-kid';

// ---------------------------------------------------------------------------
// Input validation (Zod, strict)
// ---------------------------------------------------------------------------

const refreshBodySchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required')
    .max(256, 'Refresh token is too long'),
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: { refreshToken: string };
  try {
    body = refreshBodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // 1. Look up the session by the CURRENT refresh-token hash. A token that is
  //    not the current one for any session is either garbage, expired-
  //    cleaned, or a REPLAY of a previously-superseded token (theft signal).
  const providedHash = hashRefreshToken(body.refreshToken);
  const current = await pool.query(
    `SELECT id, user_id, status, superseded_refresh_hashes
     FROM sessions WHERE refresh_token_hash = $1`,
    [providedHash],
  );
  const session = current.rows[0] as
    | { id: string; user_id: string; status: string; superseded_refresh_hashes: string[] }
    | undefined;

  if (!session) {
    // Not the current token of any session: it may be a REPLAY of an already
    // superseded token (theft signal). The hash identifies the family, so
    // scan unrevoked sessions' superseded history for it.
    const replay = await pool.query(
      `SELECT id, user_id FROM sessions
       WHERE status NOT IN ('REVOKED', 'EXPIRED')
         AND superseded_refresh_hashes @> ARRAY[$1::text]
       LIMIT 1`,
      [providedHash],
    );
    if (replay.rows[0]) {
      // Reuse of an already-rotated token: revoke the ENTIRE family
      // (every session of that user, matching the original design).
      await pool.query(
        `UPDATE sessions SET status = 'REVOKED', updated_at = now() WHERE user_id = $1`,
        [replay.rows[0].user_id],
      );
      return NextResponse.json(
        { error: 'REFRESH_TOKEN_REUSED', message: 'This refresh token was already used. All active sessions have been revoked.' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' },
      { status: 401 },
    );
  }

  // 2. Terminal states never rotate.
  if (session.status === 'REVOKED' || session.status === 'EXPIRED') {
    return NextResponse.json(
      { error: 'REFRESH_TOKEN_REUSED', message: 'This refresh token was already used. All active sessions have been revoked.' },
      { status: 401 },
    );
  }

  // 3. M1 FIX: rotation no longer flips the row to REFRESHED (that made the
  //    SECOND legitimate refresh of a session look like reuse). The row stays
  //    ACTIVE for its whole lifetime; the previous current hash moves into
  //    superseded_refresh_hashes and the current hash rotates in place.
  const newRefreshToken = crypto.randomUUID();
  const newHash = hashRefreshToken(newRefreshToken);
  const refreshTokenExpiresAt = toIso(REFRESH_TOKEN_TTL_MS);

  // Claims are re-read from the users row on every refresh: role so a change
  // made from the admin console takes effect on the very next refresh, and
  // hostelBlock so the MH/LH trade-segregation checks downstream keep working
  // after the original 15-minute access token expires.
  const userRes = await pool.query(
    `SELECT email, full_name AS "fullName", hostel_block AS "hostelBlock",
            room_number AS "roomNumber", upi_vpa AS "upiVpa", role
     FROM users WHERE id = $1`,
    [session.user_id],
  );
  const u = userRes.rows[0];
  const accessToken = jwt.sign(
    {
      sub: session.user_id,
      email: u?.email,
      fullName: u?.fullName,
      hostelBlock: u?.hostelBlock,
      roomNumber: u?.roomNumber,
      upiVpa: u?.upiVpa ?? null,
      role: u?.role === 'admin' ? 'admin' : 'user',
      type: 'access',
    },
    env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', keyid: signingKid(), expiresIn: '15m', issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE },
  );

  const updated = await pool.query(
    `UPDATE sessions
     SET refresh_token_hash = $1,
         superseded_refresh_hashes = superseded_refresh_hashes || $2::text[],
         refresh_token_expires_at = $3,
         status = 'ACTIVE',
         updated_at = now()
     WHERE id = $4 AND refresh_token_hash = $5
     RETURNING id`,
    [newHash, [providedHash], refreshTokenExpiresAt, session.id, providedHash],
  );

  if (updated.rows.length === 0) {
    // Raced with a concurrent rotation (the exact theft scenario): treat as
    // replay and revoke the family.
    await pool.query(
      `UPDATE sessions SET status = 'REVOKED', updated_at = now() WHERE user_id = $1`,
      [session.user_id],
    );
    return NextResponse.json(
      { error: 'REFRESH_TOKEN_REUSED', message: 'This refresh token was already used. All active sessions have been revoked.' },
      { status: 401 },
    );
  }

  // 4. Return the new tokens; the previous refresh token is now superseded
  //    (replaying it triggers the family revocation in step 1).
  return NextResponse.json({
    accessToken,
    refreshToken: newRefreshToken,
    tokenType: 'Bearer',
    expiresIn: 15 * 60,
  });
}
