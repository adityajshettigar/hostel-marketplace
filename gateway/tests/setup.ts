import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Vitest harness for the gateway (Phase 7). Stubs + server are started by
// scripts/test-integration.sh BEFORE vitest runs; tests only need tokens.
// ---------------------------------------------------------------------------

export type TestHarness = {
  baseUrl: string;
  signToken: (claims: Record<string, unknown>) => string;
  serviceKey: string;
  stubUrls: Record<'identity' | 'marketplace' | 'communication' | 'transaction' | 'ai', string>;
};

export async function setup(): Promise<TestHarness> {
  const privPem = process.env.TEST_JWT_PRIVATE_KEY;
  const pubPem = process.env.TEST_JWT_PUBLIC_KEY;
  if (!privPem || !pubPem) {
    throw new Error('TEST_JWT_PRIVATE_KEY / TEST_JWT_PUBLIC_KEY are required (npm run test:integration wires them up)');
  }
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
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:14000',
    serviceKey: process.env.TEST_INTERNAL_SERVICE_KEY || 'test-gateway-service-key',
    stubUrls: {
      identity: process.env.TEST_STUB_ID_URL || 'http://localhost:14101',
      marketplace: process.env.TEST_STUB_MKT_URL || 'http://localhost:14102',
      communication: process.env.TEST_STUB_COM_URL || 'http://localhost:14103',
      transaction: process.env.TEST_STUB_TXN_URL || 'http://localhost:14104',
      ai: process.env.TEST_STUB_AI_URL || 'http://localhost:14105',
    },
    signToken: (claims) =>
      jwt.sign(
        { iss: 'identity-service', aud: 'hostel-marketplace', type: 'access', ...claims },
        privPem,
        { algorithm: 'RS256', keyid: kid, expiresIn: '15m' },
      ),
  };
}

export async function gw(
  h: TestHarness,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; ip?: string } = {},
): Promise<Response> {
  return fetch(`${h.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? h.signToken({ sub: 'g1000000-0000-4000-8000-000000000001', email: 'u@h.edu', fullName: 'Gateway User' })}` }),
      ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
