import type { RunEvent } from "@spielos/core";

export function runtimeEventIcon(event: RunEvent, fallbackIcon = "circle-dot"): string {
  if (event.type === "status") {
    const category = event.payload?.category;
    if (category === "memory_read") return "brain";
    if (category === "compaction") return "archive";
    if (category === "context_budget") return "activity";
    if (category === "verification") return "shield";
    if (category === "pause") return "pause";
  }
  return fallbackIcon;
}

export function orderRunEvents(events: readonly RunEvent[]): RunEvent[] {
  return events
    .map((event, arrival) => ({ event, arrival }))
    .sort((left, right) => {
      const leftSequence = left.event.sequence > 0 ? left.event.sequence : null;
      const rightSequence = right.event.sequence > 0 ? right.event.sequence : null;
      if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      const timeDelta = Date.parse(left.event.createdAt) - Date.parse(right.event.createdAt);
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
      return left.arrival - right.arrival;
    })
    .map(({ event }) => event);
}

export function isFailureEvent(event: RunEvent): boolean {
  return (
    event.type === "run_failed" ||
    event.type === "run_cancelled" ||
    event.type === "node_failed" ||
    (event.type === "eval_score_updated" && event.payload?.passed === false) ||
    (event.type === "tool_call_result" && event.payload?.success === false)
  );
}

export function isSuccessEvent(event: RunEvent): boolean {
  return (
    event.type === "run_completed" ||
    event.type === "node_completed" ||
    event.type === "skill_completed" ||
    event.type === "human_input_received" ||
    event.type === "artifact_created" ||
    (event.type === "eval_score_updated" && event.payload?.passed === true) ||
    (event.type === "tool_call_result" && event.payload?.success !== false)
  );
}

export function isWaitingEvent(event: RunEvent): boolean {
  return event.type === "human_input_requested" || (event.type === "status" && event.payload?.category === "pause");
}

export function isStartEvent(event: RunEvent): boolean {
  return (
    event.type === "run_started" ||
    event.type === "node_started" ||
    event.type === "skill_started" ||
    event.type === "tool_call_started" ||
    event.type === "node_retrying"
  );
}

function compactKey(event: RunEvent): string {
  if (event.type === "tool_call_started" || event.type === "tool_call_result") {
    return `tool:${event.nodeId ?? ""}:${event.skillId ?? ""}`;
  }
  if (event.type.startsWith("skill_")) return `skill:${event.nodeId ?? ""}:${event.skillId ?? event.id}`;
  if (event.type.startsWith("node_")) return `node:${event.nodeId ?? event.id}`;
  if (event.type.startsWith("human_input_")) return `human:${event.nodeId ?? event.id}`;
  return `event:${event.id}`;
}

export function compactRunEvents(events: readonly RunEvent[]): RunEvent[] {
  const latest = new Map<string, { event: RunEvent; occurrence: number }>();
  for (const [occurrence, event] of orderRunEvents(events).entries()) {
    if (event.type === "run_started") continue;
    latest.set(compactKey(event), { event, occurrence });
  }
  const compacted = [...latest.values()]
    .sort((left, right) => left.occurrence - right.occurrence)
    .map(({ event }) => event);
  return compacted.filter((event, index) => {
    if (event.type !== "run_failed" && event.type !== "run_cancelled") return true;
    const priorFailure = [...compacted.slice(0, index)].reverse().find(isFailureEvent);
    return !priorFailure;
  });
}
