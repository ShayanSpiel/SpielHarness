import type { RunEvent, HumanInputRequest, RunStatus } from "@spielos/core";
import type { RunCheckpoint, RunYield } from "../index.ts";
import type { ToolCallStream } from "@langchain/langgraph";
import type { SubagentRunStream } from "langchain";

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

function makeEvent(target: DirectorStreamTarget, type: RunEvent["type"], message: string, extras: Partial<RunEvent> = {}): RunEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    orgId: target.orgId,
    runId: target.runId,
    type,
    sequence: 0,
    message,
    payload: {},
    createdAt: new Date().toISOString(),
    ...extras
  };
}

function toHumanInputRequest(interrupt: unknown): HumanInputRequest | null {
  if (!interrupt || typeof interrupt !== "object") return null;
  const payload = (interrupt as { value?: { questions?: unknown[]; id?: string; nodeId?: string; skillId?: string; header?: string; metadata?: Record<string, unknown> } }).value;
  if (!payload || !Array.isArray(payload.questions)) return null;
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

export async function* mapDirectorMessages(
  target: DirectorStreamTarget,
  source: AsyncIterable<unknown>
): AsyncGenerator<RunYield, void, void> {
  for await (const handle of source) {
    const nodeName = (handle as { node?: string; namespace?: string[] }).node;
    if (nodeName) {
      target.emitEvent(makeEvent(target, "status", `Director is generating with ${nodeName}.`, {
        nodeId: nodeName,
        nodeTitle: nodeName,
        payload: { category: "model_generation", phase: "started", namespace: (handle as { namespace?: string[] }).namespace ?? [] }
      }));
    }
    const text = (handle as { text?: { [Symbol.asyncIterator](): AsyncIterator<string> } }).text;
    if (text) {
      for await (const delta of text) {
        if (!delta) continue;
        yield { kind: "text", text: delta };
      }
    }
    const usage = (handle as { usage?: { [Symbol.asyncIterator](): AsyncIterator<{ input_tokens?: number; output_tokens?: number; total_tokens?: number }> } }).usage;
    if (usage) {
      for await (const u of usage) {
        if (!u) continue;
        target.emitEvent(makeEvent(target, "status", "Director reported model usage.", {
          payload: {
            category: "usage",
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0
          }
        }));
      }
    }
  }
}

export async function* mapDirectorToolCalls(
  target: DirectorStreamTarget,
  source: AsyncIterable<ToolCallStream>
): AsyncGenerator<RunYield, void, void> {
  for await (const call of source) {
    target.emitEvent(makeEvent(target, "tool_call_started", `${call.name} called by Director.`, {
      payload: {
        callId: call.callId,
        operation: call.name,
        input: call.input,
        source: "director"
      }
    }));
    let outputKind: "ok" | "error" | "pending" = "pending";
    let outputValue: unknown = null;
    let errorValue: string | null = null;
    try {
      const value = await call.output;
      outputKind = "ok";
      outputValue = value;
    } catch (err) {
      outputKind = "error";
      errorValue = err instanceof Error ? err.message : "Tool call failed.";
    }
    if (outputKind === "ok") {
      target.emitEvent(makeEvent(target, "tool_call_result", `${call.name} returned a result.`, {
        payload: { callId: call.callId, operation: call.name, output: outputValue, success: true }
      }));
    } else if (outputKind === "error") {
      target.emitEvent(makeEvent(target, "tool_call_result", `${call.name} failed.`, {
        payload: { callId: call.callId, operation: call.name, error: errorValue, success: false }
      }));
    }
  }
}

export async function* mapDirectorSubagents(
  target: DirectorStreamTarget,
  source: AsyncIterable<SubagentRunStream>
): AsyncGenerator<RunYield, void, void> {
  for await (const sub of source) {
    target.emitEvent(makeEvent(target, "status", `Director delegated to "${sub.name}".`, {
      payload: { category: "subagent_entered", name: sub.name, cause: sub.cause ?? null }
    }));
    yield* mapDirectorMessages(target, sub.messages);
    yield* mapDirectorToolCalls(target, sub.toolCalls);
    yield* mapDirectorSubagents(target, sub.subagents);
    target.emitEvent(makeEvent(target, "status", `Subagent "${sub.name}" completed.`, {
      payload: { category: "subagent_exited", name: sub.name }
    }));
  }
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
