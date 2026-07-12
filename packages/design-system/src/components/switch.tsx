"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "../index";

const switchVariants = cva(
  "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-border bg-input transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary",
  {
    variants: {
      size: {
        sm: "h-4 w-7",
        md: "h-5 w-9",
        lg: "h-6 w-11",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const thumbVariants = cva(
  "pointer-events-none block rounded-full bg-foreground shadow-panel ring-0 transition-transform duration-[var(--duration)] data-[state=checked]:bg-primary-foreground",
  {
    variants: {
      size: {
        sm: "h-3 w-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0",
        md: "h-4 w-4 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        lg: "h-5 w-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface SwitchProps
  extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
    VariantProps<typeof switchVariants> {}

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, size, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      className={cn(switchVariants({ size }), className)}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb className={cn(thumbVariants({ size }))} />
    </SwitchPrimitive.Root>
  );
});
