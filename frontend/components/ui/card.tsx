"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { GeometricDecoration, type DecorationColor } from "@/components/ui/geometric-decoration";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  decoration?: DecorationColor | "none";
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, decoration = "none", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative rounded-none border-4 border-black bg-surface shadow-xl",
          interactive && "transition-transform duration-200 ease-out hover:-translate-y-1",
          className,
        )}
        {...props}
      >
        {decoration !== "none" && (
          <GeometricDecoration
            shape="circle"
            color={decoration}
            size={12}
            className="right-2 top-2"
          />
        )}
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pb-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-2xl font-black uppercase tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 font-medium leading-relaxed text-foreground/80", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t-4 border-black p-4", className)} {...props} />;
}
