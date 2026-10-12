import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Vitest harness for transaction-service (Phase 6).
//
// - Applies db/schema.sql AS transaction_app into a dedicated
//   transaction_test schema of the REAL compose Postgres (TEST_DATABASE_URL).
// - Stub identity / stub marketplace / stub Razorpay run as separate
//   processes (scripts/stub-*.js, started by scripts/test-integration.sh
//   BEFORE the server under test).
// - Tokens are minted with TEST_JWT_PRIVATE_KEY; their kid matches the stub
//   JWKS. Webhooks are signed with TEST_RZP_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

export const TEST_SCHEMA = 'transaction_test';

export const BUYER_ID = process.env.TEST_BUYER_ID || 'b1000000-0000-4000-8000-000000000001';
export const SELLER_ID = process.env.TEST_SELLER_ID || 'b2000000-0000-4000-8000-000000000002';
export const ADMIN_A = 'a1000000-0000-4000-8000-000000000001';
export const ADMIN_B = 'a2000000-0000-4000-8000-000000000002';

// Shared internal service key (audit Step 1): the server under test and the
// marketplace stub both receive this value from scripts/test-integration.sh.
export const INTERNAL_KEY = process.env.TEST_INTERNAL_KEY || 'test-internal-key';

// Fresh, valid-uuid fixture offer ids per scenario (transactions.offer_id is
// UNIQUE: every scenario needs its own accepted offer). Stub marketplace
// contract: id suffix 0002 → PENDING, 0003 → 404, anything else → ACCEPTED.
export function offerId(fixture: 'ACCEPTED' | 'PENDING' | 'HIDDEN' = 'ACCEPTED'): string {
  const suffix = fixture === 'PENDING' ? '0002' : fixture === 'HIDDEN' ? '0003' : '0001';
  return crypto.randomUUID().replace(/....$/, suffix);
}

export type TestHarness = {
  baseUrl: string;
  signToken: (claims: Record<string, unknown>) => string;
  signWebhook: (body: string) => string;
  webhookSecret: string;
  superUrl: string;
  appDbUrl: string;
};

export async function setup(): Promise<TestHarness> {
  const superUrl = process.env.TEST_DATABASE_URL || undefined;
  const appUrl = process.env.TEST_TXN_DB_URL || undefined;
  const privPem = process.env.TEST_JWT_PRIVATE_KEY || undefined;
  const pubPem = process.env.TEST_JWT_PUBLIC_KEY || undefined;
  const webhookSecret = process.env.TEST_RZP_WEBHOOK_SECRET || 'test-webhook-secret';
  if (!superUrl || !appUrl || !privPem || !pubPem) {
    throw new Error(
      'TEST_DATABASE_URL, TEST_TXN_DB_URL, TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY are all required (npm run test:integration wires them up)',
    );
  }

  // 1. Schema + DDL AS transaction_app (role from the real compose init-db).
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA ${TEST_SCHEMA} TO transaction_app`);
    await admin.query(`GRANT ALL ON SCHEMA ${TEST_SCHEMA} TO transaction_app`);
    await admin.query(`ALTER ROLE transaction_app SET search_path = ${TEST_SCHEMA}`);
  } finally {
    await admin.end();
  }
  const app = new Client({ connectionString: appUrl });
  await app.connect();
  try {
    await app.query(`SET search_path = ${TEST_SCHEMA}`);
    await app.query(schemaSql); // run AS transaction_app
  } finally {
    await app.end();
  }

  // 2. Token signer whose kid matches the stub's JWKS (RFC 7638 thumbprint).
  const jwk = crypto.createPublicKey(pubPem).export({ format: 'jwk' }) as {
    kty: string;
    n: string;
    e: string;
  };
  const kid = crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n }))
    .digest('base64url');

  return {
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:14004',
    signToken: (claims) =>
      jwt.sign(
        { iss: 'identity-service', aud: 'hostel-marketplace', type: 'access', ...claims },
        privPem,
        { algorithm: 'RS256', keyid: kid, expiresIn: '15m' },
      ),
    signWebhook: (body) => crypto.createHmac('sha256', webhookSecret).update(body, 'utf8').digest('hex'),
    webhookSecret,
    superUrl,
    appDbUrl: appUrl,
  };
}

export type Party = 'buyer' | 'seller' | 'adminA' | 'adminB' | 'other';

export function tokenFor(h: TestHarness, party: Party): string {
  const map: Record<Party, { sub: string; email: string; fullName: string }> = {
    buyer: { sub: BUYER_ID, email: 'buyer@h.edu', fullName: 'Test Buyer' },
    seller: { sub: SELLER_ID, email: 'seller@h.edu', fullName: 'Test Seller' },
    adminA: { sub: ADMIN_A, email: 'admin.a@h.edu', fullName: 'Admin A' },
    adminB: { sub: ADMIN_B, email: 'admin.b@h.edu', fullName: 'Admin B' },
    other: { sub: 'c9999999-0000-4000-8000-000000000009', email: 'x@h.edu', fullName: 'Other' },
  };
  return h.signToken(map[party]);
}

// Raw-body signed webhook post (signature computed over EXACTLY these bytes).
export async function postWebhook(
  h: TestHarness,
  body: string,
  opts: { signature?: string | null; eventId?: string } = {},
): Promise<Response> {
  return fetch(`${h.baseUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': opts.signature === null ? '' : (opts.signature ?? h.signWebhook(body)),
      ...(opts.eventId ? { 'x-razorpay-event-id': opts.eventId } : {}),
    },
    body,
  });
}

// Internal service-to-service PATCH against the marketplace stub the server
// is configured with (audit Step 1 tests use this to arm the SOLD path).
export async function stubMarkSold(
  listingId: string,
  opts: { fail?: boolean } = {},
): Promise<Response> {
  const base = process.env.TEST_STUB_MARKETPLACE_URL || 'http://localhost:14102';
  return fetch(`${base}/api/internal/listings/${encodeURIComponent(listingId)}/status`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-internal-api-key': INTERNAL_KEY,
      ...(opts.fail ? { 'x-stub-fail': '1' } : {}),
    },
    body: JSON.stringify({ status: 'SOLD' }),
  });
}

export function capturedWebhookBody(orderId: string, paymentId: string): string {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: paymentId, order_id: orderId, status: 'captured', amount: 250000 },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function api(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Direct DB row insert for scenario setup (app role, test schema).
export async function insertTxnRow(
  appDbUrl: string,
  cols: {
    status?: string;
    amountPaise?: number;
    buyerId?: string;
    sellerId?: string;
    listingId?: string;
  } = {},
) {
  const c = new Client({ connectionString: appDbUrl });
  await c.connect();
  try {
    await c.query(`SET search_path = ${TEST_SCHEMA}`);
    const res = await c.query(
      `INSERT INTO transactions (offer_id, listing_id, buyer_id, seller_id, amount_paise, quantity, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        crypto.randomUUID(),
        cols.listingId ?? 'c1000000-0000-4000-8000-000000000001',
        cols.buyerId ?? BUYER_ID,
        cols.sellerId ?? SELLER_ID,
        cols.amountPaise ?? 250000,
        1,
        cols.status ?? 'HANDOVER_PENDING',
      ],
    );
    return res.rows[0];
  } finally {
    await c.end();
  }
}

/**
 * Buyer receipt fixture.
 *
 * Escrow now releases only after BOTH the seller's PIN/QR handover
 * verification AND the authenticated buyer's own "yes, I received it" answer
 * (fulfilment_tracking.buyer_received, written by
 * POST /api/fulfill/:offerId/buyerConfirm). Tests that exercise the PAYOUT
 * mechanics therefore record that answer here, exactly as the route does, so
 * they keep testing settlement rather than the receipt gate.
 *
 * Pass `received: false` to model a buyer who denied receipt (escrow must stay
 * locked), and `null` to model an order the buyer has not answered.
 */
export async function setBuyerReceipt(
  appDbUrl: string,
  transactionId: string,
  received: boolean | null,
): Promise<void> {
  const c = new Client({ connectionString: appDbUrl });
  await c.connect();
  try {
    await c.query(`SET search_path = ${TEST_SCHEMA}`);
    await c.query(
      `INSERT INTO fulfilment_tracking (offer_id, transaction_id, status, buyer_received, buyer_confirmed_at)
       VALUES ((SELECT offer_id FROM transactions WHERE id = $1), $1, 'IN_DELIVERY', $2,
               CASE WHEN $2 THEN now() ELSE NULL END)
       ON CONFLICT (offer_id) DO UPDATE
         SET buyer_received = $2,
             buyer_confirmed_at = CASE WHEN $2 THEN now() ELSE NULL END,
             updated_at = now()`,
      [transactionId, received],
    );
  } finally {
    await c.end();
  }
}

// Arbitrary query helper for assertions/scenario setup (app role, test schema).
export async function poolQuery(appDbUrl: string, sql: string, values: unknown[] = []) {
  const c = new Client({ connectionString: appDbUrl });
  await c.connect();
  try {
    await c.query(`SET search_path = ${TEST_SCHEMA}`);
    return await c.query(sql, values);
  } finally {
    await c.end();
  }
}

// Direct DB row access for assertions (app role, test schema).
export async function fetchTxnRow(appDbUrl: string, txnId: string) {
  const c = new Client({ connectionString: appDbUrl });
  await c.connect();
  try {
    await c.query(`SET search_path = ${TEST_SCHEMA}`);
    const res = await c.query('SELECT * FROM transactions WHERE id = $1', [txnId]);
    return res.rows[0] ?? null;
  } finally {
    await c.end();
  }
}

export async function teardown(): Promise<void> {
  const superUrl = process.env.TEST_DATABASE_URL || undefined;
  if (!superUrl) return;
  const admin = new Client({ connectionString: superUrl });
  try {
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`ALTER ROLE transaction_app SET search_path = "transaction"`);
  } catch {
    // best effort
  } finally {
    await admin.end();
  }
}
