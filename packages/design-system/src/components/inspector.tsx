"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../index";
import { Icon } from "./icons";
import { NavTabs, type NavTab } from "./nav-tabs";

export function Inspector({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex h-full min-h-0 flex-col", className)} {...props} />;
}

export function InspectorHeader({
  icon,
  title,
  actions,
  className,
}: {
  icon: string;
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 pr-12", className)}>
      <Icon aria-hidden className="shrink-0 text-muted-foreground" name={icon} size={14} />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{title}</span>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function InspectorTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: NavTab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <NavTabs
      className={cn("px-2 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1.5", className)}
      onChange={onChange}
      tabs={tabs}
      value={value}
    />
  );
}

export function InspectorBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />;
}

export function InspectorSection({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("border-b border-border p-3 last:border-b-0", className)} {...props} />;
}

export function InspectorFooter({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <footer
      className={cn("shrink-0 border-t border-border bg-panel-raised px-3 py-1.5 text-3xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function InspectorEmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon: string;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-36 flex-col items-center justify-center gap-1.5 px-5 py-8 text-center", className)}>
      <Icon aria-hidden className="mb-1 text-muted-foreground" name={icon} size={16} />
      <div className="text-xs font-medium text-foreground">{title}</div>
      {description ? <div className="max-w-64 text-2xs leading-relaxed text-muted-foreground">{description}</div> : null}
    </div>
  );
}
