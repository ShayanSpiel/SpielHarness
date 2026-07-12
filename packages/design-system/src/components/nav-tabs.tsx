"use client";

import { cn } from "../index";
import { Icon } from "./icons";

export interface NavTab {
  id: string;
  label: string;
  icon: string;
}

export interface NavTabsProps {
  tabs: NavTab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function NavTabs({ tabs, value, onChange, className }: NavTabsProps) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-[var(--duration)]",
              active
                ? "bg-selected text-foreground-strong"
                : "text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            type="button"
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
