"use client";

import { Icon, CONTEXT_KIND_ICONS } from "@spielos/design-system/components";
import { type ReactNode } from "react";
import { cn } from "@spielos/design-system";
import { useRunContext, type ContextItem, type ContextItemKind } from "../../lib/run-context";

const ICONS: Record<ContextItemKind, ReactNode> = {
  role: <Icon name={CONTEXT_KIND_ICONS.role} size={12} />,
  tool: <Icon name={CONTEXT_KIND_ICONS.tool} size={12} />,
  library: <Icon name={CONTEXT_KIND_ICONS.library} size={12} />,
  workstream: <Icon name={CONTEXT_KIND_ICONS.workstream} size={12} />,
  strategy: <Icon name={CONTEXT_KIND_ICONS.strategy} size={12} />,
  knowledge: <Icon name={CONTEXT_KIND_ICONS.knowledge} size={12} />,
  prompt: <Icon name={CONTEXT_KIND_ICONS.prompt} size={12} />,
  eval: <Icon name={CONTEXT_KIND_ICONS.eval} size={12} />
};

export function ContextChips({
  items,
  onRemove,
  className
}: {
  items: ContextItem[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  const run = useRunContext();
  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((item) => (
        <span
          className="group inline-flex max-w-[200px] items-center gap-1 rounded-md bg-panel-raised px-1.5 py-0.5 text-xs text-foreground"
          key={item.id}
          title={item.subtitle ?? item.title}
        >
          <span className="text-muted-foreground shrink-0">{ICONS[item.kind] ?? <Icon name="file-text" size={12} />}</span>
          <span className="truncate">{item.title}</span>
          <button
            aria-label={`Remove ${item.title}`}
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground shrink-0"
            onClick={() => {
              onRemove(item.id);
              if (items.length === 1) run.setDrawerOpen(false);
            }}
            type="button"
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}
