"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

const SPINNER_SIZE: Record<string, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SPINNER_SIZE;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  function Spinner({ size = "md", className, ...props }, ref) {
    return (
      <span
        ref={ref}
        role="status"
        aria-label="Loading"
        className={cn("inline-flex items-center justify-center", className)}
        {...props}
      >
        <Icon
          name="loader"
          size={SPINNER_SIZE[size]}
          className="animate-spin"
        />
      </span>
    );
  }
);
