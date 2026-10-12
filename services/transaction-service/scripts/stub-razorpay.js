#!/usr/bin/env node
// Local Razorpay REST stub for transaction-service integration tests
// (RAZORPAY_API_BASE points here). TEST MODE semantics, deterministic:
//
//   POST /orders   → 200 { id: "order_stub_<n>", amount, currency, status: "created" }
//   POST /payouts  → controlled by STUB_PAYOUT_MODE:
//       ok      (default) → 200 { id: "pout_stub_<n>", status: "processed" }
//       fail              → 500 { error: "PAYOUT_FAILED" }
//       flake             → 500 once per key, then 200 (retry semantics)
//   GET  /health   → 200
//
// Webhook signing helper for tests lives in tests (node crypto HMAC).
const http = require('node:http');

const PORT = Number(process.env.STUB_RZP_PORT || 14104);
let orderSeq = 0;
let payoutSeq = 0;
const flakeSeen = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const mode = process.env.STUB_PAYOUT_MODE || 'ok';

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/orders') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `order_stub_${String(++orderSeq).padStart(4, '0')}`,
          amount: parsed.amount,
          currency: parsed.currency || 'INR',
          status: 'created',
          receipt: parsed.receipt || null,
        }),
      );
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/payouts') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      const key = req.headers['x-razorpay-idempotency-key'] || parsed.narration || `p${payoutSeq}`;
      // Sentinel amount (133700 paise) always fails — lets tests drive the
      // payout-failure path deterministically without affecting others.
      if (Number(parsed.amount) === 133700) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { description: 'PAYOUT_FAILED_SENTINEL' } }));
        return;
      }
      if (mode === 'flake' && !flakeSeen.has(key)) {
        flakeSeen.add(key);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { description: 'FLAKE' } }));
        return;
      }
      if (mode === 'fail') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { description: 'PAYOUT_FAILED' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `pout_stub_${String(++payoutSeq).padStart(4, '0')}`, status: 'processed' }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub razorpay on ${PORT}`));
