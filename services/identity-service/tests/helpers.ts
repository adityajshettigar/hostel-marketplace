import { Client } from 'pg';
import crypto from 'node:crypto';

// Vitest harness helpers for identity-service integration tests (audit 2e).
// Runs against the REAL compose Postgres (identity_app role) + Redis.
//
// Email-auth teardown: registration no longer needs a verification token and
// login no longer has a 2FA step — registerUser() + login() are now the whole
// happy path. Admin (userbase) tests flip users.role directly in the DB, which
// is exactly what the admin console's role toggle does through the API.

export const DB_URL =
  process.env.TEST_IDENTITY_DB_URL ||
  'postgresql://identity_app:id_dev_pw@localhost:15432/hostel_marketplace';
export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4001';

export async function db(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  return c;
}

export type TestUser = { id: string; email: string; password: string };

export async function registerUser(
  email: string,
  password: string,
  fullName = 'Test User',
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
    // Current registration contract (MH/LH segregation): a real hostel block
    // from the allow-list PLUS the matching group. The old fixture sent
    // `hostelBlock: 'MH-A'` (a legacy pre-segregation value) and no group, so
    // every registration was rejected with 400.
    body: JSON.stringify({
      email,
      password,
      fullName,
      hostelGroup: 'MH',
      hostelBlock: 'MH-1',
      roomNumber: '101',
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function login(
  email: string,
  password: string,
  ip: string,
  fingerprint = 'test-fp',
) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
    body: JSON.stringify({ email, password, fingerprint }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function refresh(refreshToken: string) {
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
    body: JSON.stringify({ refreshToken }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export function uniqueEmail(): string {
  return `idtest-${Date.now()}-${crypto.randomInt(1000, 9999)}@college.edu`;
}

// ---------------------------------------------------------------------------
// Admin (userbase) helpers — the API layer under test is
// GET /api/users and PATCH /api/users/:id/role, both gated on the signed
// `role` claim. To MINT an admin token the test promotes the user in the DB
// (the single source of truth) and then logs in, exactly like the real flow.
// ---------------------------------------------------------------------------

export async function setUserRole(email: string, role: 'user' | 'admin'): Promise<void> {
  const c = await db();
  try {
    await c.query(`UPDATE users SET role = $1, updated_at = now() WHERE email = $2`, [role, email]);
  } finally {
    c.end();
  }
}

export async function getUserRole(email: string): Promise<string | null> {
  const c = await db();
  try {
    const r = await c.query(`SELECT role FROM users WHERE email = $1`, [email]);
    return r.rows[0]?.role ?? null;
  } finally {
    c.end();
  }
}

function serviceKey(): Record<string, string> {
  return { 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key' };
}

/** GET /api/users — the admin userbase list. */
export async function listUsers(accessToken: string) {
  const res = await fetch(`${BASE_URL}/api/users`, {
    headers: { authorization: `Bearer ${accessToken}`, ...serviceKey() },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** PATCH /api/users/:id/role — the admin role toggle. */
export async function setUserRoleApi(
  accessToken: string,
  userId: string,
  role: 'user' | 'admin',
) {
  const res = await fetch(`${BASE_URL}/api/users/${userId}/role`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...serviceKey(),
    },
    body: JSON.stringify({ role }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
