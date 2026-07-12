"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../index";

const buttonStyles = cva(
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-transparent text-sm font-medium transition-colors duration-[var(--duration)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
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
        sm: "h-7 px-2 text-xs",
        md: "h-8 px-3",
        lg: "h-9 px-4",
        icon: "h-8 w-8 p-0"
      }
    },
    defaultVariants: { variant: "primary", size: "md" }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
});
