"use client";

import { useMemo, useState } from "react";
import { Icon } from "@spielos/design-system/components";
import { ChoiceButton, Pill, SearchInput } from "@spielos/design-system";

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
      <SearchInput className="mb-1" onChange={setQuery} placeholder={searchPlaceholder} value={query} />
      <div className="grid max-h-48 gap-1 overflow-y-auto">
        {filteredItems.length === 0
          ? (
            <div className="px-2 py-6 text-center text-2xs text-muted-foreground">
              No {label.toLowerCase()} match this search.
            </div>
          )
          : filteredItems.map((item) => {
            const active = activeIds.includes(item.id);
            return (
              <ChoiceButton
                key={item.id}
                leading={<Icon name={iconName} className="text-muted-foreground" size={11} />}
                onClick={() => onToggle(item.id)}
                selected={active}
                selectionMode="multiple"
              >
                {item.title}
              </ChoiceButton>
            );
          })}
      </div>
    </div>
  );
}
