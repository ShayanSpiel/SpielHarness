"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../index";
import { Input } from "./input";

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ className, value, onChange, placeholder, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <Input
          ref={ref}
          className="h-8 pl-7 text-xs"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
          {...props}
        />
      </div>
    );
  }
);
