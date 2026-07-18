"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@spielos/design-system";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import type { ObjectReference, ObjectReferenceKind } from "../lib/object-references";

const KIND_ORDER: ObjectReferenceKind[] = ["role", "skill", "eval", "workflow", "file", "prompt"];

const KIND_ICONS: Record<ObjectReferenceKind, string> = {
  role: ENTITY_ICONS.role,
  skill: ENTITY_ICONS.skill,
  eval: ENTITY_ICONS.eval,
  workflow: ENTITY_ICONS.workflow,
  file: ENTITY_ICONS.file,
  prompt: ENTITY_ICONS.prompt
};

const KIND_LABELS: Record<ObjectReferenceKind, string> = {
  role: "Role",
  skill: "Skill",
  eval: "Eval",
  workflow: "Workflow",
  file: "File",
  prompt: "Prompt"
};

export function MentionDropdown({
  items,
  onSelect,
  className,
  searchQuery
}: {
  items: ObjectReference[];
  onSelect: (ref: ObjectReference) => void;
  className?: string;
  searchQuery?: string;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [items.length]);

  useEffect(() => {
    const options = listRef.current?.querySelectorAll('[role="option"]');
    const el = options?.[highlightedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (items[highlightedIndex]) onSelect(items[highlightedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [items, highlightedIndex, onSelect]
  );

  const grouped = useMemo(() => {
    const map = new Map<ObjectReferenceKind, ObjectReference[]>();
    for (const ref of items) {
      const list = map.get(ref.kind) ?? [];
      list.push(ref);
      map.set(ref.kind, list);
    }
    return KIND_ORDER
      .map((kind) => ({ kind, label: KIND_LABELS[kind], items: map.get(kind) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "z-50 w-72 overflow-hidden rounded-md border border-border bg-panel-strong shadow-popover",
          className
        )}
      >
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          {searchQuery
            ? `No matches for "${searchQuery}"`
            : "No roles, skills, or files yet"}
        </div>
      </div>
    );
  }

  let flatIndex = 0;

  return (
    <div
      className={cn(
        "z-50 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-panel-strong shadow-popover",
        className
      )}
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="listbox"
    >
      {grouped.map((group) => (
        <div key={group.kind}>
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Icon name={KIND_ICONS[group.kind]} size={12} />
            {group.label}
          </div>
          {group.items.map((ref) => {
            const currentIndex = flatIndex++;
            return (
              <button
                aria-selected={currentIndex === highlightedIndex}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors",
                  currentIndex === highlightedIndex ? "bg-selected text-foreground-strong" : "text-foreground hover:bg-hover"
                )}
                key={`${ref.kind}:${ref.id}`}
                onClick={() => onSelect(ref)}
                onMouseEnter={() => setHighlightedIndex(currentIndex)}
                role="option"
                type="button"
              >
                <Icon
                  className="shrink-0 text-muted-foreground"
                  name={KIND_ICONS[ref.kind]}
                  size={14}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{ref.title}</div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {KIND_LABELS[ref.kind]}
                    {ref.subtitle ? ` · ${ref.subtitle}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export { KIND_ICONS, KIND_LABELS };
