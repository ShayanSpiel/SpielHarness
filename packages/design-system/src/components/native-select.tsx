"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

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
          className="h-8 w-full appearance-none rounded-md border border-border bg-input px-2.5 pe-8 text-sm text-foreground outline-none transition-colors duration-[var(--duration)] focus-visible:border-[var(--focus-border)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:border-[var(--disabled-border)] disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-foreground)]"
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
        <Icon
          className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          name="chevron-down"
          size={14}
        />
      </div>
    );
  }
);
