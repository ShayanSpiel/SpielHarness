"use client";

import { useMemo, useState } from "react";
import { Icon } from "@spielos/design-system/components";
import { Input, Pill, cn } from "@spielos/design-system";

export function PickList({
  activeIds,
  iconName,
  items,
  label,
  searchPlaceholder,
  onToggle,
}: {
  activeIds: string[];
  iconName: string;
  items: Array<{ id: string; title: string }>;
  label: string;
  searchPlaceholder: string;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) => item.title.toLowerCase().includes(q))
      : items;
    return [...filtered].sort((a, b) => {
      const aSelected = activeIds.includes(a.id);
      const bSelected = activeIds.includes(b.id);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }, [activeIds, items, query]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-2xs font-medium text-muted-foreground">
        <span>{label}</span>
        {activeIds.length > 0 ? <Pill className="ml-auto">{activeIds.length} selected</Pill> : null}
      </div>
      <div className="relative mb-1">
        <Icon
          name="search"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          size={12}
        />
        <Input
          className="h-7 pl-7 text-xs"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          value={query}
        />
      </div>
      <div className="grid max-h-48 gap-0.5 overflow-y-auto rounded-md border border-border p-1">
        {filteredItems.length === 0
          ? (
            <div className="px-2 py-6 text-center text-2xs text-muted-foreground">
              No {label.toLowerCase()} match this search.
            </div>
          )
          : filteredItems.map((item) => {
            const active = activeIds.includes(item.id);
            return (
              <button
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-hover",
                  active && "bg-selected",
                )}
                key={item.id}
                onClick={() => onToggle(item.id)}
                type="button"
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                    active
                      ? "border-foreground-strong bg-foreground-strong text-background"
                      : "border-border",
                  )}
                >
                  {active ? <Icon name="check" size={10} /> : null}
                </span>
                <Icon name={iconName} className="shrink-0 text-muted-foreground" size={11} />
                <span className="truncate text-[12px] text-foreground">{item.title}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
