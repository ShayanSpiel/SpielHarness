"use client";

import { Slot } from "@radix-ui/react-slot";
import { type HTMLAttributes } from "react";
import { cn } from "../index";

const FOCUSABLE_FIELD_CLASSES = "overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]";

export function FocusableField({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(FOCUSABLE_FIELD_CLASSES, className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <Slot>
      <kbd
        className={cn(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-panel-raised px-1 font-mono text-xs text-muted-foreground",
          className
        )}
        {...props}
      />
    </Slot>
  );
}

export function Divider({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("h-px w-full bg-border", className)} {...props} />;
}

export function VisuallyHidden({ children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className="absolute h-px w-px overflow-hidden p-0 [clip:rect(0,0,0,0)] [white-space:nowrap]"
      {...props}
    >
      {children}
    </span>
  );
}
