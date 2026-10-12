import type { TxnRow, FulfRequestRow } from './state-machine';

// ---------------------------------------------------------------------------
// Order timeline (project demonstration task)
//
// Pure function: turns the AUTHORITATIVE backend state of one order into the
// ordered, timestamped event list the UI renders. Nothing here is hardcoded on
// the client and nothing is invented — a stage only becomes "completed" when a
// real audit row, timestamp or fulfilment column says so, and a stage the
// application cannot source a timestamp for is reported as unknown (at: null),
// never with a made-up date.
//
// The stage list mirrors the actual lifecycle:
//   listing published -> order placed -> escrow funded -> delivery started
//     -> PIN/QR verified -> buyer confirmed receipt -> completed (payout)
// ---------------------------------------------------------------------------

export type TimelineActor = 'buyer' | 'seller' | 'admin' | 'system';

export type TimelineStage = {
  key: string;
  label: string;
  description: string;
  state: 'completed' | 'current' | 'upcoming' | 'exception';
  /** ISO timestamp, or null when the backend has no timestamp for it. */
  at: string | null;
  actor: TimelineActor | null;
  /** True for stages the SIMULATION MODE adapter produced instead of a provider. */
  simulated: boolean;
};

export type AuditEvent = {
  action: string;
  actorId: string | null;
  createdAt: string | null;
  detail: Record<string, unknown>;
};

export type TimelineInput = {
  txn: Pick<
    TxnRow,
    | 'id'
    | 'status'
    | 'demo'
    | 'created_at'
    | 'escrow_locked_at'
    | 'buyer_id'
    | 'seller_id'
    | 'payout_id'
    | 'failed_attempts'
    | 'handover_locked'
  >;
  audit: AuditEvent[];
  fulfilment:
    | Pick<FulfRequestRow, 'status' | 'buyer_received' | 'buyer_confirmed_at' | 'buyer_declined_at'>
    | null;
  /** Listing publication time, when the marketplace could supply it. */
  listingPublishedAt?: string | null;
  listingTitle?: string | null;
};

export type OrderTimeline = {
  transactionId: string;
  status: string;
  demo: boolean;
  listingTitle: string | null;
  stages: TimelineStage[];
  /** True while the order still has somewhere to go. */
  complete: boolean;
};

function iso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function firstAudit(audit: AuditEvent[], ...actions: string[]): AuditEvent | undefined {
  return audit.find((e) => actions.includes(e.action));
}

function actorFor(
  event: AuditEvent | undefined,
  txn: TimelineInput['txn'],
  fallback: TimelineActor,
): TimelineActor | null {
  if (!event?.actorId) return fallback;
  if (event.actorId === txn.buyer_id) return 'buyer';
  if (event.actorId === txn.seller_id) return 'seller';
  return 'admin';
}

export function buildTransactionTimeline(input: TimelineInput): OrderTimeline {
  const { txn, audit, fulfilment } = input;
  const demo = txn.demo === true;

  const escrowInit = firstAudit(audit, 'ESCROW_INITIATED');
  const escrowLocked = firstAudit(audit, 'ESCROW_LOCKED', 'DEMO_ESCROW_LOCKED');
  const demoLocked = firstAudit(audit, 'DEMO_ESCROW_LOCKED');
  const startDelivery = firstAudit(audit, 'FULFILLMENT_START_DELIVERY');
  const handoverOk = firstAudit(audit, 'HANDOVER_ATTEMPT_SUCCESS');
  const handoverVerified = firstAudit(audit, 'HANDOVER_VERIFIED_AWAITING_BUYER');
  const completed = firstAudit(audit, 'COMPLETED_BUYER_CONFIRMED', 'COMPLETED_MANUAL', 'AUTO_RELEASED');
  const payoutAttempt = firstAudit(audit, 'PAYOUT_ATTEMPT');

  const declinedAt = iso(fulfilment?.buyer_declined_at ?? null);
  const confirmedAt = iso(fulfilment?.buyer_confirmed_at ?? null);

  // Stage timestamps come from the first authoritative source that has one.
  const atOrderPlaced = iso(txn.created_at);
  const atEscrow = iso(txn.escrow_locked_at) ?? escrowInit?.createdAt ?? escrowLocked?.createdAt ?? null;
  const atHandover = startDelivery?.createdAt ?? null;
  const atVerified = handoverOk?.createdAt ?? handoverVerified?.createdAt ?? null;
  const atCompleted =
    completed?.createdAt ?? (txn.status === 'COMPLETED' ? (payoutAttempt?.createdAt ?? null) : null);

  const stages: TimelineStage[] = [
    {
      key: 'listing_published',
      label: 'Listing published',
      description: 'The seller published the item on the market.',
      state: input.listingPublishedAt ? 'completed' : 'upcoming',
      at: iso(input.listingPublishedAt ?? null),
      actor: 'seller',
      simulated: false,
    },
    {
      key: 'order_placed',
      label: 'Order placed',
      description:
        'The offer was accepted and the order was created. The listing, price and quantity are now snapshotted on this transaction.',
      state: atOrderPlaced ? 'completed' : 'upcoming',
      at: atOrderPlaced,
      actor: 'buyer',
      simulated: false,
    },
    {
      key: 'escrow_funded',
      label: demo ? 'Escrow funded (simulated)' : 'Payment to escrow account',
      description: demoLocked
        ? 'SIMULATED escrow funding: no payment provider was contacted and no money moved.'
        : escrowInit
          ? 'The buyer initiated the escrow payment and the funds were locked.'
          : 'Waiting for the buyer to fund the escrow.',
      state: atEscrow ? 'completed' : 'upcoming',
      at: atEscrow,
      actor: actorFor(escrowInit ?? escrowLocked, txn, 'buyer'),
      simulated: Boolean(demoLocked),
    },
    {
      key: 'handover_started',
      label: 'Handover to your room',
      description: 'The seller started the handover and is bringing the item to the buyer.',
      state: atHandover ? 'completed' : 'upcoming',
      at: atHandover,
      actor: 'seller',
      simulated: false,
    },
    {
      key: 'handover_verified',
      label: 'PIN / QR handover verified',
      description:
        'The seller verified the buyer\'s handover credential. Attempt limits and PIN validation were enforced exactly as for a real order.',
      state: atVerified ? 'completed' : 'upcoming',
      at: atVerified,
      actor: actorFor(handoverOk ?? handoverVerified, txn, 'seller'),
      simulated: false,
    },
    {
      key: 'receipt_confirmed',
      label: declinedAt ? 'Buyer reported a delivery issue' : 'Buyer confirmed receipt',
      description: declinedAt
        ? 'The buyer answered that the item did not arrive. Escrow stays frozen for review.'
        : confirmedAt
          ? 'The buyer confirmed, in the app, that the item was received.'
          : 'Waiting for the buyer to confirm receipt.',
      state: declinedAt ? 'exception' : confirmedAt ? 'completed' : 'upcoming',
      at: confirmedAt ?? declinedAt,
      actor: 'buyer',
      simulated: false,
    },
    {
      key: 'completed',
      label: demo ? 'Order completed (simulated payout)' : 'Order completed',
      description: demo
        ? 'SIMULATED payout: the demo adapter recorded the transfer instead of Razorpay. No real funds were paid to the seller.'
        : txn.status === 'COMPLETED'
          ? 'The escrow was released to the seller.'
          : 'Releases to the seller only after the buyer confirms receipt.',
      state: txn.status === 'COMPLETED' ? 'completed' : 'upcoming',
      at: atCompleted,
      actor: 'system',
      simulated: demo && txn.status === 'COMPLETED',
    },
  ];

  // Order the stages: completed ones first, then the first incomplete one is
  // "current", the rest stay "upcoming". Exception states (buyer denial, frozen
  // escrow) win so a broken order never reads as a healthy one.
  let seenIncomplete = false;
  for (const stage of stages) {
    if (stage.state === 'exception') {
      seenIncomplete = true;
      continue;
    }
    if (stage.state === 'completed') continue;
    stage.state = seenIncomplete ? 'upcoming' : 'current';
    seenIncomplete = true;
  }

  // A frozen escrow (dispute) surfaces on the stage it stopped at.
  if (txn.status === 'DISPUTED' || txn.status === 'ADMIN_REVIEW' || txn.status === 'REFUNDED') {
    const stopAt = stages.find((s) => s.state === 'current');
    if (stopAt) {
      stopAt.state = 'exception';
      stopAt.description =
        txn.status === 'REFUNDED'
          ? 'The order was refunded to the buyer by an administrator.'
          : 'The escrow is frozen while a dispute is being reviewed.';
    }
  }

  // A handover locked after 3 wrong attempts is an operational exception, not
  // a silently pending stage.
  if (txn.handover_locked) {
    const verify = stages.find((s) => s.key === 'handover_verified');
    if (verify && verify.state !== 'completed') {
      verify.state = 'exception';
      verify.description = 'Handover is locked after 3 failed verification attempts; an administrator must unlock it.';
    }
  }

  return {
    transactionId: txn.id,
    status: txn.status,
    demo,
    listingTitle: input.listingTitle ?? null,
    stages,
    complete: stages.every((s) => s.state === 'completed'),
  };
}
