import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';

import { pool } from '../db';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// Internal service-to-service reads (x-internal-api-key, audit Step 1b).
// /api/internal/* is exempt from the middleware's x-service-key gate, so each
// handler authenticates the shared internal key itself — the ONLY caller is
// another service (here: transaction-service rendering a purchase timeline).
// Never exposed through the gateway to end users.
// ---------------------------------------------------------------------------

function requireInternalKey(request: Request): NextResponse | null {
  const configured = process.env.INTERNAL_SERVICE_API_KEY;
  if (!configured) {
    return withSecurity(
      NextResponse.json(
        { error: 'NOT_CONFIGURED', message: 'Internal API key is not configured' },
        { status: 501 },
      ),
      request,
    );
  }
  const provided =
    request.headers.get('x-internal-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return withSecurity(
      NextResponse.json({ error: 'UNAUTHORIZED', message: 'Invalid internal API key' }, { status: 401 }),
      request,
    );
  }
  return null;
}

const internalIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

// GET /api/internal/users?ids=a,b,c — batch profile read for party display
// (name, hostel block, room). camelCase, matching the public profile shape.
export async function getUsersByIdsInternal(request: Request) {
  const denied = requireInternalKey(request);
  if (denied) return denied;

  try {
    const raw = new URL(request.url).searchParams.get('ids') ?? '';
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    const parsed = internalIdsSchema.safeParse({ ids });
    if (!parsed.success) {
      return withSecurity(
        NextResponse.json(
          { error: 'VALIDATION_ERROR', message: 'ids must be 1-50 comma-separated user UUIDs' },
          { status: 400 },
        ),
        request,
      );
    }

    const res = await pool.query<{
      id: string;
      full_name: string;
      hostel_block: string | null;
      room_number: string | null;
      hostel_group: string | null;
      email: string;
      phone: string | null;
    }>(
      `SELECT id, full_name, hostel_block, room_number, hostel_group, email, phone
       FROM users WHERE id = ANY($1::uuid[])`,
      [parsed.data.ids],
    );

    return withSecurity(
      NextResponse.json({
        users: res.rows.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          hostelBlock: r.hostel_block,
          roomNumber: r.room_number,
          hostelGroup: r.hostel_group,
          email: r.email,
          phone: r.phone,
        })),
      }),
      request,
    );
  } catch (err) {
    console.error('[identity:getUsersByIdsInternal]', err);
    return withSecurity(
      NextResponse.json({ error: 'INTERNAL', message: 'Internal server error' }, { status: 500 }),
      request,
    );
  }
}
