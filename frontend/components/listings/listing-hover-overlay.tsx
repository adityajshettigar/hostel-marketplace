"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { VerifiedResidentBadge } from "@/components/ui/badge";
import type { Listing } from "@/lib/api/types";

/**
 * SRS 5.2.1 hover tooltip overlay — slides up on hover/focus-within,
 * tap-toggleable on touch devices. Never obscures the price (price chip
 * sits on the image's top-left, outside this panel).
 */
export function ListingHoverOverlay({
  listing,
  open,
  seller,
}: {
  listing: Listing;
  open?: boolean;
  seller?: { block?: string | null; room?: string | null; verified: boolean };
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 translate-y-full border-t-4 border-black bg-foreground p-4 text-white transition-transform duration-200 ease-out",
        "group-hover:translate-y-0 group-focus-within:translate-y-0",
        open && "translate-y-0",
      )}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-yellow-bauhaus">
        {listing.condition}
      </p>
      <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">
        {listing.description || "No description provided."}
      </p>
      <div className="mt-2">
        <VerifiedResidentBadge
          verified={seller?.verified ?? false}
          block={seller?.block}
          room={seller?.room}
        />
      </div>
      {/* Real anchor in a NEW tab (spec: "View details" opens the listing in a
          new tab). rel="noopener noreferrer" kills the window.opener handle so
          the listing page can never reach back into the market tab. The list
          card's `listing.id` IS the canonical id the detail API resolves —
          never an index or a display slug. */}
      <Link
        href={`/listings/${listing.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="press mt-3 inline-flex h-9 items-center gap-2 border-2 border-black bg-yellow-bauhaus px-4 text-xs font-bold uppercase tracking-widest text-black shadow-sm"
      >
        View details
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
