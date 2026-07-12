"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../index";

export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Panel({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md border border-border bg-panel text-foreground shadow-panel",
          className
        )}
        {...props}
      />
    );
  }
);

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4 text-sm",
        className
      )}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-foreground", className)} {...props} />;
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
