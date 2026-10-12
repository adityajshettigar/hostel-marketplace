import type { Step } from "@/components/ui/stepper";
import type { Fulfillment, Transaction } from "@/lib/api/types";

/**
 * The single source of truth for the order lifecycle shown to users.
 *
 * Every stage is derived from AUTHORITATIVE backend state — the marketplace
 * offer status plus the transaction-service escrow/fulfilment rows — never
 * from React state or a button having been clicked:
 *
 *   1. Order Placed                     offer ACCEPTED / transaction exists
 *   2. Order Accepted by Seller         offer.status === "ACCEPTED"
 *   3. Payment to Escrow Account        transaction ESCROW_LOCKED or beyond
 *   4. Item being brought to your Room  fulfilment IN_DELIVERY / DELIVERED
 *   5. Awaiting Buyer Receipt Confirmation
 *                                       handover PIN/QR verified, buyer silent
 *   6. Order Delivered Successfully     fulfilment DELIVERED (buyer said yes)
 *
 * The buyer's explicit Yes/No answer gates stage 6, so the 48h auto-release
 * timer can never mark an unanswered order delivered.
 */
export const ORDER_STAGE_LABELS = [
  "Order Placed",
  "Order Accepted by Seller",
  "Payment to Escrow Account",
  "Item being brought to your Room",
  "Awaiting Buyer Receipt Confirmation",
  "Order Delivered Successfully",
] as const;

/** Escrow states that mean the buyer's money is really held in escrow. */
const ESCROW_FUNDED = new Set(["ESCROW_LOCKED", "HANDOVER_PENDING", "HANDOVER_VERIFIED", "COMPLETED"]);
/** Terminal unsuccessful states — the transaction will not complete normally. */
const FAILED_STATES = new Set(["REFUNDED", "CANCELLED"]);

export type OrderParty = "buyer" | "seller";

export type OrderInput = {
  fulfill: Fulfillment | null;
  transaction: Transaction | null;
  role: OrderParty;
  offerStatus: string;
  /** Purchase-history classification when known (Bought / Sold / Failed). */
  category?: "PURCHASE" | "SALE" | "FAILURE";
};

export type OrderView = {
  /** Six stages with completed / current / upcoming / exception states. */
  steps: Step[];
  /** 0-based index of the stage the order is sitting on. */
  stageIndex: number;
  /** Real escrow status — never replaced by the Bought/Sold/Failed label. */
  transactionStatus: string | null;
  /** Bought / Sold / Failed perspective label. */
  perspective: "Bought" | "Sold" | "Failed";
  escrowFunded: boolean;
  failed: boolean;
  delivered: boolean;
  buyerCanConfirm: boolean;
  buyerDeclined: boolean;
  sellerCanStartDelivery: boolean;
  /** Seller still has to verify the buyer's PIN/QR for this order. */
  needsHandoverVerification: boolean;
  payoutPending: boolean;
  /** Human-readable current stage label (or the failure reason). */
  currentLabel: string;
};

export function deriveOrderView(input: OrderInput): OrderView {
  const { fulfill, transaction, role, offerStatus } = input;
  const status = transaction?.status ?? null;
  const fulfillStatus = fulfill?.status ?? null;

  const failed = status !== null && FAILED_STATES.has(status);
  const disputed = status === "DISPUTED" || status === "ADMIN_REVIEW" || status === "FROZEN";
  const delivered = fulfillStatus === "DELIVERED";
  const escrowFunded = status !== null && ESCROW_FUNDED.has(status);
  const accepted = offerStatus === "ACCEPTED" || fulfill !== null;

  const stage1 = Boolean(transaction) || accepted;
  const stage2 = accepted;
  const stage3 = escrowFunded;
  const stage4 = fulfillStatus === "IN_DELIVERY" || fulfillStatus === "DELIVERED";
  const stage5 = fulfill?.buyerReceived === true;
  const stage6 = delivered;

  const flags = [stage1, stage2, stage3, stage4, stage5, stage6];
  // Exceptions (failed escrow / buyer denied receipt / dispute) win over
  // "completed" so a broken order never reads as a finished one.
  const exceptionAt = failed
    ? flags.findIndex((f) => !f)
    : fulfill?.buyerReceived === false
      ? 4
      : disputed
        ? 4
        : -1;

  let stageIndex = flags.findIndex((f) => !f);
  if (stageIndex === -1) stageIndex = ORDER_STAGE_LABELS.length - 1;
  if (exceptionAt >= 0) stageIndex = exceptionAt;

  const steps: Step[] = ORDER_STAGE_LABELS.map((label, i) => {
    let state: Step["state"];
    if (exceptionAt === i) state = "exception";
    else if (flags[i]) state = "completed";
    else if (i === stageIndex) state = "current";
    else state = "upcoming";
    return { label, state };
  });

  // `fulfill === null` is allowed: the seller can verify the handover without
  // ever recording a delivery start, and the server accepts the buyer's answer
  // in that case too (it records the in-delivery row itself). Gating on the
  // row alone would hide the prompt and strand the order.
  const buyerCanConfirm =
    role === "buyer" &&
    (fulfill === null || fulfillStatus === "IN_DELIVERY") &&
    status === "HANDOVER_VERIFIED" &&
    fulfill?.buyerReceived !== true;

  const sellerCanStartDelivery =
    role === "seller" &&
    accepted &&
    escrowFunded &&
    (fulfill === null || fulfillStatus === "ORDER_PLACED" || fulfillStatus === "ORDER_ACCEPTED");

  const needsHandoverVerification =
    role === "seller" && fulfillStatus === "IN_DELIVERY" && status === "HANDOVER_PENDING";

  const payoutPending =
    delivered && status !== "COMPLETED" && transaction?.payoutId === null;

  const perspective: OrderView["perspective"] =
    input.category === "FAILURE" || failed ? "Failed" : role === "seller" ? "Sold" : "Bought";

  const currentLabel = failed
    ? "Transaction failed"
    : disputed
      ? "Under review (escrow frozen)"
      : fulfill?.buyerReceived === false
        ? "Buyer says the item has not arrived"
        : steps[Math.max(0, Math.min(stageIndex, steps.length - 1))].label;

  return {
    steps,
    stageIndex,
    transactionStatus: status,
    perspective,
    escrowFunded,
    failed,
    delivered,
    buyerCanConfirm,
    buyerDeclined: fulfill?.buyerReceived === false,
    sellerCanStartDelivery,
    needsHandoverVerification,
    payoutPending,
    currentLabel,
  };
}

/** Human label for the raw escrow status (never conflated with Bought/Sold). */
export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  DEAL_CONFIRMED: "Deal confirmed — waiting for payment",
  ESCROW_PENDING: "Waiting for payment to escrow",
  ESCROW_LOCKED: "Payment held in escrow",
  HANDOVER_PENDING: "Handover pending (PIN/QR)",
  HANDOVER_VERIFIED: "Handover verified — waiting for buyer confirmation",
  COMPLETED: "Completed — seller paid",
  DISPUTED: "Disputed — escrow frozen",
  ADMIN_REVIEW: "Under admin review",
  FROZEN: "Frozen",
  RESOLVED: "Resolved by admin",
  REFUNDED: "Refunded to buyer",
  CANCELLED: "Cancelled",
};

export function statusLabel(status: string | null): string {
  if (!status) return "Not started";
  return TRANSACTION_STATUS_LABELS[status] ?? status;
}
