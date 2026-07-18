import type { RunEvent, HumanInputRequest, RunStatus } from "@spielos/core";
import type { RunCheckpoint } from "../index.ts";

/**
 * v3 stream → `RunYield` mapper for the Director runtime.
 *
 * Deep Agents emits the v3 stream projections documented in
 * `docs/langchain-v3-stream.md`. The Director runtime owns the
 * plan/summarize/interrupt loop; the harness owns durable runs,
 * child-run lineage, artifacts, and the existing SSE protocol.
 * This mapper translates v3 → `RunYield` so the API layer does
 * not need a second parser.
 *
 * Mapping:
 *  - `run.messages.text` deltas → `{ kind: "text", text }`
 *  - `run.messages.usage`     → `status` event with usage payload
 *  - `run.toolCalls`           → `tool_call_started`/`tool_call_result`
 *  - `run.subagents`           → nested `status` event with kind
 *                                `subagent_entered` / `subagent_exited`
 *  - `run.output.__interrupt__` → `{ kind: "human_input", request }`
 *  - `run.output` (terminal)   → `{ kind: "done", status }`
 *  - `run.values.messages`     → tool/observation message deltas
 *  - All other state channels  → raw `run.values` snapshot emitted
 *                                as a `status` event for inspection
 *
 * `RunYield` is the single authoritative SSE frame shape. The
 * mapping is fully reversible through `events.ts`'s public surface.
 */

export type DirectorStreamTarget = {
  orgId: string;
  runId: string;
  emitEvent: (event: RunEvent) => RunEvent;
  buildCheckpoint: (state: DirectorStateSnapshot) => RunCheckpoint;
};

export type DirectorStateSnapshot = {
  longHorizon: RunCheckpoint["longHorizon"];
  goal: RunCheckpoint["goal"];
  budget: RunCheckpoint["budget"];
  progress: RunCheckpoint["progress"];
  verification: RunCheckpoint["verification"];
  pendingHumanInput: HumanInputRequest | null;
  status: RunStatus;
};

function toHumanInputRequest(interrupt: unknown): HumanInputRequest | null {
  if (!interrupt || typeof interrupt !== "object") return null;
  const raw = interrupt as { id?: string; value?: {
    questions?: unknown[];
    id?: string;
    nodeId?: string;
    skillId?: string;
    header?: string;
    metadata?: Record<string, unknown>;
    actionRequests?: Array<{ name?: string; args?: Record<string, unknown>; description?: string }>;
    reviewConfigs?: Array<{ actionName?: string; allowedDecisions?: Array<"approve" | "edit" | "reject"> }>;
  } };
  const payload = raw.value;
  if (!payload) return null;

  if (Array.isArray(payload.actionRequests) && payload.actionRequests.length > 0) {
    const questions: HumanInputRequest["questions"] = payload.actionRequests.map((action, index) => {
      const allowed = payload.reviewConfigs?.[index]?.allowedDecisions ?? ["approve", "reject"];
      const options = allowed
        .filter((decision) => decision === "approve" || decision === "reject")
        .map((decision) => ({ id: decision, label: decision === "approve" ? "Approve" : "Reject" }));
      return {
        id: `action_${index}`,
        kind: "single" as const,
        question: action.description?.trim() || `Allow ${action.name ?? "this tool"}?`,
        options,
        allowCustom: false
      };
    });
    return {
      id: raw.id ?? `interrupt_${crypto.randomUUID()}`,
      nodeId: "director",
      skillId: "director",
      questions,
      header: "Approval required",
      metadata: {
        nativeType: "langgraph_hitl",
        actionRequests: payload.actionRequests,
        reviewConfigs: payload.reviewConfigs ?? []
      },
      createdAt: new Date().toISOString()
    };
  }

  if (!Array.isArray(payload.questions)) return null;
  const questions = payload.questions.filter((q): q is HumanInputRequest["questions"][number] =>
    q != null && typeof q === "object" && "id" in q && "kind" in q && "question" in q
  );
  if (questions.length === 0) return null;
  return {
    id: typeof payload.id === "string" ? payload.id : `interrupt_${crypto.randomUUID()}`,
    nodeId: typeof payload.nodeId === "string" ? payload.nodeId : "director",
    skillId: typeof payload.skillId === "string" ? payload.skillId : "director",
    questions,
    header: typeof payload.header === "string" ? payload.header : "Director needs your input.",
    metadata: payload.metadata,
    createdAt: new Date().toISOString()
  };
}

export type DirectorInterrupt = { id?: string; value?: unknown };

export function mapDirectorInterrupts(
  target: DirectorStreamTarget,
  interrupts: readonly unknown[]
): HumanInputRequest | null {
  for (const raw of interrupts) {
    const request = toHumanInputRequest(raw);
    if (request) return request;
  }
  return null;
}

export function terminalStatusFromInterrupts(interrupts: readonly unknown[]): RunStatus {
  return interrupts.length > 0 ? "waiting_human" : "completed";
}
