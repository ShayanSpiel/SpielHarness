"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

export type ChoiceButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  selectionMode?: "single" | "multiple" | "action";
  description?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const ChoiceButton = forwardRef<HTMLButtonElement, ChoiceButtonProps>(function ChoiceButton(
  { children, className, description, leading, selected = false, selectionMode = "single", trailing, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      aria-checked={selectionMode === "action" ? undefined : selected}
      aria-pressed={selectionMode === "action" ? selected : undefined}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-foreground)]",
        selected
          ? "bg-selected text-foreground-strong"
          : "bg-transparent text-foreground hover:bg-hover",
        className
      )}
      role={selectionMode === "single" ? "radio" : selectionMode === "multiple" ? "checkbox" : undefined}
      type="button"
      {...props}
    >
      {selectionMode !== "action" ? (
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors",
            selectionMode === "single" ? "rounded-full" : "rounded-sm",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-input text-transparent"
          )}
        >
          {selectionMode === "single" ? (
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", !selected && "opacity-0")} />
          ) : (
            <Icon name="check" size={10} />
          )}
        </span>
      ) : null}
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium leading-5">{children}</span>
        {description ? (
          <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0 self-center">{trailing}</span> : null}
    </button>
  );
});
