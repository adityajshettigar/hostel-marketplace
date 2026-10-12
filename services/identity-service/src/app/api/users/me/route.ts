import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { pool } from '../../../../db';
import { env } from '../../../../env';
import { signingKid } from '../../../../jwks-kid';
import { HOSTELS, hostelGroup } from '../../../../hostels';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// Profile (GET /api/users/me + PATCH /api/users/me)
// ---------------------------------------------------------------------------

const meSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  // Hostel must be one of the allowed MH-/LH- blocks (see src/hostels.ts).
  hostelBlock: z
    .string()
    .trim()
    .max(20)
    .refine(
      (v) => (HOSTELS as readonly string[]).includes(v),
      `hostelBlock must be one of: ${HOSTELS.join(', ')}`,
    )
    .optional(),
  roomNumber: z.string().trim().max(20).optional(),
  /**
   * Contact number for the physical handover. Kept deliberately permissive but
   * structural: an optional country code then 10-15 digits (spaces/dashes are
   * stripped before storage so the seller's dialog shows one canonical form).
   */
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => v === '' || /^\+?[0-9]{10,15}$/.test(v), 'Enter a valid phone number (10-15 digits, optional +country code)')
    .optional(),
  //
  // Real UPI VPAs are `localpart@psp` where the handle is a BANK/PSP code and
  // usually has NO dot at all — e.g. `aditya@ybl`, `name@okhdfcbank`,
  // `user@paytm`. The previous pattern demanded a dotted domain, so it
  // rejected perfectly valid handles and nobody could save their UPI id.
  upiVpa: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z][a-zA-Z0-9.-]*$/,
      'Invalid UPI VPA format (e.g. name@ybl or name@okhdfcbank)',
    )
    .max(120)
    .optional(),
});

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    const r = NextResponse.json({ error: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> is required' }, { status: 401 });
    return withSecurity(r, request);
  }

  let decoded: { sub?: string } | string;
  try {
    decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
  } catch {
    const r = NextResponse.json({ error: 'INVALID_TOKEN', message: 'Token is malformed' }, { status: 401 });
    return withSecurity(r, request);
  }

  if (typeof decoded === 'string') {
    const r = NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }
  const userId = typeof decoded === 'object' && decoded !== null ? (decoded as { sub?: string }).sub : undefined;
  if (!userId) {
    const r = NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }

  const userRes = await pool.query(
    `SELECT id, email, full_name, hostel_block, hostel_group, room_number, upi_vpa, phone, verification_status, role
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!userRes.rows[0]) {
    const r = NextResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
    return withSecurity(r, request);
  }

  const r = NextResponse.json(userRes.rows[0]);
  return withSecurity(r, request);
}

// ---------------------------------------------------------------------------
// PATCH /api/users/me
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    const r = NextResponse.json({ error: 'MISSING_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }

  let decoded: { sub?: string } | string;
  try {
    decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
  } catch {
    const r = NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }

  if (typeof decoded === 'string') {
    const r = NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }
  const userId = typeof decoded === 'object' && decoded !== null ? (decoded as { sub?: string }).sub : undefined;
  if (!userId) {
    const r = NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 401 });
    return withSecurity(r, request);
  }

  const body = meSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const r = NextResponse.json(
      { error: 'VALIDATION_ERROR', details: body.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
      { status: 400 },
    );
    return withSecurity(r, request);
  }

  // Changing hostels must never change the MH/LH GROUP: that boundary is what
  // keeps men's and ladies' trades apart. Same-group moves (MH-3 -> MH-5) are
  // fine; MH -> LH (or back) is refused. We read the current group from the
  // stored hostel_group column, not from the caller's JWT, so a stale/stolen
  // token cannot bypass the boundary.
  if (body.data.hostelBlock !== undefined) {
    const current = await pool.query(
      `SELECT hostel_block, hostel_group FROM users WHERE id = $1`,
      [userId],
    );
    if (!current.rows[0]) {
      const r = NextResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
      return withSecurity(r, request);
    }
    if (hostelGroup(body.data.hostelBlock) !== current.rows[0].hostel_group) {
      const r = NextResponse.json(
        { error: 'HOSTEL_GROUP_FIXED', message: 'You cannot move between the men\'s (MH) and ladies\' (LH) hostels. Contact an admin if this is wrong.' },
        { status: 403 },
      );
      return withSecurity(r, request);
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (body.data.fullName !== undefined) {
    updates.push(`full_name = $${i++}`);
    values.push(body.data.fullName);
  }
  if (body.data.hostelBlock !== undefined) {
    updates.push(`hostel_block = $${i++}`);
    values.push(body.data.hostelBlock);
  }
  if (body.data.roomNumber !== undefined) {
    updates.push(`room_number = $${i++}`);
    values.push(body.data.roomNumber);
  }
  if (body.data.phone !== undefined) {
    updates.push(`phone = $${i++}`);
    values.push(body.data.phone === '' ? null : body.data.phone);
  }
  if (body.data.upiVpa !== undefined) {
    updates.push(`upi_vpa = $${i++}`);
    values.push(body.data.upiVpa === '' ? null : body.data.upiVpa);
  }

  if (updates.length === 0) {
    const r = NextResponse.json({ error: 'NO_UPDATE_FIELDS', message: 'Provide at least one field to update' }, { status: 400 });
    return withSecurity(r, request);
  }

  values.push(userId);
  await pool.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i}`,
    values,
  );

  const updated = await pool.query(
    `SELECT id, email, full_name, hostel_block, hostel_group, room_number, upi_vpa, phone, verification_status, role
     FROM users WHERE id = $1`,
    [userId],
  );

  // Audit lapse-2 fix: mint a FRESH access token from the UPDATED row so
  // block-scoped queries (marketplace listings, conversations) see the new
  // hostelBlock immediately. Without this the old JWT's claims go stale until
  // re-login. The refresh token is untouched — same session, new claims.
  const u = updated.rows[0];
  const accessToken = jwt.sign(
    {
      sub: u.id,
      email: u.email,
      fullName: u.full_name,
      hostelBlock: u.hostel_block,
      hostelGroup: u.hostel_group,
      roomNumber: u.room_number,
      upiVpa: u.upi_vpa,
      // Signed role claim sourced from the users.role column (the admin
      // console's userbase page is the only place roles change).
      role: u.role === 'admin' ? 'admin' : 'user',
      type: 'access',
    },
    env.JWT_PRIVATE_KEY,
    {
      algorithm: 'RS256',
      keyid: signingKid(),
      expiresIn: '15m',
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );

  const r = NextResponse.json({ user: u, accessToken, tokenType: 'Bearer', expiresIn: 15 * 60 });
  return withSecurity(r, request);
}
