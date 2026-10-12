import { NextResponse } from 'next/server';

import { env } from '../env';
import { toRsaJwk } from '../jwks-kid';

// ---------------------------------------------------------------------------
// JWKS (JSON Web Key Set) — public key only
// ---------------------------------------------------------------------------
//
// Every identity-service route signs JWTs with RS256, so the public half of
// the keypair is all other services need to verify tokens. We expose it at
// /.well-known/jwks.json (rewritten in next.config.mjs). The RSA modulus (n)
// and exponent (e) are base64url-encoded from the PEM public key in the env,
// and the kid is the SHA-256 thumbprint of the DER-encoded SubjectPublicKeyInfo
// (stable across restarts as long as the keypair in .env does not change).
//
// NOTE: this is the PUBLIC key only. The PRIVATE key stays in the root .env
// and is never exposed through this endpoint.

export async function GET() {
  const jwk = toRsaJwk(env.JWT_PUBLIC_KEY);

  if (!jwk) {
    // The key in .env is not parseable as an RSA public key — surface a 500
    // rather than serving a useless placeholder key set.
    return NextResponse.json(
      { error: 'JWKS_UNAVAILABLE', message: 'Signing key is not configured or is not RSA' },
      { status: 500 },
    );
  }

  const r = NextResponse.json(
    { keys: [jwk] },
    { headers: { 'Cache-Control': 'public, max-age=600' } },
  );
  return r;
}
