#!/usr/bin/env node
// Stub identity-service for communication-service integration tests.
// Same behavior as marketplace's stub: serves /.well-known/jwks.json and
// /api/users/:id/public with per-id statuses.
const crypto = require('node:crypto');

const PUB = process.env.STUB_JWT_PUBLIC_KEY;
if (!PUB) {
  console.error('STUB_JWT_PUBLIC_KEY is required');
  process.exit(1);
}
const jwk = crypto.createPublicKey(PUB).export({ format: 'jwk' });
const kid = crypto
  .createHash('sha256')
  .update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n }))
  .digest('base64url');

const PENDING_ID = '33333333-3333-4333-8333-333333333333';
const STUB_500_ID = '55555555-5555-4555-8555-555555555555';
const PORT = Number(process.env.STUB_PORT || 14101);

const http = require('node:http');
const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (url === '/.well-known/jwks.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: jwk.n, e: jwk.e }] }));
    return;
  }
  const m = url.match(/^\/api\/users\/([0-9a-f-]+)\/public$/);
  if (m) {
    const id = m[1];
    if (id === STUB_500_ID) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'STUB_ERROR' }));
      return;
    }
    const status = id === PENDING_ID ? 'PENDING' : 'VERIFIED';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ fullName: 'Stub User', hostelBlock: 'MH-A', roomNumber: '1', verificationStatus: status }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub identity on ${PORT}, kid=${kid.slice(0, 8)}`));
