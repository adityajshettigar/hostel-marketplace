import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gw, setup, TestHarness } from './setup';

// ---------------------------------------------------------------------------
// Phase 7 gateway integration tests (stubs + server via
// scripts/test-integration.sh, gateway on :14000).
// ---------------------------------------------------------------------------

let h: TestHarness;

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  // nothing to tear down (script owns process lifecycle)
});

describe('Phase 7 — gateway reverse proxy', () => {
  it('G1 forwards each mounted prefix to the matching service and strips the mount', async () => {
    for (const mount of ['marketplace', 'communication', 'transaction', 'ai']) {
      const res = await gw(h, 'POST', `/api/${mount}/echo`, { body: { hello: mount } });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.service).toBe(mount);
      expect(json.path).toBe('/api/echo'); // mount prefix stripped downstream
      expect(json.method).toBe('POST');
      expect(json.body).toEqual({ hello: mount });
    }
  });

  it('G2 requires a verified JWT on every route except /api/identity/auth/*', async () => {
    // No token → 401.
    const none = await gw(h, 'GET', '/api/marketplace/echo', { token: null });
    expect(none.status).toBe(401);

    // Garbage token → 401.
    const bad = await gw(h, 'GET', '/api/marketplace/echo', { token: 'not-a-jwt' });
    expect(bad.status).toBe(401);

    // Wrong issuer → 401 (verifies real signature/claims checking).
    const wrongIss = await gw(h, 'GET', '/api/marketplace/echo', {
      token: h.signToken({ sub: 'g1000000-0000-4000-8000-000000000001', iss: 'someone-else' }),
    });
    expect(wrongIss.status).toBe(401);

    // /api/identity/auth/* passes WITHOUT a token.
    const login = await gw(h, 'POST', '/api/identity/auth/login', { token: null, body: { email: 'x' } });
    expect(login.status).toBe(200);
    const loginJson = await login.json();
    expect(loginJson.service).toBe('identity'); // reached the identity stub
    expect(loginJson.authorization).toBeNull(); // nothing stripped/re-signed; header just absent

    // BUT /api/identity/offers (not under auth/) still requires a token.
    const idProtected = await gw(h, 'GET', '/api/identity/users/me', { token: null });
    expect(idProtected.status).toBe(401);

    // Valid token → forwarded with the ORIGINAL Authorization header intact.
    const ok = await gw(h, 'GET', '/api/marketplace/echo');
    expect(ok.status).toBe(200);
    const okJson = await ok.json();
    expect(okJson.authorization).toMatch(/^Bearer eyJ/); // untouched original
  });

  it('G3 adds X-Service-Key to forwarded requests (downstream stubs reject without it)', async () => {
    const res = await gw(h, 'GET', '/api/transaction/echo');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.serviceKey).toBe(h.serviceKey);

    // The stubs run with STUB_REQUIRE_KEY=1: a DIRECT call without the key
    // is rejected — proving the key the gateway adds is what lets it through.
    const direct = await fetch(`${h.stubUrls.transaction}/api/echo`);
    expect(direct.status).toBe(403);
  });

  it('G4 rate limits per IP (token bucket → 429 with retry-after)', async () => {
    const ip = `10.7.${process.pid % 250}.${Date.now() % 250}`; // unique bucket
    // Concurrent burst: 45 requests against a 30-token bucket — refill
    // (10/s) cannot keep up, so some requests MUST see 429.
    const burst = await Promise.all(
      Array.from({ length: 45 }, () => gw(h, 'GET', '/api/ai/echo', { ip })),
    );
    const limited = burst.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].headers.get('retry-after')).toBeTruthy();
    expect(burst.some((r) => r.status === 200)).toBe(true); // first tokens passed

    // A different IP still gets through (per-IP buckets, not global).
    const other = await gw(h, 'GET', '/api/ai/echo', { ip: `10.9.9.${process.pid % 250}` });
    expect(other.status).toBe(200);
  });

  it('G5 /api/health aggregates every downstream', async () => {
    const res = await fetch(`${h.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.gateway).toBe('ok');
    for (const svc of ['identity', 'marketplace', 'communication', 'transaction', 'ai']) {
      expect(json.services[svc].status).toBe('ok');
    }
    expect(json.allOk).toBe(true);
  });

  it('G6 unknown routes → 404; upstream failures → 502 (fail-closed, logged)', async () => {
    const unknown = await gw(h, 'GET', '/api/nope/echo');
    expect(unknown.status).toBe(404);

    // Force an upstream 500 → gateway forwards the status (transparent proxy).
    const fail = await gw(h, 'GET', '/api/marketplace/echo', { body: undefined });
    const forced = await fetch(`${h.baseUrl}/api/marketplace/echo`, {
      headers: { authorization: `Bearer ${h.signToken({ sub: 'g1000000-0000-4000-8000-000000000001' })}`, 'x-stub-fail': '1' },
    });
    expect(forced.status).toBe(500);
    expect(fail.status).toBe(200);
  });

  it('G7 identity auth bypass forwards the Authorization header when present', async () => {
    const token = h.signToken({ sub: 'g1000000-0000-4000-8000-000000000001' });
    const res = await gw(h, 'POST', '/api/identity/auth/login', { token, body: { email: 'x' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authorization).toBe(`Bearer ${token}`); // forwarded untouched
  });
});
