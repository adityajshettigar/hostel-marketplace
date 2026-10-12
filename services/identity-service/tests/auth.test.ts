import { describe, expect, it } from 'vitest';
import {
  BASE_URL,
  login,
  refresh,
  registerUser,
  setUserRole,
  listUsers,
  setUserRoleApi,
  uniqueEmail,
} from './helpers';

// ---------------------------------------------------------------------------
// Identity-service integration tests (audit Step 2e).
// Requires: real compose Postgres + Redis, live identity server, JWKS keys.
// npm run test:integration wires all of that up in one command.
//
// Email-auth teardown: registration → login is now a straight email+password
// flow (no verification link, no 2FA). Authorization is admin-side: the
// userbase routes (GET /api/users, PATCH /api/users/:id/role) are covered
// below and are gated on the signed `role` claim sourced from users.role.
// ---------------------------------------------------------------------------

// Unique per test: the limiter counts per IP over 60s and Redis persists
// across runs, so fixed IPs would leak counters between runs/tests.
const ipCounter = { n: 0 };
function uniqueIp(): string {
  ipCounter.n += 1;
  return `10.${(Date.now() / 1000) % 200 | 0}.${process.pid % 200}.${ipCounter.n}`;
}

async function createActiveUser(password = 'Str0ng!pass1'): Promise<string> {
  const email = uniqueEmail();
  const reg = await registerUser(email, password);
  expect(reg.status).toBe(201);
  return email;
}

function decodeClaims(token: string): { sub?: string; role?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// 1. register -> immediate login -> refresh rotation (no email verification)
describe('register -> login -> refresh', () => {
  it('happy path; registration is immediately usable (no email verification)', async () => {
    const email = uniqueEmail();
    const reg = await registerUser(email, 'Str0ng!pass1');
    expect(reg.status).toBe(201);
    expect(reg.body.verificationStatus).toBe('VERIFIED');

    // Straight in — no verification link, no 2FA challenge.
    const first = await login(email, 'Str0ng!pass1', uniqueIp());
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(decodeClaims(first.body.accessToken).role).toBe('user');

    // Refresh rotation issues a NEW refresh token.
    const rf = await refresh(first.body.refreshToken);
    expect(rf.status).toBe(200);
    expect(rf.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(rf.body.accessToken).toBeTruthy();
  });

  it('duplicate registration reports ACCOUNT_EXISTS without creating a second account', async () => {
    const email = uniqueEmail();
    expect((await registerUser(email, 'Str0ng!pass2')).status).toBe(201);
    const again = await registerUser(email, 'Str0ng!pass2');
    expect(again.status).toBe(200);
    expect(again.body.error).toBe('ACCOUNT_EXISTS');
  });

  it('wrong password rejected (401 INVALID_CREDENTIALS)', async () => {
    const email = await createActiveUser('Str0ng!pass3');
    const lg = await login(email, 'Wr0ng!pass9', uniqueIp());
    expect(lg.status).toBe(401);
    expect(lg.body.error).toBe('INVALID_CREDENTIALS');
  });
});

// 2. Admin userbase: role claim from users.role + the admin-only routes.
describe('admin userbase (role claim + list/role routes)', () => {
  it('promoting in the DB mints an admin claim; non-admins are refused the list', async () => {
    const adminEmail = await createActiveUser('Str0ng!passA');
    await setUserRole(adminEmail, 'admin');
    const adminLogin = await login(adminEmail, 'Str0ng!passA', uniqueIp());
    expect(adminLogin.status).toBe(200);
    expect(decodeClaims(adminLogin.body.accessToken).role).toBe('admin');

    // A freshly registered account that never logged in is NOT in the list.
    const neverLoggedIn = uniqueEmail();
    expect((await registerUser(neverLoggedIn, 'Str0ng!passB')).status).toBe(201);

    const list = await listUsers(adminLogin.body.accessToken);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.users)).toBe(true);
    const emails = list.body.users.map((u: { email: string }) => u.email);
    expect(emails).toContain(adminEmail);
    expect(emails).not.toContain(neverLoggedIn);

    // Plain user: 403 at the admin gate.
    const plainEmail = await createActiveUser('Str0ng!passC');
    const plainLogin = await login(plainEmail, 'Str0ng!passC', uniqueIp());
    expect(plainLogin.status).toBe(200);
    const denied = await listUsers(plainLogin.body.accessToken);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('FORBIDDEN');
  });

  it('role toggle promotes user -> admin and demotes admin -> user', async () => {
    // Admin (token) account.
    const adminEmail = await createActiveUser('Str0ng!passD');
    await setUserRole(adminEmail, 'admin');
    const adminLogin = await login(adminEmail, 'Str0ng!passD', uniqueIp());
    expect(adminLogin.status).toBe(200);

    // Target account.
    const targetEmail = await createActiveUser('Str0ng!passE');
    const targetLogin = await login(targetEmail, 'Str0ng!passE', uniqueIp());
    const targetId = decodeClaims(targetLogin.body.accessToken).sub as string;

    // user -> admin
    const up = await setUserRoleApi(adminLogin.body.accessToken, targetId, 'admin');
    expect(up.status).toBe(200);
    expect(up.body.user.role).toBe('admin');

    // The very next login carries the new claim.
    const asAdmin = await login(targetEmail, 'Str0ng!passE', uniqueIp());
    expect(decodeClaims(asAdmin.body.accessToken).role).toBe('admin');

    // admin -> user
    const down = await setUserRoleApi(adminLogin.body.accessToken, targetId, 'user');
    expect(down.status).toBe(200);
    expect(down.body.user.role).toBe('user');
    const asUser = await login(targetEmail, 'Str0ng!passE', uniqueIp());
    expect(decodeClaims(asUser.body.accessToken).role).toBe('user');
  });

  it('guards: self-demotion forbidden, invalid role 400, unknown user 404, missing token 401', async () => {
    const adminEmail = await createActiveUser('Str0ng!passF');
    await setUserRole(adminEmail, 'admin');
    const adminLogin = await login(adminEmail, 'Str0ng!passF', uniqueIp());
    const adminId = decodeClaims(adminLogin.body.accessToken).sub as string;

    const self = await setUserRoleApi(adminLogin.body.accessToken, adminId, 'user');
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('SELF_DEMOTION_FORBIDDEN');

    const badRole = await setUserRoleApi(adminLogin.body.accessToken, adminId, 'root' as 'user');
    expect(badRole.status).toBe(400);
    expect(badRole.body.error).toBe('VALIDATION_ERROR');

    const missing = await setUserRoleApi(adminLogin.body.accessToken, '00000000-0000-4000-8000-000000000000', 'admin');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('NOT_FOUND');

    const res = await fetch(`${BASE_URL}/api/users`, {
      headers: { 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key' },
    });
    expect(res.status).toBe(401);
  });
});

// 3. Rate limiting: 6th login attempt within a minute -> 429 + Retry-After
describe('rate limiting (5/min/IP)', () => {
  it('429 with Retry-After on the 6th login from one IP', async () => {
    const email = await createActiveUser('Str0ng!pass5');
    const ip = uniqueIp();

    let hit = false;
    let raw: Response | null = null;
    for (let i = 0; i < 7; i++) {
      raw = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
        body: JSON.stringify({ email, password: 'Str0ng!pass5', fingerprint: `fp-${i}` }),
      });
      if (raw.status === 429) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
    expect(raw?.headers.get('retry-after')).toBeTruthy();
  });
});

// 4. College-domain rejection
describe('college-domain allow-list', () => {
  it('rejects non-college email domains (400)', async () => {
    const r = await registerUser('outsider@gmail.com', 'Str0ng!pass6');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('VALIDATION_ERROR');
  });
});

// 5. JWKS endpoint verifies a real issued token
describe('JWKS', () => {
  it('serves RSA keys and cryptographically verifies an issued token', async () => {
    const email = await createActiveUser('Str0ng!pass7');
    const first = await login(email, 'Str0ng!pass7', uniqueIp());
    expect(first.status).toBe(200);
    const accessToken = first.body.accessToken as string;

    const jwksRes = await fetch(`${BASE_URL}/.well-known/jwks.json`); // jwks is exempt from the service-key gate
    expect(jwksRes.status).toBe(200);
    const jwks = (await jwksRes.json()) as {
      keys: Array<{ kty: string; kid: string }>;
    };
    expect(jwks.keys.length).toBeGreaterThan(0);
    expect(jwks.keys[0].kty).toBe('RSA');

    const header = JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString());
    expect(jwks.keys.some((k) => k.kid === header.kid)).toBe(true);

    const { createPublicKey } = await import('node:crypto');
    const jwtVerify = (await import('jsonwebtoken')).default;
    const key = createPublicKey({ key: jwks.keys[0] as never, format: 'jwk' });
    const payload = jwtVerify.verify(accessToken, key, {
      algorithms: ['RS256'],
      issuer: 'identity-service',
      audience: 'hostel-marketplace',
    }) as { sub: string };
    expect(payload.sub).toBeTruthy();
  });
});
