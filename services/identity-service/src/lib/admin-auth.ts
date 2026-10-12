import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

import { env } from '../env';
import { withSecurity } from './security';

// ---------------------------------------------------------------------------
// Admin gate for the admin-console routes (userbase list + role changes).
//
// Authorization is admin-side: `users.role` is the single source of truth and
// is stamped into the SIGNED `role` claim at login/refresh time. This gate
// therefore trusts ONLY the verified JWT claim — no env allowlist — so a role
// demotion actually takes effect on the next login/refresh.
// ---------------------------------------------------------------------------

export type AdminGate = { ok: true; userId: string } | { ok: false; response: NextResponse };

export async function requireAdmin(request: Request): Promise<AdminGate> {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    return {
      ok: false,
      response: withSecurity(
        NextResponse.json(
          { error: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> is required' },
          { status: 401 },
        ),
        request,
      ),
    };
  }

  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'] });
  } catch {
    return {
      ok: false,
      response: withSecurity(
        NextResponse.json({ error: 'INVALID_TOKEN', message: 'Token is malformed or expired' }, { status: 401 }),
        request,
      ),
    };
  }

  const claims = typeof decoded === 'object' && decoded !== null ? (decoded as { sub?: string; role?: string }) : null;
  if (!claims?.sub) {
    return {
      ok: false,
      response: withSecurity(
        NextResponse.json({ error: 'INVALID_TOKEN', message: 'Token is malformed' }, { status: 401 }),
        request,
      ),
    };
  }

  if (claims.role !== 'admin') {
    return {
      ok: false,
      response: withSecurity(
        NextResponse.json({ error: 'FORBIDDEN', message: 'Admin only' }, { status: 403 }),
        request,
      ),
    };
  }

  return { ok: true, userId: claims.sub };
}
