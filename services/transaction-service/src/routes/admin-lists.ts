import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, requireAdmin, parseQuery, internalError } from '../handlers';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// H3 closeout — admin LIST routes (the admin console previously had tables
// with no backend to fill them: only create/resolve existed for disputes and
// audit rows were written but never readable).
//
//   GET /api/disputes            → { disputes: [...], pagination }
//   GET /api/audit               → { audit: [...], pagination }
//
// Both are admin-only via the SAME requireAdmin guard every other admin route
// uses (signed role claim first, ADMIN_USER_IDS env fallback). Paginated;
// disputes optionally filterable by status (?status=) — the field the
// frontend table's badge logic already keys on (DISPUTED / ADMIN_REVIEW /
// RESOLVED) — and by transaction (?transactionId=).
// ---------------------------------------------------------------------------

const disputeListQuery = z.object({
  status: z.enum(['DISPUTED', 'ADMIN_REVIEW', 'RESOLVED']).optional(),
  transactionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const auditListQuery = z.object({
  transactionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export async function listDisputes(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const adminCheck = requireAdmin(auth.auth);
    if (adminCheck) return adminCheck;

    const q = parseQuery(new URL(request.url), disputeListQuery);
    if (!q.ok) return q.response;
    const { status, transactionId, page, limit } = q.data;

    const values: unknown[] = [];
    const where: string[] = [];
    if (status) {
      values.push(status);
      where.push(`d.status = $${values.length}`);
    }
    if (transactionId) {
      values.push(transactionId);
      where.push(`d.transaction_id = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT count(*)::int AS total FROM disputes d ${whereSql}`,
      values,
    );
    const total = countRes.rows[0].total as number;

    values.push(limit, offset);
    const rows = await pool.query(
      `SELECT d.id, d.transaction_id, d.raised_by, d.reason, d.status,
              d.resolution, d.resolved_by, d.created_at, d.resolved_at,
              t.amount_paise, t.buyer_id, t.seller_id
       FROM disputes d
       JOIN transactions t ON t.id = d.transaction_id
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return NextResponse.json({
      disputes: rows.rows.map((r) => ({
        id: r.id,
        transactionId: r.transaction_id,
        raisedBy: r.raised_by,
        reason: r.reason,
        status: r.status,
        resolution: r.resolution ?? null,
        resolvedBy: r.resolved_by ?? null,
        resolvedAt: iso(r.resolved_at),
        amountPaise: Number(r.amount_paise),
        buyerId: r.buyer_id,
        sellerId: r.seller_id,
        createdAt: iso(r.created_at),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    return internalError('listDisputes', err);
  }
}

export async function listAudit(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const adminCheck = requireAdmin(auth.auth);
    if (adminCheck) return adminCheck;

    const q = parseQuery(new URL(request.url), auditListQuery);
    if (!q.ok) return q.response;
    const { transactionId, page, limit } = q.data;

    const values: unknown[] = [];
    const where: string[] = [];
    if (transactionId) {
      values.push(transactionId);
      where.push(`transaction_id = $${values.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT count(*)::int AS total FROM transaction_audit ${whereSql}`,
      values,
    );
    const total = countRes.rows[0].total as number;

    values.push(limit, offset);
    const rows = await pool.query(
      `SELECT id, transaction_id, actor_id, action, detail, created_at
       FROM transaction_audit
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return NextResponse.json({
      audit: rows.rows.map((r) => ({
        id: String(r.id),
        transactionId: r.transaction_id ?? null,
        actorId: r.actor_id ?? null,
        action: r.action,
        detail: r.detail ?? {},
        createdAt: iso(r.created_at),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    return internalError('listAudit', err);
  }
}
