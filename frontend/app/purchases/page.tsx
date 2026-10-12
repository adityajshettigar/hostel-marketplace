"use client";

import * as React from "react";
import Link from "next/link";
import { RequireAuth } from "@/lib/auth/auth_context";
import { localDayRange, usePurchases } from "@/lib/api/queries";
import { Button, Badge, Card, CardContent, EmptyState, Skeleton, Tabs } from "@/components/ui";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";
import { cloudinaryThumb } from "@/lib/cloudinary";
import { statusLabel } from "@/lib/orders";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { PurchaseEntry } from "@/lib/api/types";

type TabId = "all" | "bought" | "sold" | "failed";
type RangeId = "today" | "all";

/** Bought / Sold / Failed — the user's PERSPECTIVE, never the escrow status. */
function perspective(item: PurchaseEntry): "Bought" | "Sold" | "Failed" {
  if (item.category === "FAILURE") return "Failed";
  return item.role === "seller" ? "Sold" : "Bought";
}

export default function PurchasesPage() {
  return (
    <RequireAuth>
      <PurchasesInner />
    </RequireAuth>
  );
}

function PurchasesInner() {
  const [range, setRange] = React.useState<RangeId>("today");
  const [tab, setTab] = React.useState<TabId>("all");
  const [selected, setSelected] = React.useState<PurchaseEntry | null>(null);

  // "Today" is the browser's LOCAL day; the boundaries go to the server as ISO
  // instants, so the filter is timezone-correct rather than a string compare.
  const window = React.useMemo(
    () => (range === "today" ? localDayRange() : undefined),
    // Recomputing on every render would refetch forever; the day is fixed per mount.
    [range],
  );

  const buying = usePurchases("buying", window);
  const selling = usePurchases("selling", window);

  const items = React.useMemo<PurchaseEntry[]>(() => {
    const all = [
      ...(buying.data?.pages.flatMap((p) => p.purchases) ?? []),
      ...(selling.data?.pages.flatMap((p) => p.purchases) ?? []),
    ];
    const seen = new Set<string>();
    return all
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [buying.data, selling.data]);

  const counts = React.useMemo(() => {
    let bought = 0;
    let sold = 0;
    let failed = 0;
    for (const p of items) {
      const label = perspective(p);
      if (label === "Bought") bought++;
      else if (label === "Sold") sold++;
      else failed++;
    }
    return { bought, sold, failed, all: items.length };
  }, [items]);

  const filtered = React.useMemo(() => {
    if (tab === "all") return items;
    if (tab === "bought") return items.filter((p) => perspective(p) === "Bought");
    if (tab === "sold") return items.filter((p) => perspective(p) === "Sold");
    return items.filter((p) => perspective(p) === "Failed");
  }, [items, tab]);

  const isLoading = buying.isLoading || selling.isLoading;
  const isError = buying.isError || selling.isError;

  return (
    <main id="main">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black uppercase tracking-tight">Purchases</h1>
          <p className="mt-1 text-sm font-medium text-black/70">
            Everything you bought and sold. Today first — the full history is one tap away.
          </p>
        </div>

        {/* Today / All toggle */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-black/60">Show</span>
          <Button
            size="sm"
            variant={range === "today" ? "primary" : "outline"}
            onClick={() => setRange("today")}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant={range === "all" ? "primary" : "outline"}
            onClick={() => setRange("all")}
          >
            All history
          </Button>
        </div>

        <Tabs
          tabs={[
            { id: "all", label: `All (${counts.all})` },
            { id: "bought", label: `Bought (${counts.bought})` },
            { id: "sold", label: `Sold (${counts.sold})` },
            { id: "failed", label: `Failed (${counts.failed})` },
          ]}
          active={tab}
          onChange={(next) => setTab(next as TabId)}
        />

        {isLoading ? (
          <div className="mt-4 flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            title="Could not load purchases"
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
        ) : filtered.length === 0 ? (
          <EmptyState
            title={range === "today" ? "Nothing today" : "No transactions yet"}
            body={
              range === "today"
                ? "No orders placed or received today. Switch to All history to see older ones."
                : "Complete a purchase or sale to see it here."
            }
            action={
              <Link href="/">
                <Button variant="primary">Browse marketplace</Button>
              </Link>
            }
          />
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {filtered.map((item) => {
              const label = perspective(item);
              return (
                <Card key={item.id}>
                  <CardContent className="flex flex-wrap gap-4 p-4">
                    <div className="h-20 w-20 shrink-0 border-4 border-black bg-muted">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cloudinaryThumb(item.imageUrl, 200)}
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
                      <p className="text-[10px] font-black uppercase tracking-widest text-black/60">
                        {formatDateTime(item.createdAt ?? "")} · {item.id.slice(0, 8).toUpperCase()}
                      </p>
                      {/* ITEM NAME — resolved server-side from marketplace-service */}
                      <p className="mt-0.5 text-base font-black uppercase tracking-tight">
                        {item.listingTitle ?? "Item"}
                      </p>
                      <p className="mt-1 text-lg font-black tabular-nums">
                        {formatCurrency(item.amountPaise / 100)}
                        {item.quantity > 1 ? (
                          <span className="ml-2 text-xs font-bold text-black/60">
                            × {item.quantity}
                          </span>
                        ) : null}
                      </p>
                      {/* REAL escrow status alongside the perspective label */}
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-black/60">
                        {statusLabel(item.status)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={label === "Failed" ? "red" : label === "Sold" ? "blue" : "yellow"}>
                        {label}
                      </Badge>
                      <Button variant="secondary" size="sm" onClick={() => setSelected(item)}>
                        View details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {(buying.hasNextPage || selling.hasNextPage) ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  loading={buying.isFetchingNextPage || selling.isFetchingNextPage}
                  onClick={() => {
                    if (buying.hasNextPage) void buying.fetchNextPage();
                    if (selling.hasNextPage) void selling.fetchNextPage();
                  }}
                >
                  Load more
                </Button>
              </div>
            ) : null}
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
