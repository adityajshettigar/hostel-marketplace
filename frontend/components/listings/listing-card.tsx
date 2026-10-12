"use client";

import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { ListingHoverOverlay } from "@/components/listings/listing-hover-overlay";
import type { Listing } from "@/lib/api/types";

const CORNER: { shape: "circle" | "square" | "triangle"; color: "red" | "blue" | "yellow" }[] = [
  { shape: "circle", color: "red" },
  { shape: "square", color: "blue" },
  { shape: "triangle", color: "yellow" },
];

export function ListingCard({
  listing,
  index = 0,
  touchOpen = false,
  onToggleTouch,
  seller,
}: {
  listing: Listing;
  index?: number;
  touchOpen?: boolean;
  onToggleTouch?: () => void;
  seller?: { block?: string | null; room?: string | null; verified: boolean };
}) {
  const corner = CORNER[index % CORNER.length];
  const image = listing.images?.[0];
  return (
    // overflow-hidden clips the hover overlay (translate-y-full parks it fully
    // below the card) so it is completely hidden by default and slides up from
    // the bottom edge on hover — no bleed past the card, no stray scrollbars.
    <article className="group relative overflow-hidden border-4 border-black bg-surface shadow-lg transition-transform duration-200 ease-out hover:-translate-y-1">
      {/* price chip — stays visible, overlay never covers it */}
      <span className="absolute left-0 top-0 z-20 bg-yellow-bauhaus px-3 py-1 text-lg font-black tabular-nums text-black border-b-2 border-r-2 border-black">
        {formatCurrency(listing.price)}
      </span>

      <div className="relative aspect-[4/3] overflow-hidden border-b-4 border-black bg-muted">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-background">
            <span
              className={cn(
                "h-16 w-16 border-4 border-black",
                corner.shape === "circle" && "rounded-full",
                corner.shape === "triangle" && "shape-triangle",
                corner.color === "red" && "bg-red-bauhaus",
                corner.color === "blue" && "bg-blue-bauhaus",
                corner.color === "yellow" && "bg-yellow-bauhaus",
              )}
            />
          </div>
        )}
        {listing.status === "SOLD" ? (
          <span className="absolute right-2 top-2 z-20 border-2 border-black bg-foreground px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-white">
            Sold
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
          {listing.category} · {listing.condition}
        </p>
        <h3 className="mt-1 line-clamp-1 text-lg font-black uppercase tracking-tight">{listing.title}</h3>
        {onToggleTouch ? (
          <button
            type="button"
            onClick={onToggleTouch}
            aria-expanded={touchOpen}
            className="mt-2 text-xs font-bold uppercase tracking-widest underline decoration-2 underline-offset-4 md:hidden"
          >
            {touchOpen ? "Hide info" : "Quick info"}
          </button>
        ) : null}
      </div>

      {/* 8–16px corner decoration, cycling red → blue → yellow */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-2 top-2 h-3 w-3",
          corner.shape === "circle" && "rounded-full",
          corner.shape === "triangle" && "shape-triangle",
          corner.color === "red" && "bg-red-bauhaus",
          corner.color === "blue" && "bg-blue-bauhaus",
          corner.color === "yellow" && "bg-yellow-bauhaus",
        )}
      />

      <ListingHoverOverlay listing={listing} open={touchOpen} seller={seller} />
    </article>
  );
}
