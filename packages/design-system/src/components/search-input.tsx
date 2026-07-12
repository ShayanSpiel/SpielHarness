"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";
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
        <Icon
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          name="search"
          size={14}
        />
        <Input
          ref={ref}
          className="h-8 pl-7 text-sm"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
          {...props}
        />
      </div>
    );
  }
);
