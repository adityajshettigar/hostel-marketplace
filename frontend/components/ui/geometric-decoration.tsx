"use client";

import { cn } from "@/lib/utils";

export type DecorationShape = "circle" | "square" | "triangle" | "half-circle" | "cross";
export type DecorationColor = "red" | "blue" | "yellow" | "black" | "white";

const FILLS: Record<DecorationColor, string> = {
  red: "bg-red-bauhaus",
  blue: "bg-blue-bauhaus",
  yellow: "bg-yellow-bauhaus",
  black: "bg-foreground",
  white: "bg-surface",
};

export type GeometricDecorationProps = {
  shape: DecorationShape;
  color: DecorationColor;
  size?: number;
  rotate?: 0 | 45 | 90 | 180;
  opacity?: number;
  position?: string;
  className?: string;
};

/** THE decorative primitive — every visual flourish goes through this. */
export function GeometricDecoration({
  shape,
  color,
  size = 16,
  rotate = 0,
  opacity,
  position,
  className,
}: GeometricDecorationProps) {
  const rotateClass =
    rotate === 45 ? "rotate-45" : rotate === 90 ? "rotate-90" : rotate === 180 ? "rotate-180" : "";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inline-block",
        FILLS[color],
        shape === "circle" && "rounded-full",
        shape === "triangle" && "shape-triangle",
        shape === "half-circle" && "rounded-t-full",
        rotateClass,
        position,
        className,
      )}
      style={{
        width: size,
        height: size,
        opacity: opacity ?? 1,
        transform: undefined,
      }}
    />
  );
}

/** Larger abstract assemblies for heroes, empty states, and the 404. */
export function GeometricComposition({
  variant,
  className,
}: {
  variant: "hero" | "cta" | "empty";
  className?: string;
}) {
  const scale =
    variant === "hero" ? "scale-100" : variant === "cta" ? "scale-[0.8]" : "scale-[0.6]";
  return (
    <div aria-hidden="true" className={cn("relative h-64 w-64", scale, className)}>
      {/* overlapping circle */}
      <span className="absolute left-0 top-8 h-40 w-40 rounded-full border-4 border-black bg-red-bauhaus" />
      {/* 45°-rotated square */}
      <span className="absolute right-4 top-0 h-36 w-36 rotate-45 border-4 border-black bg-yellow-bauhaus" />
      {/* centered square containing a triangle */}
      <span className="absolute bottom-0 left-1/2 flex h-40 w-40 -translate-x-1/2 items-center justify-center border-4 border-black bg-surface">
        <span className="shape-triangle h-24 w-24 bg-blue-bauhaus" />
      </span>
      {/* diagonal lines */}
      <span className="absolute -left-2 top-1/2 h-[3px] w-56 -rotate-45 bg-foreground" />
      <span className="absolute -right-2 top-1/2 h-[3px] w-56 rotate-45 bg-foreground" />
    </div>
  );
}
