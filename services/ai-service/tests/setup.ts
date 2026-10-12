import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';

// ---------------------------------------------------------------------------
// Vitest harness for ai-service (Phase 5).
//
// - Applies db/schema.sql AS ai_app into a dedicated ai_test schema of the
//   REAL compose Postgres (TEST_DATABASE_URL, TEST_AI_DB_URL).
// - Stub identity / stub marketplace / stub HF run as SEPARATE processes
//   (scripts/stub-*.js, started by scripts/test-integration.sh BEFORE the
//   server under test).
// - Tokens are minted with TEST_JWT_PRIVATE_KEY; their kid matches the stub
//   JWKS.
// ---------------------------------------------------------------------------

export const TEST_SCHEMA = 'ai_test';

export type TestHarness = {
  baseUrl: string;
  identityUrl: string;
  marketplaceUrl: string;
  hfUrl: string;
  appDbUrl: string;
  signToken: (claims: Record<string, unknown>) => string;
};

export async function setup(): Promise<TestHarness> {
  const superUrl = process.env.TEST_DATABASE_URL || undefined;
  const appUrl = process.env.TEST_AI_DB_URL || undefined;
  const privPem = process.env.TEST_JWT_PRIVATE_KEY || undefined;
  const pubPem = process.env.TEST_JWT_PUBLIC_KEY || undefined;
  if (!superUrl || !appUrl || !privPem || !pubPem) {
    throw new Error(
      'TEST_DATABASE_URL, TEST_AI_DB_URL, TEST_JWT_PRIVATE_KEY, TEST_JWT_PUBLIC_KEY are all required (npm run test:integration wires them up)',
    );
  }

  // 1. Schema + DDL AS ai_app (role from the real compose init-db).
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const admin = new Client({ connectionString: superUrl });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA ${TEST_SCHEMA} TO ai_app`);
    await admin.query(`ALTER ROLE ai_app SET search_path = ${TEST_SCHEMA}`);
  } finally {
    await admin.end();
  }
  const app = new Client({ connectionString: appUrl });
  await app.connect();
  try {
    await app.query(`SET search_path = ${TEST_SCHEMA}`);
    await app.query(schemaSql); // run AS ai_app
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
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:14005',
    identityUrl: process.env.TEST_STUB_IDENTITY_URL || 'http://localhost:14101',
    marketplaceUrl: process.env.TEST_STUB_MARKETPLACE_URL || 'http://localhost:14102',
    hfUrl: process.env.TEST_STUB_HF_URL || 'http://localhost:14103/models',
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
    await admin.query(`ALTER ROLE ai_app SET search_path = ai`);
  } catch {
    // best effort
  } finally {
    await admin.end();
  }
}
