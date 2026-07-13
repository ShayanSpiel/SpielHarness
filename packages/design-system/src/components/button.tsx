"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

const buttonStyles = cva(
  "inline-flex items-center justify-center rounded-md border border-transparent text-sm font-medium transition-colors duration-[var(--duration)] disabled:pointer-events-none disabled:border-[var(--disabled-border)] disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-foreground)] disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background)]",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:brightness-110 active:brightness-95",
        outline:
          "border-border bg-panel text-foreground hover:bg-hover hover:border-border-strong",
        ghost:
          "text-foreground-muted hover:bg-hover hover:text-foreground",
        subtle:
          "bg-panel-raised text-foreground hover:bg-selected",
        danger:
          "bg-destructive text-background hover:brightness-110",
        link: "border-transparent text-primary underline-offset-4 hover:underline"
      },
      size: {
        xs: "h-6 gap-1 px-1.5 text-3xs",
        sm: "h-7 gap-1.5 px-2.5 text-xs",
        md: "h-8 gap-2 px-3",
        lg: "h-9 gap-2 px-4",
        "icon-xs": "h-6 w-6 p-0",
        icon: "h-8 w-8 p-0",
        "icon-sm": "h-7 w-7 p-0",
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

const ICON_SIZE: Record<string, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  "icon-xs": 12,
  icon: 16,
  "icon-sm": 14,
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & {
    asChild?: boolean;
    icon?: string;
    loading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, icon, loading = false, disabled, children, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";
  const iconSize = size ? ICON_SIZE[size] : 14;
  return (
    <Comp
      ref={ref}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading || icon ? (
        <Icon name={loading ? "loader" : icon!} className={loading ? "animate-spin" : undefined} size={iconSize} />
      ) : null}
      {children}
    </Comp>
  );
});
