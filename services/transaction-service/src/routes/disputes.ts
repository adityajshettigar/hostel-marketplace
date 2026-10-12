import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, parseJsonBody, jsonError, notFound, internalError, requireAdmin } from '../handlers';
import { TxnRow, transition, writeAudit, transitionErrorResponse } from '../state-machine';
import { disputeCreateSchema, disputeResolveSchema } from '../schemas';
import { cancelReleaseJob, settleTransaction, SettleResult } from '../release';
import { env } from '../env';

// ---------------------------------------------------------------------------
// POST /api/transactions/:id/dispute — buyer only, ≥1 evidence URL
// (Cloudinary in prod). DISPUTED freezes funds: the scheduled release job is
// cancelled AND the settle path re-checks status under lock (disputed rows
// can never auto-release). Creates an admin_tickets row.
//
// PATCH /api/disputes/:id/resolve — admin only. If amount_paise >
// DUAL_AUTH_THRESHOLD a second admin's confirmation token is REQUIRED
// (SRS 5.7.4) → ADMIN_REVIEW → RESOLVED → COMPLETED | REFUNDED. Immutable
// audit rows for every step.
// ---------------------------------------------------------------------------

export async function createDispute(request: Request, id: string) {
  const client = await pool.connect();
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, disputeCreateSchema);
    if (!parsed.ok) return parsed.response;

    await client.query('BEGIN');
    const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    const txn = cur.rows[0];
    if (!txn) {
      await client.query('ROLLBACK');
      return notFound();
    }
    if (txn.buyer_id !== auth.auth.sub) {
      await client.query('ROLLBACK');
      return jsonError(403, 'FORBIDDEN', 'Only the buyer can raise a dispute');
    }
    // Frozen-funds states: only ESCROW_LOCKED / HANDOVER_PENDING can flip to
    // DISPUTED (money actually held). Never from a terminal status.
    if (txn.status !== 'ESCROW_LOCKED' && txn.status !== 'HANDOVER_PENDING') {
      await client.query('ROLLBACK');
      return jsonError(409, 'INVALID_TRANSITION', `Cannot dispute from ${txn.status}`);
    }

    const dRes = await client.query(
      `INSERT INTO disputes (transaction_id, raised_by, reason, evidence_urls)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [txn.id, auth.auth.sub, parsed.data.reason, parsed.data.evidenceUrls],
    );
    const dispute = dRes.rows[0];

    await transition(client, txn.id, 'DISPUTED');
    await client.query(`UPDATE transactions SET dispute_id = $2 WHERE id = $1`, [txn.id, dispute.id]);

    const tRes = await client.query(
      `INSERT INTO admin_tickets (transaction_id, dispute_id, raised_by, reason)
       VALUES ($1, $2, $3, $4) RETURNING id, status, created_at`,
      [txn.id, dispute.id, auth.auth.sub, parsed.data.reason],
    );

    await writeAudit(client, {
      transactionId: txn.id,
      actorId: auth.auth.sub,
      action: 'DISPUTE_RAISED',
      detail: { disputeId: dispute.id, evidenceCount: parsed.data.evidenceUrls.length },
    });
    await client.query('COMMIT');

    // Cancel the BullMQ release job AFTER commit (best-effort; the settle
    // path's recheck-then-act is the hard guarantee).
    await cancelReleaseJob(txn.id);

    return NextResponse.json(
      {
        dispute: {
          id: dispute.id,
          transactionId: dispute.transaction_id,
          status: dispute.status,
          evidenceCount: (dispute.evidence_urls as string[]).length,
          reason: dispute.reason,
          createdAt: dispute.created_at,
        },
        adminTicket: tRes.rows[0],
        message: 'Funds frozen: release job cancelled; auto-release can no longer fire.',
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const tr = transitionErrorResponse(err);
    if (tr) return tr;
    return internalError('createDispute', err);
  } finally {
    client.release();
  }
}

export async function resolveDispute(request: Request, id: string) {
  const client = await pool.connect();
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const adminCheck = requireAdmin(auth.auth);
    if (adminCheck) {
      await client.query('ROLLBACK').catch(() => {});
      return adminCheck;
    }

    const parsed = await parseJsonBody(request, disputeResolveSchema);
    if (!parsed.ok) return parsed.response;

    await client.query('BEGIN');
    const dRes = await client.query('SELECT * FROM disputes WHERE id = $1 FOR UPDATE', [id]);
    const dispute = dRes.rows[0];
    if (!dispute) {
      await client.query('ROLLBACK');
      return notFound();
    }
    if (dispute.status !== 'DISPUTED' && dispute.status !== 'ADMIN_REVIEW') {
      await client.query('ROLLBACK');
      return jsonError(409, 'INVALID_TRANSITION', `Dispute is ${dispute.status}`);
    }

    const tRes = await client.query<TxnRow>(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [dispute.transaction_id],
    );
    const txn = tRes.rows[0];
    if (!txn) {
      await client.query('COMMIT');
      return notFound();
    }

    // Dual auth (SRS 5.7.4): amounts above DUAL_AUTH_THRESHOLD need a second
    // admin's token. The second admin must be a DIFFERENT user id (not the
    // caller), present in ADMIN_USER_IDS, carried in the body's
    // secondAdminToken ("admin:<uuid>" — minted by the second admin offline).
    const needsDual = Number(txn.amount_paise) > env.DUAL_AUTH_THRESHOLD;
    if (needsDual) {
      const token = parsed.data.secondAdminToken ?? '';
      const m = token.match(/^admin:(\S+)$/);
      const secondAdmin = m?.[1] ?? '';
      if (!secondAdmin || secondAdmin === auth.auth.sub || !isAdmin(secondAdmin)) {
        await client.query('ROLLBACK');
        return jsonError(403, 'DUAL_AUTH_REQUIRED', `Amount exceeds DUAL_AUTH_THRESHOLD (${env.DUAL_AUTH_THRESHOLD} paise); a second, different admin's confirmation token ("admin:<userId>") is required`);
      }
    }

    // DISPUTED → ADMIN_REVIEW → RESOLVED, then to the final status.
    await transition(client, txn.id, 'ADMIN_REVIEW');
    await client.query(`UPDATE disputes SET status = 'ADMIN_REVIEW' WHERE id = $1`, [id]);

    // Money movement: REFUNDED (admin refund; no Razorpay refund call in
    // test mode) or COMPLETED (release to seller via the shared settle path
    // — RESOLVED → COMPLETED only if the payout call actually succeeded).
    let finalStatus: 'COMPLETED' | 'REFUNDED';
    if (parsed.data.resolution === 'COMPLETED') {
      await transition(client, txn.id, 'RESOLVED');
      await client.query(
        `UPDATE disputes SET status = 'RESOLVED', resolution = 'COMPLETED', resolved_by = $2, resolved_at = now() WHERE id = $1`,
        [id, auth.auth.sub],
      );
      await client.query(
        `UPDATE admin_tickets SET status = 'RESOLVED' WHERE dispute_id = $1`,
        [id],
      );
      await writeAudit(client, {
        transactionId: txn.id,
        actorId: auth.auth.sub,
        action: 'DISPUTE_RESOLVED',
        detail: { disputeId: id, resolution: 'COMPLETED', dualAuth: needsDual, note: parsed.data.note },
      });
      await client.query('COMMIT');

      // Payout via the shared settle path (MANUAL_VERIFY accepts RESOLVED).
      const settle = await settleTransaction(txn.id, { actorId: auth.auth.sub, source: 'MANUAL_VERIFY' });
      await auditFinal(txn.id, auth.auth.sub, 'DISPUTE_PAYOUT_RESULT', {
        disputeId: id,
        ok: settle.ok,
        status: settle.ok ? settle.status : settle.status,
        reason: settle.ok && 'reason' in settle ? settle.reason : null,
      });
      const refreshed = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [txn.id]);
      return NextResponse.json({
        disputeId: id,
        transactionId: txn.id,
        status: refreshed.rows[0]?.status ?? 'RESOLVED',
        resolution: 'COMPLETED',
        payoutSettled: settle.ok && settle.status === 'COMPLETED',
        // Audit N1/Q2: settle.ok === true now guarantees the pre-payout
        // listing-SOLD write succeeded (failures return ok:false).
        listingSold: settle.ok,
      });
    } else {
      await transition(client, txn.id, 'RESOLVED');
      await transition(client, txn.id, 'REFUNDED');
      finalStatus = 'REFUNDED';
    }

    await client.query(
      `UPDATE disputes SET status = 'RESOLVED', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`,
      [id, finalStatus, auth.auth.sub],
    );
    await client.query(
      `UPDATE admin_tickets SET status = 'RESOLVED' WHERE dispute_id = $1`,
      [id],
    );
    await writeAudit(client, {
      transactionId: txn.id,
      actorId: auth.auth.sub,
      action: 'DISPUTE_RESOLVED',
      detail: { disputeId: id, resolution: finalStatus, dualAuth: needsDual, note: parsed.data.note },
    });
    await client.query('COMMIT');

    return NextResponse.json({
      disputeId: id,
      transactionId: txn.id,
      status: finalStatus,
      resolution: finalStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const tr = transitionErrorResponse(err);
    if (tr) return tr;
    return internalError('resolveDispute', err);
  } finally {
    client.release();
  }
}

function isAdmin(sub: string): boolean {
  const ids = env.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(sub);
}

async function auditFinal(transactionId: string, actorId: string, action: string, detail: Record<string, unknown>) {
  const { pool } = await import('../db');
  await pool.query(
    `INSERT INTO transaction_audit (transaction_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [transactionId, actorId, action, JSON.stringify(detail)],
  );
}
