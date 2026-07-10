"use client";

import type { ReactNode } from "react";
import { cn } from "../index";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <div className="rounded-full border border-[var(--border)] bg-[var(--panel-raised)] p-3 text-[var(--muted-foreground)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs text-[var(--muted-foreground)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
