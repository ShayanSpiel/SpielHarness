"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../index";

const pillStyles = cva(
  "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium transition-colors duration-[var(--duration)]",
  {
    variants: {
      tone: {
        default: "bg-[var(--panel-raised)] text-[var(--foreground-muted)]",
        primary: "bg-[var(--primary-soft)] text-[var(--primary)]",
        success: "bg-[var(--success-soft)] text-[var(--success)]",
        warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
        destructive: "bg-[var(--destructive-soft)] text-[var(--destructive)]",
        info: "bg-[var(--info-soft)] text-[var(--info)]",
        accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
        purple: "bg-[var(--purple-soft)] text-[var(--purple)]"
      }
    },
    defaultVariants: { tone: "default" }
  }
);

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pillStyles>;

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pillStyles({ tone }), className)} {...props} />;
}
