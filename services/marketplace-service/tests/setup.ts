import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Vitest harness for marketplace-service (audit Steps 3a-3e).
//
// - Applies db/schema.sql AS marketplace_app into a dedicated marketplace_test
//   schema of the REAL compose Postgres (TEST_DATABASE_URL, TEST_MARKETPLACE_DB_URL).
// - The stub identity-service runs as a SEPARATE process (scripts/stub-identity.js,
//   started by scripts/test-integration.sh BEFORE the server under test) on
//   TEST_STUB_URL, because the server reads IDENTITY_SERVICE_URL at startup.
// - Tokens are minted with TEST_JWT_PRIVATE_KEY; their kid matches the stub JWKS.
// ---------------------------------------------------------------------------

export const TEST_SCHEMA = 'marketplace_test';

// ids with special verification status in the stub (scripts/stub-identity.js)
export const PENDING_ID = '33333333-3333-4333-8333-333333333333';
export const STUB_500_ID = '55555555-5555-4555-8555-555555555555';

export type TestHarness = {
  baseUrl: string;
  identityUrl: string;
  appDbUrl: string;
  signToken: (claims: Record<string, unknown>) => string;
};

export async function setup(): Promise<TestHarness> {
  const superUrl = process.env.TEST_DATABASE_URL || undefined;
  const appUrl = process.env.TEST_MARKETPLACE_DB_URL || undefined;
  const privPem = process.env.TEST_JWT_PRIVATE_KEY || undefined;
  const pubPem = process.env.TEST_JWT_PUBLIC_KEY || undefined;
  const identityUrl = process.env.TEST_STUB_URL || 'http://localhost:14101';
  if (!superUrl || !appUrl || !privPem || !pubPem) {
    throw new Error(
      'TEST_DATABASE_URL, TEST_MARKETPLACE_DB_URL, TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY are all required (npm run test:integration wires them up)',
    );
  }

  // 1. Schema + DDL AS marketplace_app (role from the real compose init-db).
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA ${TEST_SCHEMA} TO marketplace_app`);
    await admin.query(`ALTER ROLE marketplace_app SET search_path = ${TEST_SCHEMA}`);
  } finally {
    await admin.end();
  }
  const app = new Client({ connectionString: appUrl });
  await app.connect();
  try {
    await app.query(`SET search_path = ${TEST_SCHEMA}`);
    await app.query(schemaSql); // run AS marketplace_app
  } finally {
    await app.end();
  }

  // 2. Token signer whose kid matches the stub's JWKS.
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
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:14002',
    identityUrl,
    appDbUrl: appUrl,
    signToken: (claims) =>
      jwt.sign(
        { iss: 'identity-service', aud: 'hostel-marketplace', type: 'access', ...claims },
        privPem,
        { algorithm: 'RS256', keyid: kid, expiresIn: '15m' },
      ),
  };
}

export async function teardown(): Promise<void> {
  const superUrl = process.env.TEST_DATABASE_URL || undefined;
  if (!superUrl) return;
  const admin = new Client({ connectionString: superUrl });
  try {
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`ALTER ROLE marketplace_app SET search_path = marketplace`);
  } catch {
    // best effort
  } finally {
    await admin.end();
  }
}
