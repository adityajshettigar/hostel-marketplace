"use client";

import * as React from "react";
import Link from "next/link";
import { PartyDetails } from "@/components/orders/party-details";
import { Button, Badge, EmptyState, Modal, Stepper } from "@/components/ui";
import { useFulfillment, usePurchaseDetail } from "@/lib/api/queries";
import { useConfirmReceipt, useStartDelivery } from "@/lib/api/mutations";
import { deriveOrderView, statusLabel } from "@/lib/orders";
import { cloudinaryThumb } from "@/lib/cloudinary";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/**
 * One dialog for every order, buyer or seller, opened from the Purchases history
 * or from My Orders. It reads the buyer/seller names + first image from the
 * transaction record (server-selected) and the stage from the fulfilment +
 * escrow rows, so the same order always renders the same way in either place.
 */
export function OrderDetailDialog({
  open,
  onClose,
  transactionId,
  offerId,
  onPickOther,
}: {
  open: boolean;
  onClose: () => void;
  /** Transaction id (details: buyer, seller, item, image). */
  transactionId: string;
  /** Offer id (the fulfilment/timeline is keyed by offer). */
  offerId: string;
  /** Optional secondary action, e.g. file a dispute. */
  onPickOther?: React.ReactNode;
}) {
  const detail = usePurchaseDetail(open ? transactionId : "");
  const fulfill = useFulfillment(open ? offerId : "");
  const startDelivery = useStartDelivery(offerId);
  const confirmReceipt = useConfirmReceipt(offerId);
  const [askReceipt, setAskReceipt] = React.useState(false);

  React.useEffect(() => {
    if (!open) setAskReceipt(false);
  }, [open]);

  const purchase = detail.data?.purchase ?? null;
  const view = React.useMemo(
    () =>
      fulfill.data
        ? deriveOrderView({
            fulfill: fulfill.data.fulfill,
            transaction: fulfill.data.transaction,
            role: fulfill.data.role,
            offerStatus: fulfill.data.offerStatus,
            category: purchase?.category,
          })
        : null,
    [fulfill.data, purchase?.category],
  );

  const loading = detail.isLoading || fulfill.isLoading;

  return (
    <Modal open={open} onClose={onClose} title="Order details" panelClassName="max-w-2xl">
      {loading ? (
        <EmptyState title="Loading order…" body="Fetching the transaction and its delivery stage." />
      ) : detail.isError || fulfill.isError ? (
        <EmptyState
          title="Details unavailable"
          body="This order could not be loaded — it may belong to another account, or the service is unreachable."
        />
      ) : !purchase ? (
        <EmptyState title="Transaction not found" body="No transaction is associated with this entry." />
      ) : (
        <div className="flex flex-col gap-5">
          {/* ITEM — name, first image, amount, order id/date */}
          <div className="flex gap-4">
            <div className="h-24 w-24 shrink-0 border-4 border-black bg-muted">
              {purchase.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cloudinaryThumb(purchase.imageUrl, 240)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-widest text-black/50">
                  No image
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-black/60">
                {view?.perspective ?? (purchase.role === "seller" ? "Sold" : "Bought")}
              </p>
              <p className="mt-0.5 text-lg font-black uppercase tracking-tight">
                {purchase.listing?.title ?? "Item"}
              </p>
              <p className="mt-1 text-xl font-black tabular-nums">
                {formatCurrency(purchase.amountPaise / 100)}
              </p>
              <p className="mt-1 font-mono text-[10px] font-bold tabular-nums text-black/60">
                {purchase.id.slice(0, 8).toUpperCase()} · {formatDateTime(purchase.createdAt ?? "")}
              </p>
            </div>
          </div>

          {/* REAL ESCROW STATUS (never replaced by the Bought/Sold label) */}
          <div className="flex flex-wrap items-center gap-2 border-t-4 border-black pt-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-black/60">Escrow</span>
            <Badge tone={view?.failed ? "red" : purchase.status === "COMPLETED" ? "black" : "yellow"}>
              {statusLabel(purchase.status)}
            </Badge>
          </div>

          {/* BUYER / SELLER — private delivery details to the parties only */}
          <div className="grid gap-3 sm:grid-cols-2">
            <PartyDetails
              label={`Buyer${purchase.role === "buyer" ? " (you)" : ""}`}
              name={purchase.buyer?.fullName}
              hostelBlock={purchase.buyer?.hostelBlock}
              roomNumber={purchase.buyer?.roomNumber}
              phone={purchase.buyer?.phone}
            />
            <PartyDetails
              label={`Seller${purchase.role === "seller" ? " (you)" : ""}`}
              name={purchase.seller?.fullName}
              hostelBlock={purchase.seller?.hostelBlock}
              roomNumber={purchase.seller?.roomNumber}
              phone={purchase.seller?.phone}
            />
          </div>

          {/* TIMELINE */}
          {view ? (
            <div className="border-t-4 border-black pt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-black/60">
                Order timeline
              </p>
              <div className="mt-4">
                <Stepper steps={view.steps} vertical />
              </div>
              {fulfill.data?.fulfill?.buyerDeclinedAt ? (
                <p role="alert" className="mt-3 border-2 border-black bg-yellow-soft px-3 py-2 text-xs font-bold uppercase tracking-wide">
                  The buyer answered &ldquo;not received&rdquo;. Escrow stays locked — use the dispute flow.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="border-t-4 border-black pt-3 text-xs font-bold uppercase tracking-widest text-black/60">
              The seller has not started delivery yet.
            </p>
          )}

          {/* ACTIONS */}
          <div className="flex flex-wrap items-center gap-2 border-t-4 border-black pt-4">
            {view?.buyerCanConfirm ? (
              askReceipt ? (
                <>
                  <span className="w-full text-xs font-bold uppercase tracking-widest">
                    Did the item reach you?
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={confirmReceipt.isPending}
                    onClick={() => confirmReceipt.mutate(true)}
                  >
                    Yes, I received it
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={confirmReceipt.isPending}
                    onClick={() => confirmReceipt.mutate(false)}
                  >
                    No, not received
                  </Button>
                </>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setAskReceipt(true)}>
                  Confirm receipt
                </Button>
              )
            ) : null}

            {view?.sellerCanStartDelivery ? (
              <Button
                variant="primary"
                size="sm"
                loading={startDelivery.isPending}
                onClick={() => startDelivery.mutate()}
              >
                Start delivery
              </Button>
            ) : null}

            {view?.needsHandoverVerification ? (
              <Link href={`/transactions/${purchase.id}`}>
                <Button variant="yellow" size="sm">
                  Verify handover PIN / QR
                </Button>
              </Link>
            ) : null}

            {view?.buyerDeclined ? (
              <Link href={`/transactions/${purchase.id}`}>
                <Button variant="secondary" size="sm">
                  Open dispute / report a problem
                </Button>
              </Link>
            ) : null}

            <Link href={`/transactions/${purchase.id}`} className="ml-auto">
              <Button variant="outline" size="sm">
                Full transaction
              </Button>
            </Link>
            {onPickOther}
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
