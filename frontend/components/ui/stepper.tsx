"use client";

import { cn } from "@/lib/utils";

export type StepState = "completed" | "current" | "upcoming" | "exception";

export type Step = { label: string; state: StepState };

const SHAPES = ["circle", "square", "diamond", "circle", "square"] as const;

function Node({ step, index }: { step: Step; index: number }) {
  const shape = SHAPES[index % SHAPES.length];
  const filled =
    step.state === "completed" || step.state === "current"
      ? step.state === "completed"
        ? "bg-blue-bauhaus text-white"
        : "bg-yellow-bauhaus text-black"
      : step.state === "exception"
        ? "bg-red-bauhaus text-white"
        : "bg-white text-black";
  return (
    <span
      className={cn(
        "relative flex h-12 w-12 shrink-0 items-center justify-center border-4 border-black",
        shape === "circle" && "rounded-full",
        shape === "diamond" && "rotate-45",
        filled,
      )}
    >
      {shape === "diamond" && step.state === "current" ? (
        <span aria-hidden="true" className="absolute h-4 w-4 -rotate-45 border-2 border-black bg-white" />
      ) : null}
      <span className={cn("text-sm font-black tabular-nums", shape === "diamond" && "-rotate-45")}>
        {index + 1}
      </span>
    </span>
  );
}

export function Stepper({ steps, vertical = false }: { steps: Step[]; vertical?: boolean }) {
  if (vertical) {
    return (
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[22px] top-12 bottom-0 w-1 border-l-4",
                  s.state === "completed" ? "border-blue-bauhaus" : "border-black",
                )}
              />
            ) : null}
            <Node step={s} index={i} />
            <div className="pt-2.5">
              <p
                className={cn(
                  "text-xs font-bold uppercase tracking-widest",
                  s.state === "exception" && "text-red-bauhaus",
                )}
              >
                {s.label}
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="flex items-start">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-start last:flex-none">
          <div className="flex flex-col items-center gap-2">
            <Node step={s} index={i} />
            <p
              className={cn(
                "text-center text-[10px] font-bold uppercase tracking-widest sm:text-xs",
                s.state === "exception" && "text-red-bauhaus",
              )}
            >
              {s.label}
            </p>
          </div>
          {i < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={cn(
                "mx-2 mt-6 h-1 flex-1 border-t-4",
                s.state === "completed" ? "border-blue-bauhaus" : "border-black",
              )}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
