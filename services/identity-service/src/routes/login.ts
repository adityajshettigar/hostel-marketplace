import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { pool } from '../db';
import { env } from '../env';
import { hashFingerprint, hashRefreshToken } from '../crypto';
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  toIso,
  createSession,
} from '../session';
import { rateLimit } from '../ratelimit';
import { signingKid } from '../jwks-kid';

// ---------------------------------------------------------------------------
// Input validation (Zod, strict)
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .toLowerCase(),
  password: z
    .string()
    .min(1, 'Password is required'),
  fingerprint: z.string().max(256).optional(),
});

const loginResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string(),
  hostelBlock: z.string(),
  roomNumber: z.string(),
  upiVpa: z.string().nullable(),
  verificationStatus: z.enum(['PENDING', 'VERIFIED']),
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Rate limit first (audit Step 2b): 5 req/min/IP, fail-closed when Redis is
  // down (user decision Q1). 429 + Retry-After when over the limit.
  const rl = await rateLimit(request, 'login');
  if (!rl.ok) return rl.response;

  let body: { email: string; password: string; fingerprint?: string };
  try {
    body = loginSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // 1. Fetch user. A missing user still pays the argon2 cost so response time
  //    does not reveal whether the email exists (prevents enumeration).
  const userRes = await pool.query(
    `SELECT id, email, password_hash,
            full_name AS "fullName",
            hostel_block AS "hostelBlock",
            room_number AS "roomNumber",
            upi_vpa AS "upiVpa",
            verification_status AS "verificationStatus",
            role
     FROM users WHERE email = $1`,
    [body.email],
  );

  if (!userRes.rows[0]) {
    // Deliberately run argon2 on a dummy hash so the response time is constant
    // for unknown users (prevents enumeration):
    const dummyHash = await argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
    await argon2.verify(dummyHash, 'dummy-password-for-timing');
    return NextResponse.json(
      { error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      { status: 401 },
    );
  }

  const user = userRes.rows[0];

  // 2. Verify password with argon2 (constant-time).
  const isCorrect = await argon2.verify(user.password_hash, body.password);
  if (!isCorrect) {
    return NextResponse.json(
      { error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      { status: 401 },
    );
  }

  // 3. Read the device fingerprint from the header (may be absent on old
  //    clients, in which case we generate one per device for binding the session).
  const rawFingerprint = body.fingerprint ?? `default-${crypto.randomUUID()}`;
  const fingerprintHash = hashFingerprint(rawFingerprint);
  await pool.query(
    `INSERT INTO clients (fingerprint_hash, created_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (fingerprint_hash) DO UPDATE SET updated_at = now()`,
    [fingerprintHash],
  );

  // 4. Client IP for the session row (behind the gateway: left-most
  //    x-forwarded-for entry, x-real-ip fallback).
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ipAddress = forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

  // 5. Bind the session to the device fingerprint (client registry + session row).
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      hostelBlock: user.hostelBlock,
      roomNumber: user.roomNumber,
      upiVpa: user.upiVpa,
      // Signed role claim: the users.role column is the ONLY source of truth
      // (admin promotes/demotes admins from the admin console userbase page).
      role: user.role === 'admin' ? 'admin' : 'user',
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

  const refreshToken = crypto.randomUUID();
  const refreshTokenHash = hashRefreshToken(refreshToken);

  const accessTokenExpiresAt = toIso(ACCESS_TOKEN_TTL_MS);
  const refreshTokenExpiresAt = toIso(REFRESH_TOKEN_TTL_MS);

  await createSession({
    userId: user.id,
    deviceFingerprint: fingerprintHash,
    ipAddress: ipAddress === 'unknown' ? null : ipAddress,
    accessToken,
    accessTokenExpiresAt,
    refreshTokenHash,
    refreshTokenExpiresAt,
  });

  // 6. Issue tokens + httpOnly cookie.
  const response = NextResponse.json({
    ...loginResponseSchema.parse({
      email: user.email,
      fullName: user.fullName,
      hostelBlock: user.hostelBlock,
      roomNumber: user.roomNumber,
      upiVpa: user.upiVpa,
      verificationStatus: user.verificationStatus,
    }),
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: 15 * 60,
    fingerprint: rawFingerprint,
  });

  // httpOnly, Secure (in prod behind TLS), SameSite=Lax, 7 days.
  response.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth/refresh',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}
