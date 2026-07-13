"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../index";

export type ActionRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  active?: boolean;
  description?: ReactNode;
  leading?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
};

/** Borderless row for command palettes, pickers, and modal result lists. */
export const ActionRow = forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRow(
  { active = false, className, description, leading, title, trailing, ...props },
  ref
) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-0 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:text-[var(--disabled-foreground)]",
        active ? "bg-selected text-foreground-strong" : "text-foreground hover:bg-hover",
        className
      )}
      ref={ref}
      type="button"
      {...props}
    >
      {leading ? <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-4">{title}</span>
        {description ? <span className="mt-0.5 block truncate text-2xs leading-4 text-muted-foreground">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 self-center">{trailing}</span> : null}
    </button>
  );
});
