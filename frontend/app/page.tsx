"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { MotifScatter } from "@/components/ui/hostel-motif";
import { Button } from "@/components/ui/button";
import { Skeleton, EmptyState, Section } from "@/components/ui/skeleton";
import { ListingCard } from "@/components/listings/listing-card";
import { SearchBar, CategoryFilter, BlockToggle } from "@/components/listings/filters";
import { useListings } from "@/lib/api/queries";
import { LISTING_CATEGORIES, hostelGroup, hostelsOfGroup, type ListingCategory, type HostelBlock } from "@/lib/api/types";
import { useAuth, RequireAuth } from "@/lib/auth/auth-context";

/**
 * The marketplace is the GATED product, not the landing page: a logged-out
 * visitor is redirected to /login (with a return path) before any listing,
 * stat or seller tool renders. RequireAuth renders the loading skeleton while
 * the session resolves, so protected content never flashes (brief §6.3).
 */
export default function MarketplacePage() {
  return (
    <RequireAuth>
      <MarketplaceBodyGate />
    </RequireAuth>
  );
}

function MarketplaceBodyGate() {
  return (
    <>
      <HeroBand />
      <React.Suspense fallback={<BodyFallback />}>
        <MarketplaceBody />
      </React.Suspense>
      <TrustBand />
    </>
  );
}

function BodyFallback() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-64 animate-pulse border-2 border-black bg-muted" />
        ))}
      </div>
    </main>
  );
}

function MarketplaceBody() {
  const params = useSearchParams();
  const { user } = useAuth();
  const q = params.get("q") ?? "";
  const category = (params.get("category") as ListingCategory | null) ?? "All";
  // MH/LH segregation: a hand-edited ?block= pointing at the OTHER market
  // (e.g. ?block=LH-2 while logged in as MH) is clamped to "All" — the server
  // would filter it out anyway, this just keeps the toggle honest.
  const rawBlock = (params.get("block") as HostelBlock | null) ?? "All";
  const group = hostelGroup(user?.hostelBlock);
  const block: HostelBlock | "All" =
    rawBlock !== "All" && hostelsOfGroup(group).includes(rawBlock) ? rawBlock : "All";
  const filters = React.useMemo(
    () => ({
      q: q || undefined,
      category: category as ListingCategory | "All",
      block,
    }),
    [q, category, block],
  );

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useListings(filters);

  const listings = React.useMemo(() => data?.pages.flatMap((p) => p.listings) ?? [], [data]);
  const total = data?.pages[0]?.pagination.total ?? 0;
  const sentinel = React.useRef<HTMLDivElement>(null);

  // Infinite scroll (IntersectionObserver — brief §7.1 grid).
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  function clearFilters() {
    window.location.href = "/";
  }

  return (
    <>
      {/* STATS STRIP — yellow band with oversized numerals in shapes */}
      <section className="border-b-4 border-black bg-yellow-bauhaus">
        <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y-4 divide-black sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x-4">
          {[
            { n: String(total || "—"), label: "Live listings", shape: "circle" },
            { n: "10", label: "Hostel blocks", shape: "square" },
            { n: "6", label: "Categories", shape: "diamond" },
            { n: "100%", label: "Escrow-checked", shape: "circle" },
          ].map((s, i) => (
            <div key={s.label} className="flex items-center gap-4 px-4 py-6 sm:justify-center lg:px-8">
              <span
                aria-hidden="true"
                className={
                  i % 4 === 0
                    ? "flex h-14 w-14 items-center justify-center rounded-full border-4 border-black bg-white"
                    : i % 4 === 2
                      ? "flex h-14 w-14 rotate-45 items-center justify-center border-4 border-black bg-white"
                      : "flex h-14 w-14 items-center justify-center border-4 border-black bg-white"
                }
              >
                <span className={i % 4 === 2 ? "-rotate-45 text-xl font-black tabular-nums" : "text-xl font-black tabular-nums"}>
                  {s.n}
                </span>
              </span>
              <p className="text-xs font-bold uppercase tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* STICKY BLOCK TOGGLE — SRS 5.2.2 */}
      <BlockToggle active={block} />

      {/* FILTERS + GRID */}
      <section id="grid" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <SearchBar initialQuery={q} />
          <CategoryFilter
            active={category}
            onChange={(c) => {
              const next = new URLSearchParams(params.toString());
              if (c === "All") next.delete("category");
              else next.set("category", c);
              const qs = next.toString();
              window.location.href = qs ? `/?${qs}` : "/";
            }}
          />
        </div>

        <div className="mt-8">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 lg:gap-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="border-4 border-black bg-surface shadow-lg">
                  <Skeleton className="aspect-[4/3] border-0 border-b-4 border-black" />
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              title="THE MARKET IS UNREACHABLE"
              body="The gateway did not answer. Check that the stack is running, then retry."
              action={<Button variant="outline" onClick={() => void refetch()}>Retry</Button>}
            />
          ) : listings.length === 0 ? (
            <EmptyState
              title="No listings match"
              body="Nothing matches this search, category and block combination yet. Clear the filters or list the first item yourself."
              action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 lg:gap-8">
                {listings.map((l, i) => (
                  <ListingCard key={l.id} listing={l} index={i} />
                ))}
              </div>
              <div ref={sentinel} aria-hidden="true" className="h-1" />
              {isFetchingNextPage ? (
                <p className="mt-6 text-center text-xs font-bold uppercase tracking-widest">Loading more…</p>
              ) : null}
            </>
          )}
        </div>
      </section>

    </>
  );
}

/* The hero and trust bands use no search params, so they live OUTSIDE the
 * Suspense boundary above: Next prerenders them into the SSR HTML (hostel
 * motif included) and only the params-driven body streams in on the client. */
function HeroBand() {
  return (
    <section className="relative overflow-hidden border-b-4 border-black bg-blue-bauhaus text-white">
      {/* Hidden below lg like the old composition — the headline owns the band on small screens. */}
      <MotifScatter variant="hero" className="hidden lg:block" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-10 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-24 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-yellow-bauhaus">
            Campus-only · Escrow-protected · Block-wise
          </p>
          <h1 className="mt-4 text-4xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl lg:text-8xl">
            Buy & sell<br />inside your<br />block.
          </h1>
          <p className="mt-6 max-w-md text-base font-medium leading-relaxed text-white/90 lg:text-lg">
            A marketplace built for hostel life: negotiate face to face, settle
            it through escrow, and never get scammed on the stairwell.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/sell/new">
              <Button variant="yellow" size="lg" rightIcon={<ArrowRight aria-hidden="true" />}>
                List an item
              </Button>
            </Link>
            <a href="#grid">
              <Button variant="outline" size="lg">Browse the grid</Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  return (
    <Section tone="red" divider={false}>
      <div className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="max-w-xl text-2xl font-black uppercase tracking-tight sm:text-3xl lg:text-4xl">
          Meet in the block.<br />Pay through escrow.
        </h2>
        <Link href="/register">
          <Button variant="yellow" size="lg">Join the market</Button>
        </Link>
      </div>
    </Section>
  );
}
