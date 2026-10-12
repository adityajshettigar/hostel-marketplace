import crypto from 'node:crypto';
import { env } from './env';

// ---------------------------------------------------------------------------
// Razorpay TEST MODE via plain REST (user decision: no SDK). Two calls only:
//
//   POST {base}/orders                       (Basic auth key_id:key_secret)
//   POST {base}/payouts                      (test-mode payouts; failure must
//                                             NOT be assumed-success)
//
// Webhook signature verification lives here too: HMAC-SHA256 of the RAW body
// with RAZORPAY_WEBHOOK_SECRET, compared to X-Razorpay-Signature (hex).
// ---------------------------------------------------------------------------

function authHeader(): string | null {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = env;
  if (!id || !secret) return null;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };

// Create an Order for the escrow amount (integer paise — Razorpay's native
// unit; no floats anywhere).
export async function createRazorpayOrder(params: {
  amountPaise: number;
  receipt: string;
}): Promise<RazorpayOrder> {
  const auth = authHeader();
  if (!auth) throw new RazorpayConfigError('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set');

  const res = await fetch(`${env.RAZORPAY_API_BASE}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: 'INR',
      receipt: params.receipt,
      payment_capture: 1,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.id !== 'string') {
    throw new RazorpayApiError(`order create failed: HTTP ${res.status}`, res.status);
  }
  return body as unknown as RazorpayOrder;
}

export type PayoutResult = { ok: boolean; payoutId: string | null; status: number; error?: string };

// Payout to the seller's linked fund account (TEST MODE). NEVER assume
// success: ok===true only for an actual 2xx with a payout id.
export async function createPayout(params: {
  amountPaise: number;
  idempotencyKey: string;
}): Promise<PayoutResult> {
  const auth = authHeader();
  if (!auth) {
    return { ok: false, payoutId: null, status: 0, error: 'RAZORPAY_KEY_ID/SECRET not set' };
  }
  const fundAccount = env.RAZORPAY_FUND_ACCOUNT_ID;
  if (!fundAccount) {
    return { ok: false, payoutId: null, status: 0, error: 'RAZORPAY_FUND_ACCOUNT_ID not set' };
  }

  try {
    const res = await fetch(`${env.RAZORPAY_API_BASE}/payouts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: auth,
        // Razorpay supports an idempotency header on payouts; we ALSO store
        // our key in handover_idempotency BEFORE calling (no double-pay).
        'X-Razorpay-Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        account_number: env.RAZORPAY_FUND_ACCOUNT_ID,
        amount: params.amountPaise,
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        narration: `Escrow release ${params.idempotencyKey.slice(0, 24)}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof body.id === 'string') {
      return { ok: true, payoutId: body.id, status: res.status };
    }
    return { ok: false, payoutId: null, status: res.status, error: JSON.stringify(body).slice(0, 300) };
  } catch (err) {
    return { ok: false, payoutId: null, status: 0, error: String(err).slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Webhook signature: HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET) === header
// (timing-safe). Unsigned/invalid → rejected before ANY DB/API touch.
// ---------------------------------------------------------------------------

export function timingSafeHexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still do a comparison to keep timing flat, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeHexEqual(expected, signatureHeader.trim().toLowerCase());
}

export class RazorpayConfigError extends Error {}
export class RazorpayApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
