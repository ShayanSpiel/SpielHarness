"use client";

import type { ReactNode } from "react";
import { cn } from "../index";

export interface PageHeaderProps {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ icon, title, actions, children, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-10 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4",
        className
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-raised)] text-[var(--foreground)]">
        {icon}
      </div>
      <h1 className="truncate text-sm font-semibold text-[var(--foreground)]">{title}</h1>
      {children}
      {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}
