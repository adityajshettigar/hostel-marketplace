import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { pool } from '../db';
import { env } from '../env';

// ---------------------------------------------------------------------------
// Input validation (Zod, strict)
// ---------------------------------------------------------------------------

const logoutBodySchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required')
    .max(256, 'Refresh token is too long'),
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: { refreshToken: string };
  try {
    body = logoutBodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // 1. Revoke whatever session this refresh token currently holds. Only one
  //    session should hold a given refresh token at a time, so this is enough
  //    to kill it.
  const hash = crypto.createHash('sha256').update(body.refreshToken).digest('hex');
  await pool.query(
    `UPDATE sessions SET status = 'REVOKED', updated_at = now() WHERE refresh_token_hash = $1`,
    [hash],
  );

  // 2. Then revoke the whole session family (all live sessions of that user).
  //    If the token leaked and was already rotated, its children would still be
  //    ACTIVE and usable, so we kill the family as a defensive measure.
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    let payload: { sub?: string; exp?: number } | string;
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
      payload = decoded;
    } catch {
      return NextResponse.json({ message: 'Logged out' }, { status: 200 });
    }

    if (typeof payload === 'string') return NextResponse.json({ message: 'Logged out' }, { status: 200 });
    const userId = payload.sub;
    if (!userId) return NextResponse.json({ message: 'Logged out' }, { status: 200 });

    await pool.query(
      `UPDATE sessions SET status = 'REVOKED', updated_at = now() WHERE user_id = $1 AND status != 'REVOKED'`,
      [userId],
    );
  }

  return NextResponse.json({ message: 'Logged out' }, { status: 200 });
}
