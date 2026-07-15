"use client";

import { type HTMLAttributes } from "react";
import { cn } from "../index";
import { Icon } from "./icons";
import { Spinner } from "./spinner";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "destructive";

const toneClasses: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive"
};

export type StatusIconProps = HTMLAttributes<HTMLSpanElement> & {
  icon: string;
  tone?: StatusTone;
  busy?: boolean;
  size?: number;
};

export function StatusIcon({
  className,
  icon,
  tone = "neutral",
  busy = false,
  size = 12,
  ...props
}: StatusIconProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", toneClasses[tone], className)}
      {...props}
    >
      {busy ? (
        <Spinner size={size <= 12 ? "xs" : "sm"} />
      ) : (
        <Icon aria-hidden name={icon} size={size} />
      )}
    </span>
  );
}
