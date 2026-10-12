"use client";

import * as React from "react";
import {
  AlarmClock,
  Backpack,
  BookOpen,
  Calculator,
  Coffee,
  CupSoda,
  Glasses,
  Headphones,
  Key,
  Lamp,
  Laptop,
  Pencil,
  Ruler,
  ShoppingBag,
  Umbrella,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Hostel motif — the decorative layer of everyday hostel/college line-art
// icons (H1 of the visual patch). Same Bauhaus bones as the geometric shapes
// it replaces: black stroke-only line art, no fill, very low opacity,
// scattered and slightly rotated, absolutely positioned BEHIND content,
// aria-hidden, pointer-events-none, never animated.
//
// Hard rules encoded here (brief §1):
// - stroke 1.25–1.5 (below the UI's own 2–4px borders — a lighter layer)
// - fill: none (lucide default)
// - opacity 6–12% on light backgrounds, 10–16% on solid color bands,
//   footer exception 15–20% white on black. Never above 16% (footer: 20%).
// - rotations from the scattered set −12/6/−24/18/−6/30 — never the
//   structural 0/45/90 grid
// - sizes 32–96px, at most 4–7 icons per composition
// - tone: black (var(--foreground)) on light/colored bands, white on black
//   (footer / admin shell)
// ---------------------------------------------------------------------------

export type MotifTone = "black" | "white";

/** Any lucide-react icon component. */
export type MotifIcon = LucideIcon;

export type HostelMotifProps = {
  icon: LucideIcon;
  /** 32–96 per the brief. */
  size?: number;
  /** Scattered angle in degrees — use the −12/6/−24/18/−6/30 family. */
  rotate?: number;
  /** 0.06–0.16 (footer exception 0.20). */
  opacity?: number;
  tone?: MotifTone;
  className?: string;
};

export function HostelMotif({
  icon: Icon,
  size = 48,
  rotate = -12,
  opacity = 0.1,
  tone = "black",
  className,
}: HostelMotifProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute z-0 block", className)}
      style={{ width: size, height: size, opacity }}
    >
      <Icon
        style={{
          width: "100%",
          height: "100%",
          strokeWidth: 1.4,
          transform: `rotate(${rotate}deg)`,
          color: tone === "white" ? "#ffffff" : "var(--foreground)",
        }}
        aria-hidden="true"
      />
    </span>
  );
}

// --- Scatter recipes -------------------------------------------------------

type ScatterIcon = {
  icon: LucideIcon;
  /** Position classes inside the absolute inset-0 layer. */
  at: string;
  size: number;
  rotate: number;
  opacity: number;
  /** Tailwind visibility classes, e.g. "hidden sm:block". */
  show?: string;
};

export type MotifVariant =
  | "hero"
  | "sell"
  | "chat"
  | "dashboard"
  | "transactions"
  | "admin"
  | "empty"
  | "404"
  | "footer";

const RECIPES: Record<MotifVariant, ScatterIcon[]> = {
  // "Everything a student owns" — hero band on blue (black strokes).
  hero: [
    { icon: BookOpen, at: "right-[3%] top-[12%]", size: 88, rotate: -12, opacity: 0.12 },
    { icon: Backpack, at: "right-[9%] top-[52%]", size: 64, rotate: 18, opacity: 0.1 },
    { icon: Headphones, at: "right-[14%] bottom-[10%]", size: 72, rotate: 30, opacity: 0.12 },
    { icon: CupSoda, at: "right-[6%] top-[38%]", size: 44, rotate: -24, opacity: 0.1, show: "hidden lg:block" },
    { icon: Pencil, at: "right-[18%] top-[24%]", size: 40, rotate: 6, opacity: 0.14, show: "hidden lg:block" },
  ],
  // "Cataloguing your stuff" — sell/new-listing band on yellow.
  sell: [
    { icon: Ruler, at: "right-[4%] top-[16%]", size: 72, rotate: -24, opacity: 0.12 },
    { icon: Calculator, at: "right-[10%] bottom-[14%]", size: 56, rotate: 18, opacity: 0.1 },
    { icon: ShoppingBag, at: "right-[16%] top-[30%]", size: 64, rotate: 6, opacity: 0.12 },
    { icon: Pencil, at: "right-[7%] bottom-[38%]", size: 40, rotate: -12, opacity: 0.14, show: "hidden sm:block" },
    { icon: Lamp, at: "right-[20%] bottom-[8%]", size: 44, rotate: 30, opacity: 0.1, show: "hidden sm:block" },
  ],
  // Casual, conversational — empty chat thread.
  chat: [
    { icon: Coffee, at: "right-[10%] top-[20%]", size: 56, rotate: -12, opacity: 0.14 },
    { icon: Headphones, at: "left-[10%] bottom-[18%]", size: 48, rotate: 18, opacity: 0.12 },
    { icon: CupSoda, at: "right-[18%] bottom-[14%]", size: 40, rotate: 30, opacity: 0.16 },
  ],
  // Stat-strip background on yellow — numerals stay dominant, corner gutters only.
  dashboard: [
    { icon: Calculator, at: "left-2 top-3", size: 44, rotate: -24, opacity: 0.08 },
    { icon: Laptop, at: "right-2 top-4", size: 48, rotate: 6, opacity: 0.08 },
    { icon: AlarmClock, at: "left-3 bottom-3", size: 40, rotate: 18, opacity: 0.08 },
    { icon: Key, at: "right-3 bottom-2", size: 36, rotate: -6, opacity: 0.08 },
  ],
  // Handover / verification nods — red PIN banner.
  transactions: [
    { icon: Key, at: "right-[4%] top-[18%]", size: 56, rotate: -12, opacity: 0.12 },
    { icon: AlarmClock, at: "right-[10%] bottom-[16%]", size: 48, rotate: 18, opacity: 0.1 },
    { icon: Glasses, at: "right-[16%] top-[30%]", size: 44, rotate: 30, opacity: 0.12, show: "hidden sm:block" },
  ],
  // Admin console (black shell) — white, extremely restrained.
  admin: [
    { icon: Ruler, at: "right-[4%] top-[20%]", size: 52, rotate: -24, opacity: 0.1 },
    { icon: Key, at: "right-[9%] bottom-[22%]", size: 40, rotate: 6, opacity: 0.12 },
    { icon: BookOpen, at: "right-[14%] top-[30%]", size: 44, rotate: -6, opacity: 0.1, show: "hidden sm:block" },
  ],
  // Empty states — no other content competing: 12–16%.
  empty: [
    { icon: BookOpen, at: "top-3 left-3", size: 52, rotate: -12, opacity: 0.14, show: "hidden sm:block" },
    { icon: Key, at: "top-3 right-3", size: 40, rotate: 30, opacity: 0.12, show: "hidden sm:block" },
    { icon: CupSoda, at: "bottom-3 left-4", size: 44, rotate: 18, opacity: 0.16, show: "hidden sm:block" },
    { icon: Headphones, at: "bottom-3 right-3", size: 56, rotate: -6, opacity: 0.12 },
  ],
  // 404 — slightly more playful.
  "404": [
    { icon: Backpack, at: "left-[4%] top-[14%]", size: 72, rotate: -24, opacity: 0.12 },
    { icon: BookOpen, at: "right-[5%] top-[18%]", size: 64, rotate: 18, opacity: 0.12 },
    { icon: CupSoda, at: "left-[8%] bottom-[16%]", size: 48, rotate: 30, opacity: 0.14, show: "hidden sm:block" },
    { icon: Umbrella, at: "right-[8%] bottom-[12%]", size: 80, rotate: -6, opacity: 0.1 },
  ],
  // Footer corner (black band) — the documented higher-opacity exception.
  footer: [
    { icon: Key, at: "right-[6%] top-[18%]", size: 56, rotate: -12, opacity: 0.18 },
    { icon: BookOpen, at: "right-[12%] bottom-[20%]", size: 72, rotate: 18, opacity: 0.15 },
    { icon: Headphones, at: "right-[3%] bottom-[38%]", size: 48, rotate: 30, opacity: 0.2 },
  ],
};

export type MotifScatterProps = {
  variant: MotifVariant;
  tone?: MotifTone;
  /** Extra classes for the absolute layer itself (e.g. "hidden lg:block"). */
  className?: string;
  /** Override the recipe's icons with a caller-specific set (patch M2); the
   * recipe's geometry (positions/sizes/rotations/opacity) is reused and the
   * provided icons cycle through it. */
  icons?: readonly MotifIcon[];
};

export function MotifScatter({ variant, tone = "black", className, icons: override }: MotifScatterProps) {
  const base = RECIPES[variant];
  const icons = override?.length
    ? base.map((s, i) => ({ ...s, icon: override[i % override.length] }))
    : base;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)}>
      {icons.map((s, i) => (
        <HostelMotif
          key={i}
          icon={s.icon}
          size={s.size}
          rotate={s.rotate}
          opacity={s.opacity}
          tone={tone}
          className={cn(s.at, s.show)}
        />
      ))}
    </div>
  );
}
