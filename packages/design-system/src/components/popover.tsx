"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef } from "react";
import { cn } from "../index";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = "start", sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        className={cn("motion-popover z-50 rounded-md border border-border bg-panel-strong p-3 text-foreground shadow-popover outline-none", className)}
        ref={ref}
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
