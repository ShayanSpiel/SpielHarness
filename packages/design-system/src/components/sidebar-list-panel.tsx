"use client";

import { type ReactNode } from "react";
import { cn } from "../index";
import { Button } from "./button";
import { Pill } from "./pill";
import { SearchInput } from "./search-input";
import { Tooltip } from "./tooltip";
import { SIDEBAR } from "../layout-constants";

const WIDTH_CLASS = {
  list: SIDEBAR.LIST_WIDTH,
  narrow: SIDEBAR.LIST_NARROW,
} as const;

export function SidebarListPanel({
  title,
  count,
  onNew,
  newLabel = "New",
  newTooltip,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  width = "list",
  className,
}: {
  title: string;
  count?: number;
  onNew?: () => void;
  newLabel?: string;
  newTooltip?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
  width?: "list" | "narrow";
  className?: string;
}) {
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;

  return (
    <aside
      className={cn(
        `flex ${WIDTH_CLASS[width]} shrink-0 flex-col border-r border-border bg-background`,
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {count !== undefined ? (
          <Pill className="ml-auto">{count}</Pill>
        ) : null}
        {onNew ? (
          <Tooltip
            content={newTooltip ?? `New ${newLabel.toLowerCase()}`}
            side="bottom"
          >
            <Button
              aria-label={newTooltip ?? `New ${newLabel.toLowerCase()}`}
              className="px-2"
              icon="plus"
              onClick={onNew}
              size="sm"
              variant="ghost"
            >
              {newLabel}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {hasSearch ? (
        <div className="border-b border-border p-2">
          <SearchInput
            onChange={onSearchChange}
            placeholder={
              searchPlaceholder ?? `Search ${title.toLowerCase()}`
            }
            value={searchValue}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
}
