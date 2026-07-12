"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../index";

const pillStyles = cva(
  "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors duration-[var(--duration)]",
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

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pillStyles>;

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pillStyles({ tone }), className)} {...props} />;
}
