#!/usr/bin/env node
// Stub marketplace-service for transaction-service integration tests.
// Serves GET /api/offers/:id (x-internal-api-key required, audit Step 2b)
// and PATCH /api/internal/listings/:id/status (audit Step 1: the SOLD write
// the settle path performs before payout).
// Fixture ids encode behavior:
//   <uuid>              → ACCEPTED offer (happy path)
//   id contains "p"  → PENDING offer (not accepted)
//   id contains "f"  → 404 not visible
// Failure switch: header x-stub-fail: 1 → 500 (fail-closed test path).
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.STUB_MARKETPLACE_PORT || 14102);
const BUYER = 'b1000000-0000-4000-8000-000000000001';
const SELLER = 'b2000000-0000-4000-8000-000000000002';
const INTERNAL_KEY = process.env.STUB_INTERNAL_KEY || 'test-internal-key';
const soldListings = new Map();
let failNextInternal = false;
let lastKeyValid = null;

function timingSafeKeyEqual(provided, configured) {
  const a = Buffer.from(provided || '');
  const b = Buffer.from(configured || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // --- Test-control endpoints (audit Step 1 tests) -------------------------
  if (url.pathname === '/_state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sold: Object.fromEntries(soldListings), lastKeyValid }));
    return;
  }
  if (url.pathname === '/_fail_next') {
    failNextInternal = true;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/_fail_reset') {
    failNextInternal = false;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- PATCH /api/internal/listings/:id/status (audit Step 1) -------------
  const im = url.pathname.match(/^\/api\/internal\/listings\/([0-9a-zA-Z-]+)\/status$/);
  if (im) {
    if (req.method !== 'PATCH') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    if (!timingSafeKeyEqual(req.headers['x-internal-api-key'], INTERNAL_KEY)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid internal API key' }));
      return;
    }
    if (req.headers['x-stub-fail'] === '1' || failNextInternal) {
      failNextInternal = false;
      lastKeyValid = false;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'STUB_ERROR' }));
      return;
    }
    lastKeyValid = true;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let status = null;
      try {
        status = JSON.parse(body || '{}').status;
      } catch {
        status = null;
      }
      if (status !== 'SOLD') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'VALIDATION_ERROR', message: "status must be 'SOLD'" }));
        return;
      }
      const id = im[1];
      if (id.endsWith('0003')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'NOT_FOUND' }));
        return;
      }
      if (id.endsWith('0008')) {
        // Fixture: the internal SOLD write ALWAYS fails for this listing.
        // Deterministic on purpose — the one-shot `_fail_next` flag is global
        // to the stub, so parallel suites (integration.test.ts's buyerConfirm
        // flows also mark listings SOLD) would steal it and make the test race.
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'STUB_ERROR', message: 'deterministic SOLD-failure fixture' }));
        return;
      }
      if (soldListings.has(id)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ listing: { id, status: 'SOLD' }, alreadySold: true }));
        return;
      }
      if (id.endsWith('ffff')) {
        // Fixture: listing exists but is NOT ACTIVE (mirrors 409 path).
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_TRANSITION', message: 'listing is DELETED; only ACTIVE can be marked SOLD' }));
        return;
      }
      soldListings.set(id, 'SOLD');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ listing: { id, status: 'SOLD' } }));
    });
    return;
  }

  const m = url.pathname.match(/^\/api\/offers\/([0-9a-zA-Z-]+)$/);
  if (!m) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }
  // Mirrors the REAL marketplace GET /api/offers/:id: an end-user-JWT route
  // (transaction-service forwards the caller's Bearer). The internal API key
  // belongs ONLY on /api/internal/* — not here.
  if (req.headers['x-stub-fail'] === '1') {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'STUB_ERROR' }));
    return;
  }
  // Fixture scheme (ids must be VALID uuids — zod validates them first):
  //   ...0002 → PENDING (not accepted)
  //   ...0003 → 404 not visible
  //   anything else → ACCEPTED
  const id = m[1].toLowerCase();
  if (id.endsWith('0003')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }
  const accepted = !id.endsWith('0002');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      offer: {
        id: m[1],
        listingId: 'c1000000-0000-4000-8000-000000000001',
        buyerId: BUYER,
        offeredPrice: '800.00', // ₹800 → 80,000 paise after the ×100 fix; below DUAL_AUTH_THRESHOLD
        quantity: 1,
        status: accepted ? 'ACCEPTED' : 'PENDING',
        listing: {
          id: 'c1000000-0000-4000-8000-000000000001',
          title: 'Stub Listing',
          sellerId: SELLER,
          price: '300000.00',
          status: 'ACTIVE',
        },
      },
    }),
  );
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub marketplace on ${PORT}`));
