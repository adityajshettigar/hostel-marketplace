#!/usr/bin/env node
// Stub marketplace-service for communication-service integration tests.
// Serves GET /api/listings/:id (the ONE marketplace call communication makes):
//   ANY_ID      -> 200 { listing: { sellerId: STUB_SELLER_ID, ... } }
//   LISTING_404 -> 404
//   LISTING_500 -> 500 (communication must fail closed with 502)
const http = require('node:http');

const SELLER = process.env.STUB_SELLER_ID || '99999999-9999-4999-8999-999999999999';
const PORT = Number(process.env.STUB_MARKETPLACE_PORT || 14102);

const LISTING_404 = '44444444-4444-4444-8444-444444444444';
const LISTING_500 = '55555555-5555-4555-8555-555555555555';

const server = http.createServer((req, res) => {
  const url = req.url || '';
  const m = url.match(/^\/api\/listings\/([0-9a-f-]+)$/);
  if (m) {
    // Any Bearer token is accepted by this stub; the test only exercises
    // communication's behavior against marketplace's RESPONSES.
    const id = m[1];
    if (id === LISTING_404) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    if (id === LISTING_500) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'STUB_ERROR' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ listing: { id, sellerId: SELLER, title: 'Stub Listing', status: 'ACTIVE' } }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub marketplace on ${PORT}, seller=${SELLER}`));
