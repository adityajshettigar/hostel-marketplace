import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';

import { pool } from './db';
import { hashRefreshToken, verifyRefreshToken, jwtSigner } from './crypto';

// ---------------------------------------------------------------------------
// Token lifetimes
// ---------------------------------------------------------------------------

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes (short-lived)
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function toIso(ms: number, base = Date.now()): string {
  return new Date(base + ms).toISOString();
}

// ---------------------------------------------------------------------------
// Session table shape (identity schema)
// ---------------------------------------------------------------------------

export type SessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'REFRESHED';

const SESSION_TABLE = 'sessions';

export async function createSession(params: {
  userId: string;
  deviceFingerprint: string;
  ipAddress: string | null;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenHash: string;
  refreshTokenExpiresAt: string;
}): Promise<string> {
  const { userId, deviceFingerprint, ipAddress, accessToken, accessTokenExpiresAt, refreshTokenHash, refreshTokenExpiresAt } = params;
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO sessions (
      id, user_id, device_fingerprint, ip_address, access_token, access_token_expires_at, refresh_token_hash, refresh_token_expires_at, status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
    [
      id,
      userId,
      deviceFingerprint,
      ipAddress,
      accessToken,
      accessTokenExpiresAt,
      refreshTokenHash,
      refreshTokenExpiresAt,
      'ACTIVE' as const,
    ],
  );
  return id;
}

export async function getSession(sessionId: string) {
  return pool.query(
    `SELECT * FROM sessions WHERE id = $1`,
    [sessionId],
  );
}

export async function getSessionsByUserAndFingerprint(
  userId: string,
  fingerprintHash: string,
) {
  return pool.query(
    `SELECT * FROM sessions WHERE user_id = $1 AND device_fingerprint = $2`,
    [userId, fingerprintHash],
  );
}

export async function getActiveSessionByUserAndIp(
  userId: string,
  ipAddress: string,
) {
  return pool.query(
    `SELECT * FROM sessions
     WHERE user_id = $1 AND ip_address = $2 AND status = 'ACTIVE'`,
    [userId, ipAddress],
  ).then((res) => (res.rows[0] ?? null));
}

export async function updateSession(
  sessionId: string,
  set: { ipAddress?: string | null },
) {
  const allowed: Record<string, unknown> = {};
  if (set.ipAddress !== undefined) allowed['ip_address'] = set.ipAddress;
  if (Object.keys(allowed).length === 0) return;

  // Whitelisted column -> parameterised value; the keys come from the literal
  // object above, never from user input, so the interpolated column names are safe.
  const assignments = Object.entries(allowed)
    .map(([k], i) => `${k} = $${i + 1}`)
    .join(', ');

  await pool.query(
    `UPDATE sessions SET ${assignments}, updated_at = now() WHERE id = $${Object.keys(allowed).length + 1}`,
    [...Object.values(allowed), sessionId],
  );
}

export async function revokeSession(sessionId: string, reason: string) {
  await pool.query(
    `UPDATE sessions SET status = 'REVOKED', updated_at = now() WHERE id = $1`,
    [sessionId],
  );
}

export async function cleanupExpiredSessions() {
  await pool.query(
    `DELETE FROM sessions WHERE status = 'EXPIRED' OR refresh_token_expires_at < now() - interval '1 hour'`,
  );
}

// ---------------------------------------------------------------------------
// Device client registry (fingerprint -> hash binding)
// ---------------------------------------------------------------------------

export async function ensureClient(fingerprintHash: string) {
  const existing = await pool.query(
    `SELECT id FROM clients WHERE fingerprint_hash = $1`,
    [fingerprintHash],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO clients (id, fingerprint_hash, created_at, updated_at) VALUES ($1, $2, now(), now())`,
    [id, fingerprintHash],
  );
  return id;
}

export async function upsertClient(fingerprintHash: string) {
  await pool.query(
    `INSERT INTO clients (fingerprint_hash, created_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (fingerprint_hash) DO UPDATE SET updated_at = now()`,
    [fingerprintHash],
  );
}

export async function getClientByFingerprintHash(fingerprintHash: string) {
  return pool.query(
    `SELECT id FROM clients WHERE fingerprint_hash = $1`,
    [fingerprintHash],
  ).then((res) => (res.rows[0] ?? null));
}
