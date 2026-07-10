"use client";

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../index";

const fieldBase =
  "w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-colors duration-[var(--duration)] focus-visible:border-[var(--ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/30 disabled:pointer-events-none disabled:opacity-50";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  variant?: "default" | "ghost";
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant = "default", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        fieldBase,
        "h-8",
        variant === "ghost" && "border-transparent bg-transparent shadow-none focus-visible:ring-0",
        className
      )}
      {...props}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  autoResize?: boolean;
  variant?: "default" | "ghost";
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize, onInput, variant = "default", ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        fieldBase,
        "min-h-[80px] px-3 py-2 leading-relaxed",
        variant === "ghost" && "border-transparent bg-transparent shadow-none focus-visible:ring-0",
        className
      )}
      onInput={(event) => {
        if (autoResize) {
          const target = event.currentTarget;
          target.style.height = "auto";
          target.style.height = `${target.scrollHeight}px`;
        }
        onInput?.(event);
      }}
      {...props}
    />
  );
});
