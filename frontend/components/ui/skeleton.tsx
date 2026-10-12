"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MotifScatter, type MotifIcon } from "@/components/ui/hostel-motif";
import { Button } from "@/components/ui/button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse border-2 border-black bg-muted", className)} />;
}

export function EmptyState({
  title,
  body,
  action,
  motifIcons,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  /** Optional caller-specific icon set (patch M2); defaults to the standard empty scatter. */
  motifIcons?: readonly MotifIcon[];
}) {
  return (
    <div className="relative overflow-hidden border-4 border-black bg-surface p-10 text-center shadow-lg">
      {/* Decorative layer — behind content, aria-hidden, never animated. */}
      <MotifScatter variant="empty" icons={motifIcons} />
      <div className="relative">
        <p className="text-2xl font-black uppercase tracking-tight">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-md font-medium leading-relaxed text-foreground/80">{body}</p> : null}
        {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex flex-wrap gap-1 border-b-4 border-black", className)}>
      {tabs.map((t, i) => {
        const isActive = t.id === active;
        const accents = ["bg-red-bauhaus", "bg-blue-bauhaus", "bg-yellow-bauhaus text-black", "bg-foreground"];
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-1 border-2 border-black px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors duration-200",
              isActive
                ? cn(accents[i % accents.length], "text-white shadow-md")
                : "bg-white hover:bg-muted",
              isActive && i % accents.length === 2 && "text-black",
            )}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center border-2 border-black bg-yellow-bauhaus px-1 text-[10px] font-black text-black">
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Section({
  tone = "background",
  className,
  children,
  divider = true,
}: {
  tone?: "background" | "red" | "blue" | "yellow" | "foreground";
  className?: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  const tones: Record<string, string> = {
    background: "bg-background",
    red: "bg-red-bauhaus text-white",
    blue: "bg-blue-bauhaus text-white",
    yellow: "bg-yellow-bauhaus text-black",
    foreground: "bg-foreground text-white",
  };
  return (
    <section className={cn(divider && "border-b-4 border-black", tones[tone], className)}>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-24">{children}</div>
    </section>
  );
}
