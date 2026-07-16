"use client";

import type { ReactNode } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

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
  const iconElement = typeof icon === "string" ? (
    <div className="rounded-full bg-panel-raised p-3 text-muted-foreground">
      <Icon name={icon} size={20} />
    </div>
  ) : icon ? (
    <div className="rounded-full bg-panel-raised p-3 text-muted-foreground">
      {icon}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
    >
      {iconElement}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
