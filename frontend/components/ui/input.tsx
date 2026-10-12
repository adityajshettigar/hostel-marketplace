"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-none border-2 border-black bg-white text-foreground shadow-sm placeholder:text-foreground/40 transition-shadow duration-150 focus:shadow-md focus:-translate-y-[1px] disabled:bg-muted disabled:opacity-70";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    return (
      <div className="w-full">
        {label ? (
          <label
            htmlFor={inputId}
            className="mb-1 block text-xs font-bold uppercase tracking-widest"
          >
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(FIELD, "h-11 px-3", error && "border-red-bauhaus", className)}
          {...props}
        />
        {hint && !error ? <p className="mt-1 text-xs font-medium text-foreground/70">{hint}</p> : null}
        {error ? (
          <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-xs font-bold uppercase text-red-bauhaus">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const autoId = React.useId();
    const fieldId = id ?? autoId;
    const errorId = `${fieldId}-error`;
    return (
      <div className="w-full">
        {label ? (
          <label htmlFor={fieldId} className="mb-1 block text-xs font-bold uppercase tracking-widest">
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(FIELD, "min-h-[96px] p-3", error && "border-red-bauhaus", className)}
          {...props}
        />
        {hint && !error ? <p className="mt-1 text-xs font-medium text-foreground/70">{hint}</p> : null}
        {error ? (
          <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-xs font-bold uppercase text-red-bauhaus">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, id, children, ...props }, ref) => {
    const autoId = React.useId();
    const fieldId = id ?? autoId;
    const errorId = `${fieldId}-error`;
    return (
      <div className="w-full">
        {label ? (
          <label htmlFor={fieldId} className="mb-1 block text-xs font-bold uppercase tracking-widest">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            id={fieldId}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(FIELD, "h-11 px-3 pr-8 appearance-none", error && "border-red-bauhaus", className)}
            {...props}
          >
            {children}
          </select>
          <span aria-hidden="true" className="shape-triangle pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 bg-foreground" />
        </div>
        {hint && !error ? <p className="mt-1 text-xs font-medium text-foreground/70">{hint}</p> : null}
        {error ? (
          <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-xs font-bold uppercase text-red-bauhaus">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode;
  error?: string;
};

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const autoId = React.useId();
    const fieldId = id ?? autoId;
    return (
      <div className="w-full">
        <div className="flex items-start gap-3">
          <input
            ref={ref}
            id={fieldId}
            type="checkbox"
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary-blue)]",
              className,
            )}
            {...props}
          />
          <label htmlFor={fieldId} className="text-sm font-medium leading-snug">
            {label}
          </label>
        </div>
        {error ? (
          <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-bold uppercase text-red-bauhaus">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";
