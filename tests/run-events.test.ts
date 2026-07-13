import test from "node:test";
import assert from "node:assert/strict";
import type { RunEvent } from "@spielos/core";
import { compactRunEvents, orderRunEvents } from "../apps/web/lib/run-events.ts";

function event(sequence: number, type: RunEvent["type"], message: string, extras: Partial<RunEvent> = {}): RunEvent {
  return {
    id: `${type}-${sequence}`,
    orgId: "org",
    runId: "run",
    type,
    sequence,
    message,
    payload: {},
    createdAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    ...extras
  };
}

test("run events use durable sequence instead of arrival order", () => {
  const events = [
    event(3, "human_input_received", "Input received", { nodeId: "human" }),
    event(1, "run_started", "Started"),
    event(2, "human_input_requested", "Input requested", { nodeId: "human" })
  ];
  assert.deepEqual(orderRunEvents(events).map((entry) => entry.sequence), [1, 2, 3]);
});

test("compact event rows keep the last real occurrence in chronological position", () => {
  const message = "Search connection is missing.";
  const events = [
    event(1, "run_started", "Workflow started"),
    event(2, "node_started", "Question started", { nodeId: "question" }),
    event(3, "human_input_requested", "Input requested", { nodeId: "question" }),
    event(4, "human_input_received", "Input received", { nodeId: "question" }),
    event(5, "node_completed", "Question completed", { nodeId: "question" }),
    event(6, "skill_started", "Search started", { nodeId: "search", skillId: "duck" }),
    event(7, "tool_call_started", "Search called", { nodeId: "search", skillId: "duck" }),
    event(8, "node_failed", message, { nodeId: "search", skillId: "duck" }),
    event(9, "run_failed", message)
  ];

  assert.deepEqual(
    compactRunEvents(events).map((entry) => entry.type),
    ["human_input_received", "node_completed", "skill_started", "tool_call_started", "node_failed"]
  );
});
