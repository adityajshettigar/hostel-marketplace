#!/usr/bin/env node
// Stub marketplace-service for ai-service integration tests. Serves exactly
// the two marketplace calls ai-service makes:
//   GET /api/listings?limit=...        -> { listings: [...] } (ACTIVE seeds)
//   GET /api/stats/sold?category=&condition= -> { stats: { p25, median, p75, sampleSize } }
// Failure switch: any stats request with category=Boom -> 500 (ai must
// fall back / fail closed per SRS 7.12).
const http = require('node:http');

const PORT = Number(process.env.STUB_MARKETPLACE_PORT || 14102);
const SELLER_ID = '11111111-1111-4111-8111-111111111111';

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/stats/sold') {
    const category = url.searchParams.get('category') || '';
    const condition = url.searchParams.get('condition') || '';
    // M7 failure switch: a GENUINE downstream 500 on a VALID category
    // ('Boom' is not enum-valid and would 400 before ai ever calls us).
    if (category === 'Electronics' || category === 'Boom') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'STUB_ERROR' }));
      return;
    }
    // Deterministic fixture medians (condition-tier ONLY when the stub has
    // per-condition history; otherwise empty so ai falls to category tier):
    //   (Appliances, Good) -> 2 SOLD rows {100, 300} => median 200, IQR 150/250
    //   (Books, no condition) -> 1 SOLD row {120}    => median 120
    let stats;
    if (category === 'Appliances' && condition === 'Good') {
      stats = { p25: 150, median: 200, p75: 250, sampleSize: 2 };
    } else if (category === 'Appliances' && !condition) {
      stats = { p25: 150, median: 200, p75: 250, sampleSize: 2 };
    } else if (category === 'Books' && !condition) {
      stats = { p25: 120, median: 120, p75: 120, sampleSize: 1 };
    } else {
      stats = { p25: null, median: null, p75: null, sampleSize: 0 };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ stats }));
    return;
  }

  if (url.pathname === '/api/listings') {
    const now = new Date().toISOString();
    const listings = [
      { id: 'aaaaaaa1-0000-4000-8000-000000000001', sellerId: SELLER_ID, title: 'CLRS Algorithms Book', category: 'Books', price: '350.00', createdAt: now },
      { id: 'aaaaaaa1-0000-4000-8000-000000000002', sellerId: '22222222-2222-4222-8222-222222222222', title: 'Used Mixer Grinder', category: 'Appliances', price: '900.00', createdAt: now },
      { id: 'aaaaaaa1-0000-4000-8000-000000000003', sellerId: '22222222-2222-4222-8222-222222222222', title: 'Study Table', category: 'Furniture', price: '1200.00', createdAt: now },
      { id: 'aaaaaaa1-0000-4000-8000-000000000004', sellerId: '22222222-2222-4222-8222-222222222222', title: 'Bluetooth Speaker', category: 'Electronics', price: '700.00', createdAt: now },
    ];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ listings, pagination: { page: 1, limit: 50, total: listings.length, totalPages: 1 } }));
    return;
  }

  res.writeHead(404);
  res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub marketplace on ${PORT}`));
