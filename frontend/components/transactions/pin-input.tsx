"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function PinInput({
  value,
  onChange,
  disabled,
  length = 4,
}: {
  value: string;
  onChange: (pin: string) => void;
  disabled?: boolean;
  length?: number;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  const setChar = (i: number, ch: string) => {
    const digits = value.split("");
    digits[i] = ch;
    const next = digits.join("").slice(0, length);
    onChange(next);
    if (ch && i < length - 1) refs.current[i + 1]?.focus();
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Enter the handover PIN">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          value={value[i] ?? ""}
          disabled={disabled}
          onChange={(e) => setChar(i, e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (pasted) {
              onChange(pasted);
              refs.current[Math.min(pasted.length, length - 1)]?.focus();
            }
          }}
          className={cn(
            "h-14 w-12 border-4 border-black bg-white text-center text-2xl font-black tabular-nums shadow-sm transition-shadow duration-150 focus:shadow-md focus:-translate-y-[1px] disabled:bg-muted",
          )}
        />
      ))}
    </div>
  );
}
