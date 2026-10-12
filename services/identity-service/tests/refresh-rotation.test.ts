import { describe, it, expect } from 'vitest';
import { registerUser, login, refresh, uniqueEmail, db } from './helpers';

// ---------------------------------------------------------------------------
// M1 regression (audit Step 1b): a session must survive MANY sequential
// refreshes (each with the newest token), while replaying an already-
// superseded token must still trip REFRESH_TOKEN_REUSED and revoke the whole
// family. Runs against the REAL compose Postgres through the REAL endpoints
// (register -> login -> refresh x3; email authn is plain, no 2FA step).
// ---------------------------------------------------------------------------

async function fullLogin() {
  const email = uniqueEmail();
  const password = 'Testpass123!';
  expect((await registerUser(email, password)).status).toBe(201);

  const ip = `10.${(Date.now() / 1000) % 200 | 0}.${process.pid % 200}.${Math.floor(Math.random() * 250)}`;
  const done = await login(email, password, ip);
  expect(done.status).toBe(200);
  expect(done.body.accessToken).toBeTruthy();
  expect(done.body.refreshToken).toBeTruthy();
  return { email, accessToken: done.body.accessToken as string, refreshToken: done.body.refreshToken as string };
}

describe('refresh rotation (M1 regression, real compose PG)', () => {
  it('refresh x3 in sequence all succeed with new pairs; none trip REUSED', async () => {
    const { email, refreshToken: r0 } = await fullLogin();

    const r1 = await refresh(r0);
    expect(r1.status).toBe(200);
    expect(r1.body.error).toBeUndefined();
    expect(r1.body.refreshToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(r0);

    const r2 = await refresh(r1.body.refreshToken);
    expect(r2.status).toBe(200);
    expect(r2.body.error).toBeUndefined();

    const r3 = await refresh(r2.body.refreshToken);
    expect(r3.status).toBe(200);
    expect(r3.body.error).toBeUndefined();

    // The session row stayed ACTIVE through all three rotations.
    const c = await db();
    try {
      const s = await c.query(
        `SELECT status, array_length(superseded_refresh_hashes, 1) AS superseded
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.email = $1`,
        [email],
      );
      expect(s.rows[0].status).toBe('ACTIVE');
      expect(Number(s.rows[0].superseded)).toBe(3);
    } finally {
      c.end();
    }
  });

  it('replaying a SUPERSEDED token triggers REUSED and revokes the family', async () => {
    const { refreshToken: r0 } = await fullLogin();
    const r1 = await refresh(r0);
    expect(r1.status).toBe(200);
    const r2 = await refresh(r1.body.refreshToken);
    expect(r2.status).toBe(200);

    // r0 was superseded twice ago: replaying it is a theft signal.
    const replay = await refresh(r0);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('REFRESH_TOKEN_REUSED');

    // The family is gone: even the CURRENT token no longer refreshes.
    const after = await refresh(r2.body.refreshToken);
    expect(after.status).toBe(401);
    expect(after.body.error).toBe('REFRESH_TOKEN_REUSED');
  });

  it('unknown refresh tokens still get INVALID_REFRESH_TOKEN (no information leak)', async () => {
    const res = await refresh('not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_REFRESH_TOKEN');
  });
});
