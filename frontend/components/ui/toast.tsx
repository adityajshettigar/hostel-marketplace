"use client";

import * as React from "react";
import { AlertTriangle, CheckSquare, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";
export type ToastInput = {
  tone: ToastTone;
  title: string;
  body?: string;
  /** Errors and policy warnings persist until dismissed (brief §4.5/§7.5). */
  persistent?: boolean;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = { toast: (t: ToastInput) => void };
const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_ACCENT: Record<ToastTone, string> = {
  success: "border-l-yellow-bauhaus",
  error: "border-l-red-bauhaus",
  info: "border-l-blue-bauhaus",
};
const TONE_ICON: Record<ToastTone, React.ReactNode> = {
  success: <CheckSquare className="h-5 w-5" strokeWidth={3} aria-hidden="true" />,
  error: <AlertTriangle className="h-5 w-5" strokeWidth={3} aria-hidden="true" />,
  info: <Info className="h-5 w-5" strokeWidth={3} aria-hidden="true" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-4), { ...input, id }]);
      if (!input.persistent) {
        window.setTimeout(() => dismiss(id), 5000);
      }
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifications"
        className={cn(
          "fixed z-[100] flex flex-col gap-3",
          "bottom-4 right-4 left-4", // mobile: top region below header
          "sm:left-auto sm:bottom-4 sm:right-4 sm:w-96",
        )}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "animate-toast-in border-4 border-black bg-surface shadow-xl",
              "border-l-8",
              TONE_ACCENT[t.tone],
            )}
          >
            <div className="flex items-start gap-3 p-4">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center border-2 border-black",
                  t.tone === "success" && "bg-yellow-bauhaus",
                  t.tone === "error" && "bg-red-bauhaus text-white",
                  t.tone === "info" && "bg-blue-bauhaus text-white",
                )}
              >
                {TONE_ICON[t.tone]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold uppercase tracking-wide">{t.title}</p>
                {t.body ? <p className="mt-0.5 text-sm font-medium leading-snug">{t.body}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="press h-7 w-7 shrink-0 border-2 border-black bg-white shadow-sm"
              >
                <X className="mx-auto h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
