import { NextResponse } from 'next/server';
import { z } from 'zod';

import { pool } from '../../../../../db';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// GET /api/users/[id]/public — least-privilege public profile
// ---------------------------------------------------------------------------
//
// Returns only non-sensitive fields (name, hostel block, verification badge)
// for other services to display a seller's public profile. UPI VPA and email
// are NEVER exposed here.

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    const r = NextResponse.json({ error: 'INVALID_USER_ID' }, { status: 400 });
    return withSecurity(r, request);
  }
  const { id } = parsed.data;

  const userRes = await pool.query(
    `SELECT full_name, hostel_block, room_number, verification_status
     FROM users WHERE id = $1`,
    [id],
  );

  if (!userRes.rows[0]) {
    const r = NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return withSecurity(r, request);
  }

  const publicProfile = {
    fullName: userRes.rows[0].full_name,
    hostelBlock: userRes.rows[0].hostel_block,
    roomNumber: userRes.rows[0].room_number,
    verificationStatus: userRes.rows[0].verification_status,
  };

  const r = NextResponse.json(publicProfile);
  return withSecurity(r, request);
}
