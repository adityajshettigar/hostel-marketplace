"use client";

import * as React from "react";
import Link from "next/link";
import { RequireAuth } from "@/lib/auth/auth_context";
import { useFulfillment, usePurchases } from "@/lib/api/queries";
import { useConfirmReceipt, useStartDelivery } from "@/lib/api/mutations";
import { Button, Badge, Card, CardContent, EmptyState, Skeleton, Stepper } from "@/components/ui";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";
import { cloudinaryThumb } from "@/lib/cloudinary";
import { deriveOrderView, statusLabel } from "@/lib/orders";
import { formatCurrency } from "@/lib/utils";
import type { PurchaseEntry } from "@/lib/api/types";

/** Orders that can still move — the terminal ones live in Purchases history. */
const ACTIVE_STATUSES = new Set([
  "DEAL_CONFIRMED",
  "ESCROW_PENDING",
  "ESCROW_LOCKED",
  "HANDOVER_PENDING",
  "HANDOVER_VERIFIED",
  "DISPUTED",
  "ADMIN_REVIEW",
  "FROZEN",
]);

export default function MyOrdersPage() {
  return (
    <RequireAuth>
      <MyOrdersInner />
    </RequireAuth>
  );
}

function MyOrdersInner() {
  const [selected, setSelected] = React.useState<PurchaseEntry | null>(null);
  const buying = usePurchases("buying");
  const selling = usePurchases("selling");

  const entries = React.useMemo<PurchaseEntry[]>(() => {
    const all = [
      ...(buying.data?.pages.flatMap((p) => p.purchases) ?? []),
      ...(selling.data?.pages.flatMap((p) => p.purchases) ?? []),
    ];
    const seen = new Set<string>();
    return all
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .filter((p) => ACTIVE_STATUSES.has(p.status))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [buying.data, selling.data]);

  if (buying.isLoading || selling.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <div className="mt-4 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </main>
    );
  }

  if (buying.isError || selling.isError) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyState
          title="Could not load orders"
          body="The gateway did not answer. Check that the stack is running, then retry."
          action={
            <Button
              variant="primary"
              onClick={() => {
                void buying.refetch();
                void selling.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <main id="main">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">My Orders</h1>
            <p className="mt-1 text-sm font-medium text-black/70">
              Live orders only — order placed, accepted, escrow, delivery, receipt confirmation.
            </p>
          </div>
          <Link href="/purchases">
            <Button variant="outline" size="sm">Purchases history</Button>
          </Link>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="No live orders"
            body="Nothing is in progress right now. Finished and older orders are in Purchases."
            action={
              <Link href="/">
                <Button variant="primary">Browse marketplace</Button>
              </Link>
            }
          />
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {entries.map((item) => (
              <OrderCard key={item.id} entry={item} onOpen={() => setSelected(item)} />
            ))}
          </div>
        )}
      </div>

      {selected ? (
        <OrderDetailDialog
          open
          onClose={() => setSelected(null)}
          transactionId={selected.id}
          offerId={selected.offerId}
        />
      ) : null}
    </main>
  );
}

/**
 * One live order: the six-stage timeline plus whatever the CALLER can actually
 * do next (seller starts delivery / verifies the handover PIN-QR; the buyer
 * answers the receipt prompt). The server enforces every transition — these
 * buttons only reflect the authoritative stage.
 */
function OrderCard({ entry, onOpen }: { entry: PurchaseEntry; onOpen: () => void }) {
  const fulfill = useFulfillment(entry.offerId);
  const startDelivery = useStartDelivery(entry.offerId);
  const confirm = useConfirmReceipt(entry.offerId);

  const view = deriveOrderView({
    fulfill: fulfill.data?.fulfill ?? null,
    transaction: fulfill.data?.transaction ?? null,
    role: fulfill.data?.role ?? entry.role,
    offerStatus: fulfill.data?.offerStatus ?? "ACCEPTED",
    category: entry.category,
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="h-20 w-20 shrink-0 border-4 border-black bg-muted">
            {entry.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cloudinaryThumb(entry.imageUrl, 200)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[9px] font-black uppercase tracking-widest text-black/50">
                No image
              </span>
            )}
          </div>

          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={view.perspective === "Failed" ? "red" : view.perspective === "Sold" ? "blue" : "yellow"}>
                {view.perspective}
              </Badge>
              <span className="text-[10px] font-black uppercase tracking-widest text-black/60">
                {statusLabel(view.transactionStatus)}
              </span>
            </div>
            <p className="mt-1 text-base font-black uppercase tracking-tight">
              {entry.listingTitle ?? "Item"}
            </p>
            <p className="mt-0.5 text-lg font-black tabular-nums">
              {formatCurrency(entry.amountPaise / 100)}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-black/60">
              {view.currentLabel}
              {view.payoutPending ? " · payout pending" : ""}
            </p>
          </div>

          <Button variant="secondary" size="sm" onClick={onOpen}>
            View details
          </Button>
        </div>

        <div className="mt-4">
          <Stepper steps={view.steps} vertical />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {view.sellerCanStartDelivery ? (
            <Button
              variant="primary"
              size="sm"
              loading={startDelivery.isPending}
              onClick={() => startDelivery.mutate()}
            >
              Start delivery
            </Button>
          ) : null}

          {view.needsHandoverVerification ? (
            <Link href={`/transactions/${entry.id}`}>
              <Button variant="yellow" size="sm">Verify handover PIN / QR</Button>
            </Link>
          ) : null}

          {view.buyerCanConfirm ? (
            <>
              <span className="w-full text-xs font-bold uppercase tracking-widest">
                Did the item reach you?
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={confirm.isPending}
                onClick={() => confirm.mutate(true)}
              >
                Yes, I received it
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={confirm.isPending}
                onClick={() => confirm.mutate(false)}
              >
                No, not received
              </Button>
            </>
          ) : null}

          <Link href={`/transactions/${entry.id}`} className="ml-auto">
            <Button variant="outline" size="sm">Full transaction</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
