"use client";

import { Icon, CONTEXT_KIND_ICONS } from "@spielos/design-system/components";
import { type ReactNode } from "react";
import { cn } from "@spielos/design-system";
import type { ContextItem } from "../../lib/run-context";

const ICONS: Record<string, ReactNode> = {
  role: <Icon name={CONTEXT_KIND_ICONS.role} size={12} />,
  skill: <Icon name={CONTEXT_KIND_ICONS.skill} size={12} />,
  library: <Icon name={CONTEXT_KIND_ICONS.library} size={12} />,
  workstream: <Icon name={CONTEXT_KIND_ICONS.workstream} size={12} />,
  strategy: <Icon name={CONTEXT_KIND_ICONS.strategy} size={12} />,
  knowledge: <Icon name={CONTEXT_KIND_ICONS.knowledge} size={12} />,
  prompt: <Icon name={CONTEXT_KIND_ICONS.prompt} size={12} />,
  eval: <Icon name={CONTEXT_KIND_ICONS.eval} size={12} />,
  workflow: <Icon name={CONTEXT_KIND_ICONS.workflow} size={12} />
};

export function ContextChips({
  items,
  onRemove,
  isSuggestion,
  className
}: {
  items: ContextItem[];
  onRemove: (id: string) => void;
  isSuggestion?: boolean;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map((item) => (
        <span
          className={cn(
            "group inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-xs shadow-panel transition-colors",
            isSuggestion
              ? "border border-dashed border-info/40 bg-info/5 text-info"
              : "border border-border bg-panel-strong text-foreground hover:border-border-strong hover:bg-hover"
          )}
          key={item.id}
          title={item.subtitle ?? item.title}
        >
          <span className={cn("shrink-0", isSuggestion ? "text-info/60" : "text-info")}>{ICONS[item.kind] ?? <Icon name="file-text" size={12} />}</span>
          <span className="truncate font-medium">{item.title}</span>
          {isSuggestion ? (
            <span className="text-3xs uppercase tracking-wider text-info/40">suggestion</span>
          ) : (
            <button
              aria-label={`Remove ${item.title}`}
              className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground shrink-0"
              onClick={() => {
                onRemove(item.id);
              }}
              type="button"
            >
              <Icon name="x" size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
