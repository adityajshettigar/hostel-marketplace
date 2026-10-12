"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { LISTING_CATEGORIES, hostelGroup, hostelsOfGroup } from "@/lib/api/types";
import type { ListingCategory, HostelBlock } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/auth-context";

/** Search bar — debounced 300ms, synced to ?q= (brief §7.1). */
export function SearchBar({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = React.useState(initialQuery);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <form
      role="search"
      onSubmit={(e) => e.preventDefault()}
      className="flex w-full max-w-xl items-stretch border-4 border-black bg-white shadow-lg"
    >
      <label htmlFor="marketplace-search" className="sr-only">
        Search listings
      </label>
      <input
        id="marketplace-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="SEARCH DESKS, BOOKS, FANS…"
        className="h-12 w-full bg-transparent px-4 font-bold uppercase tracking-wide placeholder:text-foreground/40 focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="press flex h-12 w-12 shrink-0 items-center justify-center border-l-4 border-black bg-yellow-bauhaus"
      >
        <Search className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
      </button>
    </form>
  );
}

/** Category row — square/pill toggles, active fills a primary (brief §7.1). */
export function CategoryFilter({
  active,
  onChange,
}: {
  active: ListingCategory | "All";
  onChange: (c: ListingCategory | "All") => void;
}) {
  const items: (ListingCategory | "All")[] = ["All", ...LISTING_CATEGORIES];
  const accents = ["bg-foreground", "bg-red-bauhaus", "bg-blue-bauhaus", "bg-yellow-bauhaus text-black", "bg-foreground", "bg-red-bauhaus"];
  return (
    <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by category">
      {items.map((c, i) => {
        const isActive = c === active;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(c)}
            className={cn(
              "press h-10 shrink-0 border-2 border-black px-4 text-xs font-bold uppercase tracking-widest shadow-sm",
              isActive ? cn(accents[i % accents.length], "text-white") : "bg-white hover:bg-muted",
            )}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SRS 5.2.2 sticky block-wise toggle — pinned under the header, yellow band,
 * oversized active label, persisted to ?block=.
 *
 * MH/LH segregation: the toggle only ever offers the hostels of the caller's
 * OWN group (MH residents see MH-1..MH-7, LH residents see LH-1..LH-3) —
 * the other market is not selectable, matching the server-side filter.
 */
export function BlockToggle({
  active,
  counts,
}: {
  active: HostelBlock | "All";
  counts?: Partial<Record<HostelBlock | "All", number>>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const group = hostelGroup(user?.hostelBlock);
  const blocks = hostelsOfGroup(group);

  function select(block: HostelBlock | "All") {
    const next = new URLSearchParams(params.toString());
    if (block === "All") next.delete("block");
    else next.set("block", block);
    const qs = next.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  return (
    <div className="sticky top-16 z-40 border-y-4 border-black bg-yellow-bauhaus shadow-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <p className="hidden items-baseline gap-2 sm:flex">
          <span className="text-3xl font-black leading-none tabular-nums">{active}</span>
          <span className="text-xs font-bold uppercase tracking-widest">
            {group === "LH" ? "LH hostel" : "MH hostel"}
          </span>
        </p>
        <div className="flex flex-1 flex-wrap gap-2" role="group" aria-label="Filter by hostel">
          {(["All", ...blocks] as const).map((b) => {
            const isActive = b === active;
            const count = counts?.[b];
            return (
              <button
                key={b}
                type="button"
                aria-pressed={isActive}
                onClick={() => select(b)}
                className={cn(
                  "press flex h-10 items-center gap-2 border-2 border-black px-4 text-xs font-bold uppercase tracking-widest shadow-sm",
                  isActive ? "bg-foreground text-white" : "bg-white hover:bg-muted",
                )}
              >
                {b === "All" ? "All hostels" : b}
                {typeof count === "number" ? (
                  <span className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center border border-black px-1 text-[10px] font-black",
                    isActive ? "bg-yellow-bauhaus text-black" : "bg-muted",
                  )}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
