"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

const pillStyles = cva(
  "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-medium transition-colors duration-[var(--duration)]",
  {
    variants: {
      tone: {
        default: "bg-panel-raised text-foreground-muted",
        primary: "bg-primary-soft text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive: "bg-destructive-soft text-destructive",
        info: "bg-info-soft text-info",
        accent: "bg-accent-soft text-accent",
        purple: "bg-purple-soft text-purple"
      }
    },
    defaultVariants: { tone: "default" }
  }
);

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pillStyles> & {
  onRemove?: () => void;
};

export function Pill({ className, tone, onRemove, children, ...props }: PillProps) {
  return (
    <span className={cn(pillStyles({ tone }), className)} {...props}>
      {children}
      {onRemove ? (
        <button
          aria-label="Remove"
          className="-mr-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          type="button"
        >
          <Icon name="x" size={10} />
        </button>
      ) : null}
    </span>
  );
}
