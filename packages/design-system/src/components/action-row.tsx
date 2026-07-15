"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../index";

export type ActionRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  active?: boolean;
  compact?: boolean;
  description?: ReactNode;
  leading?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
};

/** Borderless row for command palettes, pickers, and modal result lists. */
export const ActionRow = forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRow(
  { active = false, className, compact = false, description, leading, title, trailing, ...props },
  ref
) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 w-full rounded-md text-left transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:text-[var(--disabled-foreground)]",
        compact ? "items-center gap-1.5 px-2 py-1" : "items-start gap-2.5 px-2.5 py-2",
        active ? "bg-selected text-foreground-strong" : "text-foreground hover:bg-hover",
        className
      )}
      ref={ref}
      type="button"
      {...props}
    >
      {leading ? <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground", compact && "mt-0")}>{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium leading-4", compact ? "text-2xs" : "text-xs")}>{title}</span>
        {description ? <span className={cn("mt-0.5 block truncate leading-4 text-muted-foreground", compact ? "text-3xs" : "text-2xs")}>{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 self-center">{trailing}</span> : null}
    </button>
  );
});
