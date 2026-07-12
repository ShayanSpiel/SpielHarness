"use client";

import { useMemo, useState } from "react";
import { Icon } from "../../components/icons";
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
  items: Array<{ id: string; title: string; subtitle: string }>;
  label: string;
  searchPlaceholder: string;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) =>
          [item.title, item.subtitle].some((value) => value.toLowerCase().includes(q)),
        )
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
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
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
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-1">
        {filteredItems.length === 0
          ? (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              No {label.toLowerCase()} match this search.
            </div>
          )
          : filteredItems.map((item) => {
            const active = activeIds.includes(item.id);
            return (
              <button
                className={cn(
                  "flex items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-hover",
                  active && "bg-selected",
                )}
                key={item.id}
                onClick={() => onToggle(item.id)}
                type="button"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                    active
                      ? "border-foreground-strong bg-foreground-strong text-background"
                      : "border-border",
                  )}
                >
                  {active ? <Icon name="check" size={12} /> : null}
                </span>
                <Icon name={iconName} className="mt-0.5 shrink-0 text-muted-foreground" size={12} />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-foreground">{item.title}</span>
                  <span className="line-clamp-1 text-[10px] text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
