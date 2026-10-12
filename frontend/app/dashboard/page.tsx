"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  Tabs,
} from "@/components/ui";
import { RequireAuth } from "@/lib/auth/auth-context";
import { useAuth } from "@/lib/auth/auth-context";
import {
  useMyListings,
  useMyOffers,
  useMyTransactions,
  useNotifications,
} from "@/lib/api/queries";
import {
  useDeleteListing,
  useMarkListingSold,
  useMarkNotificationsRead,
  useRespondToOffer,
} from "@/lib/api/mutations";
import { MotifScatter } from "@/components/ui/hostel-motif";
import type { ListingDTO } from "@/lib/api/schemas";
import { formatCurrency, formatDate } from "@/lib/utils";

type TabId = "listings" | "offers" | "transactions" | "notifications";

/** One of the seller's own listings (any status) with owner actions. */
function ListingRow({ listing }: { listing: ListingDTO }) {
  const remove = useDeleteListing(listing.id);
  const markSold = useMarkListingSold(listing.id);
  // QA3 closeout: ACTIVE rows can be marked SOLD by their owner (the only
  // seller-facing status transition; settlement/internal flow is separate).
  // DELETED and SOLD rows are terminal: the backend soft-delete only works
  // from ACTIVE (409 otherwise), so the action is hidden for them.
  const canRemove = listing.status === "ACTIVE" || listing.status === "PAUSED";
  return (
    <Card className="p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
        {listing.status} · {formatDate(listing.createdAt)}
      </p>
      <p className="mt-1 text-lg font-black uppercase tracking-tight">{listing.title}</p>
      <p className="mt-1 font-black tabular-nums">{formatCurrency(listing.price)}</p>
      <div className="mt-3 flex gap-2">
        <Link href={`/listings/${listing.id}`} className="flex-1">
          <Button size="sm" variant="outline" className="w-full">View</Button>
        </Link>
        {listing.status === "ACTIVE" ? (
          <Button
            size="sm"
            variant="primary"
            loading={markSold.isPending}
            onClick={() => markSold.mutate()}
          >
            Mark as Sold
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            size="sm"
            variant="secondary"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function StatBlock({
  label,
  value,
  shape,
}: {
  label: string;
  value: number | string;
  shape: "circle" | "square" | "diamond" | "circle2";
}) {
  return (
    <div className="flex items-center gap-4 p-4 sm:p-6">
      <span
        aria-hidden="true"
        className={`flex h-14 w-14 shrink-0 items-center justify-center border-4 border-black font-black tabular-nums ${
          shape === "circle" ? "rounded-full bg-blue-bauhaus text-white" :
          shape === "square" ? "bg-white" :
          shape === "diamond" ? "rotate-45 bg-red-bauhaus text-white" :
          "rounded-full bg-white"
        }`}
      >
        <span className={shape === "diamond" ? "-rotate-45 text-sm" : "text-sm"}>
          {typeof value === "number" ? (value > 99 ? "99+" : value) : value}
        </span>
      </span>
      <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
    </div>
  );
}

function DashboardInner() {
  const { user } = useAuth(); // still used by the offers/notifications tabs
  const [tab, setTab] = React.useState<TabId>("listings");
  // H2: the seller's own listings in ANY status (was: public ACTIVE search
  // client-filtered by sellerId — SOLD/DELETED rows were invisible).
  const listingsQ = useMyListings();
  const offersQ = useMyOffers();
  const txQ = useMyTransactions("buying");
  const txSellQ = useMyTransactions("selling");
  const notifQ = useNotifications();
  const markRead = useMarkNotificationsRead();
  const respond = useRespondToOffer();

  const listings = listingsQ.data?.listings ?? [];
  const offers = offersQ.data?.offers ?? [];
  const txns = [
    ...(txQ.data?.transactions ?? []),
    ...(txSellQ.data?.transactions ?? []),
  ];
  const notifications = notifQ.data?.notifications ?? [];
  const unread = notifications.filter((n) => !n.readAt).length;

  // GET /offers returns the caller's offers on BOTH sides without an embedded
  // listing — so direction is decided by buyerId, not by a listing lookup.
  const pendingIn = offers.filter((o) => o.status === "PENDING" && o.buyerId !== user?.id);
  const pendingOut = offers.filter((o) => o.status === "PENDING" && o.buyerId === user?.id);

  if (listingsQ.isLoading || offersQ.isLoading || txQ.isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Skeleton className="h-24 w-full" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main id="main">
      <section aria-label="Your stats" className="relative overflow-hidden border-b-4 border-black bg-yellow-bauhaus">
        <MotifScatter variant="dashboard" />
        <div className="relative mx-auto max-w-7xl divide-y-4 divide-black px-4 sm:px-6 md:divide-y-0 md:grid md:grid-cols-4 md:divide-x-4 lg:px-8">
          <StatBlock label="Active listings" value={listings.filter((l) => l.status === "ACTIVE").length} shape="circle" />
          <StatBlock label="Pending offers" value={pendingIn.length + pendingOut.length} shape="square" />
          <StatBlock label="Escrow deals" value={txns.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED").length} shape="diamond" />
          <StatBlock label="Unread alerts" value={unread} shape="circle2" />
          <div className="hidden" aria-hidden="true"><Bell /></div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Tabs<TabId>
          tabs={[
            { id: "listings", label: "Listings", count: listings.length },
            { id: "offers", label: "Offers", count: pendingIn.length + pendingOut.length },
            { id: "transactions", label: "Transactions", count: txns.length },
            { id: "notifications", label: "Alerts", count: unread },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "listings" ? (
          <div className="mt-6">
            {listings.length === 0 ? (
              <EmptyState
                title="No listings yet"
                body="Your old mini-fridge deserves a second life."
                action={<Link href="/sell/new"><Button variant="primary">List your first item</Button></Link>}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {listings.map((l) => (
                  <ListingRow key={l.id} listing={l} />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "offers" ? (
          <div className="mt-6 flex flex-col gap-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest">Received (you are the seller)</p>
              {pendingIn.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-foreground/70">None yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {pendingIn.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-white p-3 shadow-sm">
                      <span className="font-black tabular-nums">{formatCurrency(o.offeredPrice)}</span>
                      <span className="text-xs font-bold uppercase tracking-wide text-foreground/70">{o.listing?.title}</span>
                      <span className="flex gap-2">
                        <Button size="sm" variant="primary" loading={respond.isPending} onClick={() => respond.mutate({ offerId: o.id, action: "accept" })}>Accept</Button>
                        <Button size="sm" variant="outline" loading={respond.isPending} onClick={() => respond.mutate({ offerId: o.id, action: "reject" })}>Reject</Button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest">Sent (you are the buyer)</p>
              {pendingOut.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-foreground/70">None yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {pendingOut.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-white p-3 shadow-sm">
                      <span className="font-black tabular-nums">{formatCurrency(o.offeredPrice)}</span>
                      <span className="text-xs font-bold uppercase tracking-wide text-foreground/70">{o.listing?.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "transactions" ? (
          <div className="mt-6">
            {txns.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                body="Accepted offers turn into escrow-protected deals here."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {txns.map((t) => (
                  <Link key={`${t.id}-${t.listingId}`} href={`/purchases/${t.id}`} className="block border-2 border-black bg-white p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black tabular-nums">{formatCurrency(t.amountPaise / 100)}</span>
                      <span className="border-2 border-black bg-yellow-bauhaus px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">{t.status}</span>
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-foreground/60">
                      {formatDate(t.createdAt ?? "")} · {t.buyerId === user?.id ? "BUYING" : "SELLING"}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "notifications" ? (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest">Grouped by day</p>
              <Button size="sm" variant="outline" loading={markRead.isPending} onClick={() => markRead.mutate("all")}>
                Mark all read
              </Button>
            </div>
            {notifications.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="Nothing yet" body="Offer and escrow events land here." />
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-6">
                {Object.entries(
                  notifications.reduce<Record<string, typeof notifications>>((acc, n) => {
                    const day = formatDate(n.createdAt);
                    (acc[day] ??= []).push(n);
                    return acc;
                  }, {}),
                ).map(([day, items]) => (
                  <div key={day}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-foreground/60">{day}</p>
                    <div className="mt-2 flex flex-col gap-2">
                      {items.map((n) => (
                        <div key={n.id} className="flex items-start gap-3 border-2 border-black bg-white p-3 shadow-sm">
                          {!n.readAt ? <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0 border-2 border-black bg-yellow-bauhaus" /> : <span aria-hidden="true" className="mt-1.5 h-3 w-3 shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-sm font-bold uppercase tracking-wide">{n.type}</p>
                            <p className="text-sm font-medium text-foreground/80">
                              {typeof n.payload === "object" && n.payload !== null ? JSON.stringify(n.payload).slice(0, 140) : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  );
}
