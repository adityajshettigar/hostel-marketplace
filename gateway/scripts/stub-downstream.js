#!/usr/bin/env node
// Generic stub downstream for gateway tests. Serves, for every service:
//   GET  /api/health                     → { ok: true, service: <name> }
//   POST /api/echo                       → echoes method/path/headers/body
//   *    /*                              → 404
// Failure switch: header x-stub-fail: 1 → 500 (upstream-error test path).
// Authorization policy switch: STUB_REQUIRE_KEY=1 → 403 unless
// x-service-key === STUB_SERVICE_KEY (proves the gateway injects the key).
const http = require('node:http');

const PORT = Number(process.env.STUB_PORT || 0);
const NAME = process.env.STUB_NAME || 'stub';
const REQUIRE_KEY = process.env.STUB_REQUIRE_KEY === '1';
const SERVICE_KEY = process.env.STUB_SERVICE_KEY || '';

function readBody(req, cb) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => cb(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const done = (status, obj, extraHeaders = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify(obj));
  };

  readBody(req, (body) => {
    if (req.headers['x-stub-fail'] === '1') return done(500, { error: 'STUB_ERROR' });
    // Health is keyless (like the real services) so probes work.
    if (url.pathname === '/api/health') return done(200, { ok: true, service: NAME });
    if (REQUIRE_KEY && req.headers['x-service-key'] !== SERVICE_KEY) {
      return done(403, { error: 'FORBIDDEN', reason: 'missing x-service-key' });
    }
    if (url.pathname === '/api/echo') {
      return done(200, {
        service: NAME,
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        authorization: req.headers.authorization ?? null,
        serviceKey: req.headers['x-service-key'] ?? null,
        contentType: req.headers['content-type'] ?? null,
        body: body ? JSON.parse(body) : null,
      });
    }
    return done(404, { error: 'NOT_FOUND', service: NAME });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub ${NAME} on ${PORT}`));
