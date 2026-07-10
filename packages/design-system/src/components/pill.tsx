"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../index";

const pillStyles = cva(
  "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium tracking-tight transition-colors duration-[var(--duration)]",
  {
    variants: {
      tone: {
        default: "border-[var(--border)] bg-[var(--panel-raised)] text-[var(--foreground-muted)]",
        primary: "border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary)]",
        success: "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]",
        warning: "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning)]",
        destructive:
          "border-[var(--destructive)]/30 bg-[var(--destructive-soft)] text-[var(--destructive)]",
        info: "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]",
        accent: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]",
        purple: "border-[var(--purple)]/30 bg-[var(--purple-soft)] text-[var(--purple)]"
      }
    },
    defaultVariants: { tone: "default" }
  }
);

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pillStyles>;

export function Pill({ className, tone, ...props }: PillProps) {
  return <span className={cn(pillStyles({ tone }), className)} {...props} />;
}
