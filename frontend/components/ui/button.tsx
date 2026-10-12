"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-bold uppercase tracking-wider transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-blue-bauhaus focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-red-bauhaus text-white border-2 border-black shadow-md press hover:bg-red-bauhaus/90",
        secondary: "bg-blue-bauhaus text-white border-2 border-black shadow-md press hover:bg-blue-bauhaus/90",
        yellow: "bg-yellow-bauhaus text-black border-2 border-black shadow-md press hover:bg-yellow-bauhaus/90",
        outline: "bg-white text-black border-2 border-black shadow-md press hover:bg-muted",
        ghost: "border-none text-black hover:bg-muted",
      },
      shape: {
        square: "rounded-none",
        pill: "rounded-full",
      },
      size: {
        sm: "h-9 px-4 text-xs",
        md: "h-11 px-6 text-sm",
        lg: "h-14 px-8 text-base",
        xl: "h-16 px-10 text-lg",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", shape: "square", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, shape, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, shape, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <span aria-hidden="true" className="h-4 w-4 animate-spin-square border-2 border-current" />
            <span className="sr-only">Loading</span>
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
