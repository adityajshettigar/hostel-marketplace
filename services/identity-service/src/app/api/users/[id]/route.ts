import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// /api/users/<id> has no representation of its own — the public profile lives
// at /api/users/<id>/public (least-privilege) and full profiles only at
// /api/users/me (owner-only, authenticated).

export async function GET(request: Request) {
  const r = NextResponse.json(
    {
      error: 'NOT_FOUND',
      message: 'Use /api/users/<id>/public for public profiles or /api/users/me for your own.',
    },
    { status: 404 },
  );
  return withSecurity(r, request);
}
