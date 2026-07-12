"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@spielos/design-system";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import type { ObjectReference, ObjectReferenceKind } from "../lib/object-references";

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
  className
}: {
  items: ObjectReference[];
  onSelect: (ref: ObjectReference) => void;
  className?: string;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [items.length]);

  useEffect(() => {
    const el = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
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

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "z-50 max-h-64 w-72 overflow-hidden rounded-lg border border-border bg-panel-raised shadow-[var(--shadow-panel)]",
        className
      )}
      onKeyDown={handleKeyDown}
      ref={listRef}
      role="listbox"
    >
      {items.map((ref, index) => (
        <button
          aria-selected={index === highlightedIndex}
          className={cn(
            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
            index === highlightedIndex ? "bg-selected text-foreground-strong" : "text-foreground hover:bg-hover"
          )}
          key={`${ref.kind}:${ref.id}`}
          onClick={() => onSelect(ref)}
          onMouseEnter={() => setHighlightedIndex(index)}
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
            <div className="truncate text-[11px] text-muted-foreground">
              {KIND_LABELS[ref.kind]}
              {ref.subtitle ? ` · ${ref.subtitle}` : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export { KIND_ICONS, KIND_LABELS };
