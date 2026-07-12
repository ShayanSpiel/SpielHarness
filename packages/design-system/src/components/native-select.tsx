"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../index";

export interface NativeSelectOption {
  label: string;
  value: string;
}

export interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  ariaLabel: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ ariaLabel, className, onChange, options, value, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <select
          aria-label={ariaLabel}
          className="h-8 w-full appearance-none rounded-md border border-border bg-input px-2.5 pr-8 text-sm text-foreground outline-none transition-colors duration-[var(--duration)] focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/30"
          onChange={(event) => onChange(event.target.value)}
          ref={ref}
          value={value}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    );
  }
);
