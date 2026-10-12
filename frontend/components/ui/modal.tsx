"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeometricDecoration } from "@/components/ui/geometric-decoration";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  panelClassName?: string;
};

export function Modal({ open, onClose, title, children, footer, panelClassName }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Focus trap + Esc + scroll lock (brief §4.6/§9).
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cn(
            "relative w-full max-w-lg border-4 border-black bg-surface shadow-xl animate-shape-in",
            panelClassName,
          )}
        >
          <GeometricDecoration shape="triangle" color="yellow" size={28} className="right-3 top-3" />
          <div className="flex items-center justify-between border-b-4 border-black p-4 pr-12">
            <h2 className="text-xl font-black uppercase tracking-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="press absolute right-3 top-3 flex h-9 w-9 items-center justify-center border-2 border-black bg-white shadow-sm"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          {footer ? <div className="border-t-4 border-black p-4">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
