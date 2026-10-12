import { NextResponse } from 'next/server';
import { pool } from '../db';
import { jsonError, internalError } from '../handlers';
import { TxnRow, transition, writeAudit } from '../state-machine';
import { verifyWebhookSignature } from '../razorpay';
import { generatePin, encryptQrPayload, encryptSecret, newQrExpiry } from '../qr-crypto';
import { scheduleReleaseJob } from '../release';

// ---------------------------------------------------------------------------
// POST /api/webhooks/razorpay
//
// 1. Verify X-Razorpay-Signature (HMAC-SHA256 over the RAW body with
//    RAZORPAY_WEBHOOK_SECRET) BEFORE touching anything. Invalid/unsigned →
//    400 immediately + attempt logged. (Route file reads the raw body.)
// 2. On verified payment.captured: one DB transaction — escrow LOCKED,
//    4-digit PIN (crypto.randomInt) stored ONLY as argon2 hash, AES-256-GCM
//    QR payload {transactionId, expiresAt}, release_deadline = now + 48h,
//    status → HANDOVER_PENDING, BullMQ delayed release job scheduled.
// 3. Idempotent: Razorpay retries webhooks — dedupe on the event id
//    (x-razorpay-event-id header, falling back to the payload id).
// ---------------------------------------------------------------------------

const RELEASE_WINDOW_HOURS = 48;

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        amount?: number;
      };
    };
  };
};

export async function handleRazorpayWebhook(request: Request) {
  try {
    const raw = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const eventId = request.headers.get('x-razorpay-event-id') ?? null;

    // 1. Signature gate — before ANY state change or DB write.
    if (!verifyWebhookSignature(raw, signature)) {
      console.error('[transaction:webhook] REJECTED webhook: missing/invalid signature');
      await auditRejectedAttempt(raw, 'INVALID_SIGNATURE');
      return jsonError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    }

    let body: RazorpayWebhookBody;
    try {
      body = JSON.parse(raw) as RazorpayWebhookBody;
    } catch {
      await auditRejectedAttempt(raw, 'MALFORMED_JSON');
      return jsonError(400, 'MALFORMED_JSON', 'Webhook body is not valid JSON');
    }

    const entity = body.payload?.payment?.entity ?? {};
    const dedupeId = eventId ?? `${body.event}:${entity.id ?? 'unknown'}`;

    // 2. Idempotency gate (event id UNIQUE). Insert wins → we process;
    //    conflict → Razorpay retry, return 200 so it stops retrying.
    const dedupe = await pool.query(
      `INSERT INTO webhook_events (event_id, event_type) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [dedupeId, body.event ?? 'unknown'],
    );
    if (dedupe.rows.length === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // 3. Only payment.captured moves escrow.
    if (body.event !== 'payment.captured') {
      await writeAuditPublic({
        transactionId: null,
        actorId: null,
        action: 'WEBHOOK_IGNORED',
        detail: { event: body.event ?? 'unknown', eventId: dedupeId },
      });
      return NextResponse.json({ received: true, ignored: body.event ?? 'unknown' });
    }
    if (entity.status !== 'captured' || !entity.order_id) {
      await writeAuditPublic({
        transactionId: null,
        actorId: null,
        action: 'WEBHOOK_REJECTED_PAYLOAD',
        detail: { reason: 'payment entity missing status/order_id', eventId: dedupeId },
      });
      return jsonError(400, 'INVALID_PAYLOAD', 'payment.captured entity missing status/order_id');
    }

    // 4. Locate the transaction by the Razorpay order id.
    const found = await pool.query<TxnRow>(
      'SELECT * FROM transactions WHERE razorpay_order_id = $1',
      [entity.order_id],
    );
    const txn = found.rows[0];
    if (!txn) {
      await writeAuditPublic({
        transactionId: null,
        actorId: null,
        action: 'WEBHOOK_UNKNOWN_ORDER',
        detail: { orderId: entity.order_id, eventId: dedupeId },
      });
      return jsonError(404, 'UNKNOWN_ORDER', 'No transaction for this razorpay order id');
    }

    // 5. THE single atomic state change: ESCROW_LOCKED → HANDOVER_PENDING
    //    with PIN/QR/deadline written in the SAME DB transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<TxnRow>(
        'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
        [txn.id],
      );
      const locked = cur.rows[0];

      // Recheck under lock: an idempotent replay racing itself, or a dispute
      // that already moved things, must not re-lock escrow.
      if (locked.status !== 'ESCROW_PENDING' && locked.status !== 'ESCROW_LOCKED') {
        await writeAudit(client, {
          transactionId: locked.id,
          actorId: null,
          action: 'WEBHOOK_NO_OP',
          detail: { reason: `status is ${locked.status}`, eventId: dedupeId },
        });
        await client.query('COMMIT');
        return NextResponse.json({ received: true, noOp: true, status: locked.status });
      }

      // Mark escrow LOCKED first (never skip states), then → HANDOVER_PENDING
      // — both in THIS single DB transaction with the PIN/QR/deadline writes.
      if (locked.status === 'ESCROW_PENDING') {
        await transition(client, locked.id, 'ESCROW_LOCKED');
      }

      const { pin, pinHash } = await generatePin();
      const expiresAt = newQrExpiry();
      const qr = encryptQrPayload(locked.id, expiresAt);
      const pinEnc = encryptSecret(pin); // H1 closeout: decryptable by the buyer-only credential route
      const releaseDeadline = new Date(Date.now() + RELEASE_WINDOW_HOURS * 60 * 60 * 1000);

      const updated = await transition(client, locked.id, 'HANDOVER_PENDING');
      await client.query(
        `UPDATE transactions
         SET pin_hash = $2, pin_ciphertext = $3, pin_nonce = $4, pin_generated_at = now(),
             qr_ciphertext = $5, qr_nonce = $6, qr_expires_at = $7,
             release_deadline = $8, escrow_locked_at = now()
         WHERE id = $1`,
        [locked.id, pinHash, pinEnc.ciphertext, pinEnc.nonce, qr.ciphertext, qr.nonce, expiresAt, releaseDeadline],
      );
      await writeAudit(client, {
        transactionId: locked.id,
        actorId: null,
        action: 'ESCROW_LOCKED',
        detail: { razorpayPaymentId: entity.id ?? null, eventId: dedupeId },
      });
      await client.query('COMMIT');

      // 6. Schedule the 48h auto-release AFTER the DB txn commits.
      await scheduleReleaseJob({ transactionId: locked.id, releaseDeadline });

      // 7. Response to Razorpay's servers. The plaintext PIN also exists at
      //    rest ONLY as AES-256-GCM ciphertext (pin_ciphertext), decryptable
      //    by the buyer-only handover-credential route while handover is
      //    pending — never logged, never returned to any other caller.
      return NextResponse.json({
        received: true,
        transactionId: locked.id,
        status: updated.status,
        releaseDeadline: releaseDeadline.toISOString(),
        pin,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    return internalError('razorpayWebhook', err);
  }
}

// Rejected attempts are logged — insert-only audit (fail-open logging is
// deliberate: a broken DB must not turn a 400 into a 500).
async function auditRejectedAttempt(raw: string, reason: string): Promise<void> {
  try {
    await writeAuditPublic({
      transactionId: null,
      actorId: null,
      action: 'WEBHOOK_REJECTED',
      detail: { reason, bodyPreview: raw.slice(0, 200) },
    });
  } catch (err) {
    console.error('[transaction:webhook] audit log write failed', err);
  }
}

async function writeAuditPublic(params: {
  transactionId: string | null;
  actorId: string | null;
  action: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  const { pool } = await import('../db');
  await pool.query(
    `INSERT INTO transaction_audit (transaction_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [params.transactionId, params.actorId, params.action, JSON.stringify(params.detail)],
  );
}
