#!/usr/bin/env node
// Stub identity-service for transaction-service integration tests: serves
// /.well-known/jwks.json keyed to STUB_JWT_PUBLIC_KEY (kid = RFC 7638
// thumbprint), same contract as the other services' stubs.
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.STUB_PORT || 14101);
const PUB = process.env.STUB_JWT_PUBLIC_KEY || '';

function kidForPub(pem) {
  const jwk = crypto.createPublicKey(pem).export({ format: 'jwk' });
  return crypto.createHash('sha256').update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n })).digest('base64url');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (url.pathname === '/.well-known/jwks.json') {
    const jwk = crypto.createPublicKey(PUB).export({ format: 'jwk' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: kidForPub(PUB), alg: 'RS256', use: 'sig' }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub identity on ${PORT}`));
