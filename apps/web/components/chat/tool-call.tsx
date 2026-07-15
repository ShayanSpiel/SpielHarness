"use client";

import type { RunEvent } from "@spielos/core";
import { Icon, StatusIcon, cn } from "@spielos/design-system";
import { useState } from "react";

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({
  event,
  active,
}: {
  event: RunEvent;
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(active ?? false);
  const isStarted = event.type === "tool_call_started";
  const tone = isStarted
    ? "info"
    : active
      ? "info"
      : "neutral";

  const paramsDisplay =
    event.payload?.params != null ? formatPayload(event.payload.params) : null;
  const resultDisplay =
    event.payload?.result != null ? formatPayload(event.payload.result) : null;
  const hasDetails = paramsDisplay || resultDisplay;
  const parallelCount = typeof event.payload?.parallelCount === "number" ? event.payload.parallelCount : 1;

  return (
    <div
      className={cn(
        "flex min-h-6 min-w-0 gap-2 py-0.5 text-2xs",
        active && "text-foreground"
      )}
    >
      <StatusIcon
        busy={isStarted && active}
        className="mt-0.5 shrink-0"
        icon={isStarted ? "tool" : "check-circle"}
        size={11}
        tone={tone}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-muted-foreground",
              active && "text-foreground"
            )}
          >
            {event.message}
          </span>
          {event.skillName ? (
            <span className="ml-auto shrink-0 rounded-full bg-selected px-2 py-0.5 text-3xs text-muted-foreground">
              {event.skillName}
            </span>
          ) : null}
          {parallelCount > 1 ? (
            <span className="shrink-0 rounded-full bg-info-soft px-2 py-0.5 text-3xs text-info">
              parallel ×{parallelCount}
            </span>
          ) : null}
        </div>

        {hasDetails ? (
          <button
            className="mt-0.5 flex cursor-pointer items-center gap-1 text-3xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={10}
            />
            <span>{expanded ? "Hide details" : "Show details"}</span>
          </button>
        ) : null}

        {expanded && hasDetails ? (
          <div className="mt-1 flex flex-col gap-1">
            {paramsDisplay ? (
              <div>
                <div className="mb-0.5 text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                  Params
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-panel-raised p-1.5 font-mono text-3xs leading-relaxed text-foreground/80">
                  {paramsDisplay.length > 2000
                    ? `${paramsDisplay.slice(0, 2000)}...`
                    : paramsDisplay}
                </pre>
              </div>
            ) : null}
            {resultDisplay ? (
              <div>
                <div className="mb-0.5 text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                  Result
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-panel-raised p-1.5 font-mono text-3xs leading-relaxed text-foreground/80">
                  {resultDisplay.length > 2000
                    ? `${resultDisplay.slice(0, 2000)}...`
                    : resultDisplay}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
