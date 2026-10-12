"use client";

import * as React from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border-2 border-black px-3 py-1 text-xs font-bold uppercase tracking-widest",
  {
    variants: {
      tone: {
        red: "bg-red-bauhaus text-white",
        blue: "bg-blue-bauhaus text-white",
        yellow: "bg-yellow-bauhaus text-black",
        black: "bg-foreground text-white",
        white: "bg-surface text-black",
      },
      variant: {
        solid: "",
        outline: "bg-transparent",
      },
    },
    defaultVariants: { variant: "solid" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { icon?: React.ReactNode };

export function Badge({ className, tone, variant, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, variant }), className)} {...props}>
      {icon}
      {children}
    </span>
  );

}

/** First-class Verified Resident badge (SRS 5.2.3) — never omitted, legible absence. */
export function VerifiedResidentBadge({
  block,
  room,
  verified,
  className,
}: {
  block?: string | null;
  room?: string | null;
  verified: boolean;
  className?: string;
}) {
  if (!verified) {
    return (
      <Badge tone="white" variant="outline" className={className} icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}>
        Unverified Resident
      </Badge>
    );
  }
  const where = block && room ? `${block} / Room ${room}` : block ? `${block}` : "Resident";
  return (
    <Badge
      tone="yellow"
      className={className}
      icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
    >
      Verified Resident: {where}
    </Badge>
  );
}
