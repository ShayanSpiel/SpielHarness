"use client";

import { type ReactNode } from "react";
import { cn } from "../index";
import { Switch, type SwitchProps } from "./switch";

export function ToggleRow({
  label,
  description,
  onLabel = "On",
  offLabel = "Off",
  checked,
  onCheckedChange,
  disabled,
  className,
  children,
  size,
}: {
  label?: string;
  description?: string;
  onLabel?: string;
  offLabel?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  size?: SwitchProps["size"];
}) {
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground",
        className
      )}
    >
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} size={size} />
      <span>{description ?? (checked ? onLabel : offLabel)}</span>
      {children}
    </label>
  );
}
