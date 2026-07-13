"use client";

import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../index";
import { StatusIcon, type StatusTone } from "./status-icon";

const styles: Record<StatusTone, string> = {
  neutral: "border-border bg-panel-raised text-foreground",
  info: "border-info/35 bg-info-soft text-foreground",
  success: "border-success/35 bg-success-soft text-foreground",
  warning: "border-warning/35 bg-warning-soft text-foreground",
  destructive: "border-destructive/40 bg-destructive-soft text-foreground"
};

const icons: Record<StatusTone, string> = {
  neutral: "info",
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  destructive: "alert-circle"
};

export type NoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
  title?: ReactNode;
};

export function Notice({ children, className, title, tone = "neutral", ...props }: NoticeProps) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs", styles[tone], className)} {...props}>
      <StatusIcon className="mt-0.5" icon={icons[tone]} tone={tone} size={14} />
      <div className="min-w-0 flex-1 leading-5">
        {title ? <div className="font-semibold">{title}</div> : null}
        <div className={title ? "text-muted-foreground" : undefined}>{children}</div>
      </div>
    </div>
  );
}
