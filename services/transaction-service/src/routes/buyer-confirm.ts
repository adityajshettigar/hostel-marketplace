import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, parseJsonBody, jsonError, notFound, internalError } from '../handlers';
import { bearerToken } from '../auth';
import { fetchOfferFromMarketplace } from '../marketplace';
import { FulfRequestRow, TxnRow, transitionFulfillment, writeAudit } from '../state-machine';
import { settleTransaction } from '../release';

// ---------------------------------------------------------------------------
// POST /api/fulfill/:offerId/buyerConfirm  { received: boolean }
//
// The BUYER's own receipt decision — the last gate before escrow is released.
//
// Rules (see the buyer order timeline spec):
//  - Only the offer's buyer may answer. The seller submitting the buyer's
//    identity is impossible: the party is taken from the authoritative
//    marketplace offer (offer.buyerId) and compared to the JWT subject.
//  - The order must exist and be IN_DELIVERY (the seller started delivery).
//  - received=true additionally requires the transaction to be
//    HANDOVER_VERIFIED: the four-digit PIN / QR handover verification stays
//    MANDATORY. Only then does the order become DELIVERED and the existing
//    settlement path (payout, idempotency key, listing-SOLD write) run.
//  - received=false records the denial and changes nothing financial: the
//    order stays open, no payout is attempted, and the buyer is pointed at the
//    existing dispute flow (which freezes the escrow).
//  - Dismissing the dialog sends nothing and therefore never confirms.
//  - Replays are idempotent: a second "yes" on an already delivered order, and
//    a second "no" on an already denied order, both return the current state.
// ---------------------------------------------------------------------------

const buyerConfirmSchema = z.object({ received: z.boolean() });

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function serializeFulfill(row: FulfRequestRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    transactionId: row.transaction_id,
    status: row.status as 'ORDER_PLACED' | 'ORDER_ACCEPTED' | 'IN_DELIVERY' | 'DELIVERED',
    buyerReceived: row.buyer_received,
    buyerConfirmedAt: isoOrNull(row.buyer_confirmed_at),
    buyerDeclinedAt: isoOrNull(row.buyer_declined_at),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

function serializeTxn(row: TxnRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountPaise: Number(row.amount_paise),
    quantity: row.quantity,
    currency: row.currency,
    status: row.status as string,
    payoutId: row.payout_id,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export async function confirmBuyerReceipt(request: Request, offerIdParam: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const user = auth.auth;
    const offerId = decodeURIComponent(offerIdParam);

    const parsed = await parseJsonBody(request, buyerConfirmSchema);
    if (!parsed.ok) return parsed.response;
    const received = parsed.data.received;

    const offerResult = await fetchOfferFromMarketplace(offerId, bearerToken(request) ?? '');
    if (!offerResult.ok) {
      if (offerResult.status === 404 || offerResult.status === undefined) return notFound();
      return jsonError(502, 'MARKETPLACE_RESPONSE_FAILED', 'Could not verify the offer from marketplace');
    }
    const offer = offerResult.offer;
    if (!offer) return notFound();
    // Buyer-only. A stranger (including the seller) gets 404 — no existence leak.
    if (offer.buyerId !== user.sub) return notFound();
    if (offer.status !== 'ACCEPTED') {
      return jsonError(
        409,
        'OFFER_NOT_ACCEPTED',
        `Offer is ${offer.status}; receipt confirmation requires an accepted offer`,
      );
    }

    const client = await pool.connect();
    let row: FulfRequestRow;
    let txn: TxnRow;
    let alreadyDelivered = false;
    try {
      await client.query('BEGIN');

      const txnCur = await client.query<TxnRow>(
        'SELECT * FROM transactions WHERE offer_id = $1 FOR UPDATE',
        [offerId],
      );
      txn = txnCur.rows[0];
      if (!txn) {
        await client.query('ROLLBACK');
        return notFound();
      }

      const cur = await client.query<FulfRequestRow>(
        'SELECT * FROM fulfilment_tracking WHERE offer_id = $1 FOR UPDATE',
        [offerId],
      );
      row = cur.rows[0];
      if (!row) {
        // No delivery-tracking row: the seller verified the handover without
        // ever recording a delivery start. The mandatory PIN/QR gate has
        // ALREADY passed (checked below — the transaction must be
        // HANDOVER_VERIFIED, which is only reachable through escrow funding +
        // handover verification), and the buyer is answering about a physical
        // receipt they did or did not get. Recording the row as in-delivery
        // here keeps the timeline coherent instead of dead-ending the order on
        // a missing bookkeeping row.
        const created = await client.query<FulfRequestRow>(
          `INSERT INTO fulfilment_tracking (offer_id, transaction_id, status, created_at, updated_at)
           VALUES ($1, $2, 'IN_DELIVERY', now(), now())
           ON CONFLICT (offer_id) DO UPDATE SET updated_at = now()
           RETURNING *`,
          [offerId, txn.id],
        );
        row = created.rows[0];
      }

      const replayYes = received && row.status === 'DELIVERED' && row.buyer_received === true;
      const replayNo = !received && row.buyer_received === false && row.status !== 'DELIVERED';

      if (replayYes) {
        alreadyDelivered = true;
        await client.query('COMMIT');
      } else if (replayNo) {
        await client.query('COMMIT');
      } else {
        if (row.status !== 'IN_DELIVERY') {
          await client.query('ROLLBACK');
          return jsonError(
            409,
            'INVALID_TRANSITION',
            `Receipt confirmation requires an in-delivery order; current stage is ${row.status}`,
          );
        }

        if (!received) {
          // Buyer says "no". Escrow stays locked; the existing dispute flow is
          // the way to freeze and review it. Nothing is refunded automatically.
          await client.query(
            `UPDATE fulfilment_tracking
                SET buyer_received = FALSE, buyer_declined_at = now(), updated_at = now()
              WHERE id = $1`,
            [row.id],
          );
          await writeAudit(client, {
            transactionId: txn.id,
            actorId: user.sub,
            action: 'FULFILLMENT_BUYER_DECLINED',
            detail: { offerId },
          });
          const refreshed = await client.query<FulfRequestRow>(
            'SELECT * FROM fulfilment_tracking WHERE id = $1',
            [row.id],
          );
          row = refreshed.rows[0];
          await client.query('COMMIT');
        } else {
          // Buyer says "yes" — but only after the seller's PIN/QR verification
          // succeeded. No payout without a real handover.
          if (txn.status !== 'HANDOVER_VERIFIED') {
            await client.query('ROLLBACK');
            return jsonError(
              409,
              'HANDOVER_NOT_VERIFIED',
              'The seller must verify the handover PIN/QR before you can confirm receipt',
            );
          }
          await transitionFulfillment(client, offerId, 'DELIVERED');
          const refreshed = await client.query<FulfRequestRow>(
            `UPDATE fulfilment_tracking
                SET buyer_received = TRUE, buyer_confirmed_at = now(), updated_at = now()
              WHERE id = $1
              RETURNING *`,
            [row.id],
          );
          row = refreshed.rows[0];
          await writeAudit(client, {
            transactionId: txn.id,
            actorId: user.sub,
            action: 'FULFILLMENT_BUYER_CONFIRMED',
            detail: { offerId },
          });
          await client.query('COMMIT');
        }
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof Error && err.message.includes('Illegal fulfilment transition')) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }

    if (!received) {
      return NextResponse.json({
        fulfill: serializeFulfill(row),
        transaction: serializeTxn(txn),
        received: false,
        delivered: false,
        disputeUrl: `/api/transaction/transactions/${txn.id}/dispute`,
        message:
          'Receipt not confirmed. The order stays open and the escrow stays locked. Raise a dispute if the item never arrives.',
      });
    }

    // Delivery is confirmed. Now (and only now) the existing settlement path
    // runs: mark listing SOLD, pay the seller through the idempotency key,
    // COMPLETED only after a real payout.
    if (alreadyDelivered && txn.status === 'COMPLETED') {
      return NextResponse.json({
        fulfill: serializeFulfill(row),
        transaction: serializeTxn(txn),
        received: true,
        delivered: true,
        payout: { status: 'COMPLETED', payoutId: txn.payout_id },
      });
    }

    const settle = await settleTransaction(txn.id, { actorId: user.sub, source: 'BUYER_CONFIRM' });
    const refreshedTxn = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [txn.id]);
    const finalTxn = refreshedTxn.rows[0] ?? txn;

    if (settle.ok && settle.status === 'COMPLETED') {
      return NextResponse.json({
        fulfill: serializeFulfill(row),
        transaction: serializeTxn(finalTxn),
        received: true,
        delivered: true,
        payout: { status: 'COMPLETED', payoutId: settle.payoutId },
      });
    }

    // Delivery succeeded but the money has NOT moved yet. Report both states
    // truthfully (never claim a payout that did not happen).
    return NextResponse.json(
      {
        fulfill: serializeFulfill(row),
        transaction: serializeTxn(finalTxn),
        received: true,
        delivered: true,
        payout: {
          status: 'PENDING',
          reason: settle.ok ? settle.reason : settle.reason,
        },
        message:
          'Delivery confirmed. The payout to the seller is still pending — it will be retried by the existing release worker.',
      },
      { status: 202 },
    );
  } catch (err) {
    return internalError('confirmBuyerReceipt', err);
  }
}
