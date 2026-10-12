import { NextResponse } from 'next/server';
import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { pool } from '../db';
import { collegeDomains } from '../env';
import { HOSTELS, hostelGroup } from '../hostels';

// ---------------------------------------------------------------------------
// Input validation (Zod, strict: unexpected fields are rejected)
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase()
    .refine(
      (email) => {
        const domain = email.split('@')[1]?.toLowerCase() ?? '';
        return collegeDomains().includes(domain);
      },
      'Email domain not allowed (must be a college email address)',
    ),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p), 'Password must contain at least one letter, one number and one symbol'),
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name is required')
    .max(120, 'Full name is too long'),    hostelBlock: z.enum(HOSTELS, { message: 'Select your hostel' }),
    hostelGroup: z.enum(['MH', 'LH'], { message: 'Select your hostel group' }),
    roomNumber: z
      .string()
      .trim()
      .min(1, 'Room number is required'),
    // Same rule as PATCH /api/users/me: `localpart@psp` where the handle is
    // usually dotless (`name@ybl`, `name@okhdfcbank`).
    upiVpa: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9._+-]*@[a-zA-Z][a-zA-Z0-9.-]*$/,
        'Invalid UPI VPA format (e.g. name@ybl or name@okhdfcbank)',
      )
      .optional()
      .nullable()
      .default(null),
  }).refine(
    (data) => {
      const group = hostelGroup(data.hostelBlock);
      return group === data.hostelGroup;
    },
    {
      message: 'The selected hostel does not match the chosen hostel group',
      path: ['hostelGroup'],
    },
  );

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, { status: 400 });
  }

  const userId = uuidv4();

  // 1. Check for an existing user with this email (idempotent registration).
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [body.email]);
  if (existing.rows[0]) {
    // Already registered — return the account so the client can move straight
    // to logging in (no duplicate account is created).
    return NextResponse.json({ error: 'ACCOUNT_EXISTS', id: existing.rows[0].id }, { status: 200 });
  }

  // 2. Hash the password with argon2 (cost factor 10, time 2, memory 65536 kB).
  const passwordHash = await argon2.hash(body.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 2,
    parallelism: 1,
  });

  // 3. Insert the user. Simple email+password authn: no email verification
  //    step — authorization (user vs admin) is handled admin-side from the
  //    admin console's userbase page.
  await pool.query(    `INSERT INTO users (
        id, email, password_hash, full_name, hostel_block, hostel_group, room_number, upi_vpa, verification_status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VERIFIED', now(), now())`,
    [
      userId,
      body.email,
      passwordHash,
      body.fullName,
      body.hostelBlock,
      body.hostelGroup,
      body.roomNumber,
      body.upiVpa ?? null,
    ],
  );

  // Never trust the client's group label. Recompute it from the stored block
  // and compare against what was submitted, so a bad actor cannot register as
  // one group while picking a block from the other.
  const row = await pool.query<{ hostel_block: string; hostel_group: 'MH' | 'LH' }>(
    `SELECT hostel_block, hostel_group FROM users WHERE id = $1`,
    [userId],
  );
  if (!row.rows[0]) {
    return NextResponse.json({ error: 'REGISTRATION_FAILED' }, { status: 500 });
  }
  const actualGroup = hostelGroup(row.rows[0].hostel_block);
  if (actualGroup !== body.hostelGroup) {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return NextResponse.json(
      { error: 'REGISTRATION_REJECTED', message: 'Registration could not be completed. Try again.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      id: userId,
      email: body.email,
      fullName: body.fullName,
      hostelBlock: body.hostelBlock,
      roomNumber: body.roomNumber,
      upiVpa: body.upiVpa,
      hostelGroup: body.hostelGroup,
      verificationStatus: 'VERIFIED',
      message: 'Registration successful. You can now log in.',
    },
    { status: 201 },
  );
}
