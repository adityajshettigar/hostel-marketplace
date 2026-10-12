import { GET as jwksGET } from '../../routes/jwks';
import { withSecurity } from '@/lib/security';

// Internal segment for the /.well-known/jwks.json rewrite in next.config.mjs.
// (App Router folders cannot contain literal dots in their names.)
// Reads live JWT keys from env, so it must never be statically evaluated.
export const dynamic = 'force-dynamic';
export const GET = async (request: Request) => {
  const res = await jwksGET();
  return withSecurity(res, request);
};
