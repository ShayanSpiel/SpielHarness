"use client";

import { useState } from "react";
import { Icon } from "@spielos/design-system/components";

export function ContractFlow({
  inputLabel,
  outputLabel,
  inputDetail,
  outputDetail,
  roleId,
}: {
  inputLabel: string;
  outputLabel: string;
  inputDetail: string;
  outputDetail: string;
  roleId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-panel">
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-hover transition-colors"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} className="text-muted-foreground shrink-0" size={13} />
        <Icon name="workflow-alt" className="text-muted-foreground shrink-0" size={13} />
        <span className="text-2xs font-medium text-muted-foreground min-w-0 truncate">
          Input &rarr; Output
        </span>
        <span className="ml-auto text-3xs text-muted-foreground/60 shrink-0 truncate">
          {inputLabel} &rarr; {outputLabel}
        </span>
        {roleId && roleId !== "runtime.eval" && (
          <a
            className="shrink-0 text-3xs text-muted-foreground hover:text-foreground transition-colors"
            href="/roles"
            onClick={(e) => e.stopPropagation()}
          >
            Edit
          </a>
        )}
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border p-2">
          <div className="overflow-hidden rounded-md bg-panel-raised px-2 py-1.5">
            <div className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              Input
            </div>
            <div className="mt-0.5 break-words text-xs text-foreground">{inputLabel}</div>
            {inputDetail && (
              <div className="mt-1 break-words whitespace-pre-wrap rounded-sm bg-background px-1.5 py-1 text-2xs text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
                {inputDetail}
              </div>
            )}
          </div>
          <div className="flex justify-center text-muted-foreground">
            <Icon name="arrow-down" size={13} />
          </div>
          <div className="overflow-hidden rounded-md bg-panel-raised px-2 py-1.5">
            <div className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
              Output
            </div>
            <div className="mt-0.5 break-words text-xs text-foreground">{outputLabel}</div>
            {outputDetail && (
              <div className="mt-1 break-words whitespace-pre-wrap rounded-sm bg-background px-1.5 py-1 text-2xs text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
                {outputDetail}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
