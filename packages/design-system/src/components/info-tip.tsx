"use client";

import { Icon } from "./icons";
import { Tooltip } from "./tooltip";

export function InfoTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} side="bottom">
      <button
        aria-label={content}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground"
        type="button"
      >
        <Icon name="info" size={12} />
      </button>
    </Tooltip>
  );
}

export function InfoLabel({ info, label }: { info: string; label: string }) {
  return (
    <div className="flex h-4 items-center gap-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <InfoTip content={info} />
    </div>
  );
}
