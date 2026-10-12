import { NextResponse } from 'next/server';

import { pool } from '../../../db';
import { requireAdmin } from '../../../lib/admin-auth';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// GET /api/users — admin console "userbase": every account that has actually
// logged in (at least one session), newest login first, with its role.
// Admin-only (signed role claim) — see lib/admin-auth.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const res = await pool.query(
    `SELECT u.id,
            u.email,
            u.full_name   AS "fullName",
            u.hostel_block AS "hostelBlock",
            u.role,
            MAX(s.created_at) AS "lastLoginAt"
     FROM users u
     JOIN sessions s ON s.user_id = u.id
     GROUP BY u.id
     ORDER BY "lastLoginAt" DESC`,
  );

  const r = NextResponse.json({ users: res.rows });
  return withSecurity(r, request);
}
