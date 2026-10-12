import { jsonError } from './handlers';
import { pool } from './db';
import { PoolClient } from 'pg';

export const FULFILMENT_STATUSES = [
  'ORDER_PLACED',
  'ORDER_ACCEPTED',
  'IN_DELIVERY',
  'DELIVERED',
] as const;

export type FulfillmentStatus = (typeof FULFILMENT_STATUSES)[number];

export const FULFILMENT_RESOLVED_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  ORDER_PLACED: ['ORDER_ACCEPTED'],
  ORDER_ACCEPTED: ['IN_DELIVERY'],
  IN_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
};

function assertFulfillmentTransition(from: FulfillmentStatus, to: FulfillmentStatus): void {
  if (!FULFILMENT_RESOLVED_TRANSITIONS[from].includes(to)) {
    throw new TransitionError(`Illegal fulfilment transition ${from} → ${to}`);
  }
}

export async function transitionFulfillment(
  client: PoolClient,
  offerId: string,
  to: FulfillmentStatus,
): Promise<FulfRequestRow> {
  const cur = await client.query<FulfRequestRow>('SELECT * FROM fulfilment_tracking WHERE offer_id = $1 FOR UPDATE', [
    offerId,
  ]);
  if (!cur.rows[0]) throw new TransitionError('Fulfilment tracking row disappeared mid-txn');
  const from = cur.rows[0].status as FulfillmentStatus;
  assertFulfillmentTransition(from, to);
  const res = await client.query<FulfRequestRow>(
    `UPDATE fulfilment_tracking SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [cur.rows[0].id, to],
  );
  return res.rows[0];
}

export type FulfRequestRow = {
  id: string;
  offer_id: string;
  transaction_id: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  /** Buyer receipt confirmation (post-Phase-9): NULL unanswered, true received, false denied. */
  buyer_received: boolean | null;
  buyer_confirmed_at: Date | string | null;
  buyer_declined_at: Date | string | null;
};

export type FulfillmentFinalRow = FulfRequestRow & {
  status: FulfillmentStatus;
};

export function assertFulfillmentTransitionResponse(err: unknown) {
  if (err instanceof TransitionError) {
    return jsonError(409, 'INVALID_TRANSITION', err.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// State machine (Phase 6). Enforced in ONE code path: every state change goes
// through transition(), always inside a caller's DB transaction that holds
// SELECT ... FOR UPDATE on the transaction row — skips are impossible.
//
//   DEAL_CONFIRMED → ESCROW_PENDING → ESCROW_LOCKED → HANDOVER_PENDING
//     → HANDOVER_VERIFIED → COMPLETED
//   side: ESCROW_LOCKED|HANDOVER_PENDING → DISPUTED → ADMIN_REVIEW
//     → RESOLVED → COMPLETED | REFUNDED
//   HANDOVER_PENDING stays until verified / disputed / auto-released (timeout
//   uses the SAME release path as manual verification — no separate flow).
// ---------------------------------------------------------------------------

export const TXN_STATUSES = [
  'DEAL_CONFIRMED',
  'ESCROW_PENDING',
  'ESCROW_LOCKED',
  'HANDOVER_PENDING',
  'HANDOVER_VERIFIED',
  'COMPLETED',
  'DISPUTED',
  'ADMIN_REVIEW',
  'RESOLVED',
  'REFUNDED',
] as const;

export type TxnStatus = (typeof TXN_STATUSES)[number];

const ALLOWED: Record<TxnStatus, TxnStatus[]> = {
  DEAL_CONFIRMED: ['ESCROW_PENDING'],
  ESCROW_PENDING: ['ESCROW_LOCKED'],
  ESCROW_LOCKED: ['HANDOVER_PENDING', 'DISPUTED'],
  HANDOVER_PENDING: ['HANDOVER_VERIFIED', 'DISPUTED'],
  HANDOVER_VERIFIED: ['COMPLETED'],
  COMPLETED: [],
  DISPUTED: ['ADMIN_REVIEW'],
  ADMIN_REVIEW: ['RESOLVED'],
  RESOLVED: ['COMPLETED', 'REFUNDED'],
  REFUNDED: [],
};

export function assertTransition(from: TxnStatus, to: TxnStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new TransitionError(`Illegal state transition ${from} → ${to}`);
  }
}

export class TransitionError extends Error {}

export function transitionErrorResponse(err: unknown) {
  if (err instanceof TransitionError) {
    return jsonError(409, 'INVALID_TRANSITION', err.message);
  }
  return null;
}

// The ONE state-change write path. Caller owns BEGIN/COMMIT and the
// FOR UPDATE lock on the row.
export async function transition(
  client: PoolClient,
  txnId: string,
  to: TxnStatus,
): Promise<TxnRow> {
  const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
    txnId,
  ]);
  if (!cur.rows[0]) throw new TransitionError('Transaction row disappeared mid-txn');
  const from = cur.rows[0].status as TxnStatus;
  assertTransition(from, to);
  const res = await client.query<TxnRow>(
    `UPDATE transactions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [txnId, to],
  );
  return res.rows[0];
}

export type TxnRow = {
  id: string;
  offer_id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount_paise: string | number;
  quantity: number;
  currency: string;
  status: string;
  razorpay_order_id: string | null;
  payout_id: string | null;
  payout_attempts: number;
  pin_hash: string | null;
  pin_ciphertext: string | null;
  pin_nonce: string | null;
  pin_generated_at: Date | string | null;
  qr_ciphertext: string | null;
  qr_nonce: string | null;
  qr_expires_at: Date | string | null;
  escrow_locked_at: Date | string | null;
  release_deadline: Date | string | null;
  handover_locked: boolean;
  failed_attempts: number;
  dispute_id: string | null;
  /** TRUE only for transactions created through the development-only demo
   *  adapter (SIMULATION MODE). Every real transaction is FALSE. */
  demo: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PurchaseCategory = 'PURCHASE' | 'SALE' | 'FAILURE';

export function classifyPurchaseRole(row: TxnRow, authenticatedUserId: string): PurchaseCategory {
  const buyerIsMe = row.buyer_id === authenticatedUserId;
  const sellerIsMe = row.seller_id === authenticatedUserId;
  if (row.status === 'REFUNDED') return 'FAILURE';
  if (buyerIsMe) return 'PURCHASE';
  if (sellerIsMe) return 'SALE';
  throw new TransitionError('Authenticated user is not a party to this transaction');
}

export function isTxnFinalState(status: string): boolean {
  const s = status as TxnStatus;
  return s === 'COMPLETED' || s === 'REFUNDED' || s === 'DISPUTED' || s === 'ADMIN_REVIEW' || s === 'RESOLVED';
}

// One shared single-txn audit writer (insert-only table).
export async function writeAudit(
  client: PoolClient,
  params: { transactionId?: string | null; actorId?: string | null; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `INSERT INTO transaction_audit (transaction_id, actor_id, action, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      params.transactionId ?? null,
      params.actorId ?? null,
      params.action,
      JSON.stringify(params.detail ?? {}),
    ],
  );
}

export function newDbTxn(): Promise<PoolClient> {
  return pool.connect();
}
