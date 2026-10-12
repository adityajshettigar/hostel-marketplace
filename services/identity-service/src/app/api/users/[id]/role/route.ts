import { NextResponse } from 'next/server';
import { z } from 'zod';

import { pool } from '../../../../../db';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/role — admin console "userbase" role toggle.
// Body: { role: 'user' | 'admin' }. Admin-only (signed role claim).
//
// The demotion guard keeps at least the caller's own admin seat: with no other
// admin the account could never be promoted back (roles change nowhere else).
// The change is picked up by the target's NEXT login/refresh (role is a signed
// claim, TTL 15 min).
// ---------------------------------------------------------------------------

const roleBodySchema = z.object({
  role: z.enum(['user', 'admin'], {
    errorMap: () => ({ message: "role must be 'user' or 'admin'" }),
  }),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  let body: z.infer<typeof roleBodySchema>;
  try {
    body = roleBodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return withSecurity(
        NextResponse.json(
          { error: 'VALIDATION_ERROR', details: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`) },
          { status: 400 },
        ),
        request,
      );
    }
    return withSecurity(NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 }), request);
  }

  if (params.id === gate.userId && body.role !== 'admin') {
    return withSecurity(
      NextResponse.json(
        { error: 'SELF_DEMOTION_FORBIDDEN', message: 'You cannot demote your own admin account' },
        { status: 403 },
      ),
      request,
    );
  }

  const updated = await pool.query(
    `UPDATE users SET role = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, email, role`,
    [body.role, params.id],
  );

  if (!updated.rows[0]) {
    return withSecurity(
      NextResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 }),
      request,
    );
  }

  const r = NextResponse.json({ user: updated.rows[0] });
  return withSecurity(r, request);
}
