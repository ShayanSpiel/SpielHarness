"use client";

import { type ReactNode } from "react";
import { Button } from "./button";
import { Pill } from "./pill";
import { SearchInput } from "./search-input";
import { Tooltip } from "./tooltip";
import { SIDEBAR } from "../layout-constants";
import { ResizableSidebar } from "./resizable-sidebar";

export function SidebarListPanel({
  title,
  count,
  onNew,
  newBusy = false,
  newLabel = "New",
  newTooltip,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  children,
  width = "list",
  sidebarId,
  resizable = true,
  className,
}: {
  title: string;
  count?: number;
  onNew?: () => void;
  newBusy?: boolean;
  newLabel?: string;
  newTooltip?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children: ReactNode;
  width?: "list" | "narrow";
  sidebarId?: string;
  resizable?: boolean;
  className?: string;
}) {
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;
  const defaultWidth = width === "narrow" ? SIDEBAR.LIST.NARROW_DEFAULT : SIDEBAR.LIST.DEFAULT;

  return (
    <ResizableSidebar
      className={className}
      defaultWidth={defaultWidth}
      resizable={resizable}
      sidebarId={sidebarId ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
      title={title}
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
              loading={newBusy}
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

    </ResizableSidebar>
  );
}
