import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { Artifact, ArtifactFile, ArtifactProject, ModelUsageUpdate, RunEvent, CompletionCriteria, CompletionEvidence } from "@spielos/core";
import { textFromProviderContent } from "@spielos/providers";
import type { FileData } from "deepagents";
import type { RunYield } from "../index.ts";
import type { DirectorStreamTarget } from "./events.ts";
import type { DirectorUsageTracker } from "./usage.ts";

type NativeToolCall = { id?: string; name?: string; args?: unknown };
export type DirectorToolPresentation = { label?: string; icon?: string; logo?: string; integrationName?: string };
type NativeState = {
  messages?: unknown[];
  todos?: unknown[];
  files?: Record<string, FileData>;
  __interrupt__?: unknown[];
  _summarizationSessionId?: string;
  _summarizationEvent?: {
    cutoffIndex?: number;
    summaryMessage?: unknown;
    filePath?: string | null;
  };
};

export type DirectorValueState = {
  output: NativeState;
  interrupts: unknown[];
};

function event(target: DirectorStreamTarget, type: RunEvent["type"], message: string, payload: Record<string, unknown> = {}): RunEvent {
  return target.emitEvent({
    id: `evt_${crypto.randomUUID()}`,
    orgId: target.orgId,
    runId: target.runId,
    type,
    sequence: 0,
    message,
    payload,
    createdAt: new Date().toISOString()
  });
}

function chunkState(chunk: unknown): { namespace: string[]; state: NativeState } | null {
  if (!Array.isArray(chunk)) return chunk && typeof chunk === "object" ? { namespace: [], state: chunk as NativeState } : null;
  if (chunk.length === 3 && Array.isArray(chunk[0]) && chunk[1] === "values") {
    return { namespace: chunk[0].map(String), state: (chunk[2] ?? {}) as NativeState };
  }
  if (chunk.length === 2 && chunk[0] === "values") {
    return { namespace: [], state: (chunk[1] ?? {}) as NativeState };
  }
  return null;
}

function messageIdentity(message: unknown, index: number, namespace: string[]): string {
  const record = message && typeof message === "object" ? message as Record<string, unknown> : {};
  const id = typeof record.id === "string" ? record.id : `message-${index}`;
  return `${namespace.join(":")}:${id}`;
}

function nativeToolCalls(message: unknown): NativeToolCall[] {
  if (!message || typeof message !== "object") return [];
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  return Array.isArray(calls)
    ? calls.filter((call): call is NativeToolCall => Boolean(call) && typeof call === "object")
    : [];
}

function isNativeSummarizationMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const additional = (message as { additional_kwargs?: unknown }).additional_kwargs;
  return Boolean(
    additional &&
    typeof additional === "object" &&
    (additional as Record<string, unknown>).lc_source === "summarization"
  );
}

function toolActivity(name: string, presentation?: DirectorToolPresentation): { message: string; category: string } {
  if (presentation?.label) return { message: `${presentation.label}…`, category: "integration" };
  if (name === "write_todos") return { message: "Planning…", category: "planning" };
  if (name === "read_file" || name === "grep" || name === "glob" || name === "ls") return { message: "Reading…", category: "reading" };
  if (name === "write_file") return { message: "Writing…", category: "writing" };
  if (name === "edit_file") return { message: "Editing…", category: "editing" };
  if (name === "task") return { message: "Delegating…", category: "delegating" };
  if (name === "execute_workflow") return { message: "Running workflow…", category: "workflow" };
  if (name.startsWith("execute_eval_")) return { message: "Verifying…", category: "verification" };
  return { message: "Using tool…", category: "tool" };
}

function isAI(value: unknown): value is AIMessage {
  return value instanceof AIMessage || Boolean(value && typeof value === "object" && (value as { _getType?: () => string })._getType?.() === "ai");
}

function isTool(value: unknown): value is ToolMessage {
  return value instanceof ToolMessage || Boolean(value && typeof value === "object" && (value as { _getType?: () => string })._getType?.() === "tool");
}

function structuredToolResult(message: ToolMessage): Record<string, unknown> | null {
  const content = textFromProviderContent(message.content);
  if (!content.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function* mapDirectorValues(
  target: DirectorStreamTarget,
  source: AsyncIterable<unknown>,
  usage: DirectorUsageTracker,
  checkControl: () => "cancel" | "pause" | null,
  skipRootMessages = 0,
  toolPresentation: Record<string, DirectorToolPresentation> = {},
  onModelUsage?: (update: ModelUsageUpdate) => void,
  tokenBudget?: { maxInputTokens?: number | null; maxOutputTokens?: number | null },
): AsyncGenerator<RunYield, DirectorValueState, void> {
  const yieldedTextLen = new Map<string, number>();
  const yieldedToolCalls = new Set<string>();
  const yieldedToolResults = new Set<string>();
  const yieldedUsage = new Set<string>();
  const todoSnapshots = new Map<string, string>();
  let output: NativeState = {};
  let interrupts: unknown[] = [];
  let maxRootMessageCount = 0;
  const yieldedCompactions = new Set<string>();

  for await (const chunk of source) {
    const control = checkControl();
    if (control === "cancel") throw new DOMException("Director cancelled.", "AbortError");
    if (control === "pause") {
      const pause = new Error("Director paused.");
      pause.name = "SpielOSPause";
      throw pause;
    }
    const decoded = chunkState(chunk);
    if (!decoded) continue;
    const state = decoded.state;
    if (decoded.namespace.length === 0) {
      const rootMessageCount = state.messages?.length ?? 0;
      // LangChain's native SummarizationMiddleware writes a message carrying
      // `additional_kwargs.lc_source = "summarization"`. Values snapshots may
      // legitimately shrink at subgraph/model boundaries, so message counts
      // alone are not evidence of compaction.
      const nativeSummary = state._summarizationEvent?.summaryMessage
        ?? (state.messages ?? []).find(isNativeSummarizationMessage);
      const summaryIdentity = nativeSummary
        ? messageIdentity(nativeSummary, (state.messages ?? []).indexOf(nativeSummary), [])
        : null;
      if (summaryIdentity && !yieldedCompactions.has(summaryIdentity)) {
        yieldedCompactions.add(summaryIdentity);
        const createdAt = new Date().toISOString();
        yield {
          kind: "event",
          event: event(target, "status", "Context compacted.", {
            category: "compaction",
            previousMessageCount: maxRootMessageCount,
            compactedMessageCount: typeof state._summarizationEvent?.cutoffIndex === "number"
              ? Math.max(1, rootMessageCount - state._summarizationEvent.cutoffIndex + 1)
              : rootMessageCount,
            summaryMessageId: summaryIdentity,
            cutoffIndex: state._summarizationEvent?.cutoffIndex,
            historyPath: state._summarizationEvent?.filePath ?? undefined,
            createdAt
          })
        };
      }
      maxRootMessageCount = Math.max(maxRootMessageCount, rootMessageCount);
      output = state;
      if (Array.isArray(state.__interrupt__)) interrupts = state.__interrupt__;
    }

    const namespaceKey = decoded.namespace.join(":");
    const nextTodos = JSON.stringify(state.todos ?? []);
    if (nextTodos !== todoSnapshots.get(namespaceKey)) {
      todoSnapshots.set(namespaceKey, nextTodos);
      if ((state.todos?.length ?? 0) > 0) {
        yield { kind: "event", event: event(target, "status", "Planning…", { category: "planning", todos: state.todos, namespace: decoded.namespace }) };
      }
    }

    for (const [index, message] of (state.messages ?? []).entries()) {
      if (decoded.namespace.length === 0 && index < skipRootMessages) continue;
      const identity = messageIdentity(message, index, decoded.namespace);
      if (isAI(message)) {
        const content = textFromProviderContent(message.content);
        const priorLength = yieldedTextLen.get(identity) ?? 0;
        if (decoded.namespace.length === 0 && content.length > priorLength) {
          yield { kind: "text", text: content.slice(priorLength) };
          yieldedTextLen.set(identity, content.length);
        }
        const metadata = (message as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
        if (metadata && !yieldedUsage.has(identity)) {
          yieldedUsage.add(identity);
          usage.record(metadata);
          if (tokenBudget?.maxInputTokens && usage.snapshot().input > tokenBudget.maxInputTokens) {
            throw new Error(`Director input-token budget exceeded (${tokenBudget.maxInputTokens}).`);
          }
          if (tokenBudget?.maxOutputTokens && usage.snapshot().output > tokenBudget.maxOutputTokens) {
            throw new Error(`Director output-token budget exceeded (${tokenBudget.maxOutputTokens}).`);
          }
          const scope = decoded.namespace.length === 0 ? "root" : "subagent";
          onModelUsage?.({
            inputTokens: metadata.input_tokens ?? 0,
            outputTokens: metadata.output_tokens ?? 0,
            modelId: "unknown",
            scope,
            updatesContext: scope === "root",
          });
        }
        for (const [callIndex, call] of nativeToolCalls(message).entries()) {
          const callId = call.id ?? `${identity}:call-${callIndex}`;
          if (yieldedToolCalls.has(callId)) continue;
          yieldedToolCalls.add(callId);
          const name = call.name ?? "tool";
          const presentation = toolPresentation[name];
          const activity = toolActivity(name, presentation);
          const args = call.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? call.args as Record<string, unknown>
            : {};
          const subagentType = name === "task" && typeof args.subagent_type === "string" ? args.subagent_type : null;
          const roleId = subagentType?.startsWith("role_") ? subagentType.slice("role_".length) : subagentType;
          const roleName = subagentType?.replace(/^role_/, "").replace(/[_-]+/g, " ").trim();
          yield {
            kind: "event",
            event: event(target, "tool_call_started", activity.message, {
              category: activity.category,
              callId,
              operation: name,
              input: call.args ?? {},
              ...(presentation ?? {}),
              ...(roleId && roleName ? { roleId, roleName, agentId: callId } : {}),
              namespace: decoded.namespace
            })
          };
        }
      } else if (isTool(message)) {
        const toolCallId = String((message as { tool_call_id?: unknown }).tool_call_id ?? identity);
        if (yieldedToolResults.has(toolCallId)) continue;
        yieldedToolResults.add(toolCallId);
        const result = structuredToolResult(message);
        const status = typeof result?.status === "string" ? result.status : null;
        const childRunId = typeof result?.runId === "string" && result.runId ? result.runId : null;
        const success = !result?.error && status !== "failed" && status !== "cancelled";
        yield {
          kind: "event",
          event: event(target, "tool_call_result", success ? "Tool finished." : "Tool failed.", {
            callId: toolCallId,
            operation: typeof (message as { name?: unknown }).name === "string" ? (message as { name: string }).name : null,
            success,
            ...(childRunId ? { childRunId } : {}),
            ...(status ? { childStatus: status } : {}),
            ...(result?.error ? { error: String(result.error) } : {}),
            namespace: decoded.namespace
          })
        };
      }
    }
  }

  return { output, interrupts };
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
}

export function buildDirectorFiles(groups: Array<{ directory: string; files: Array<{ id: string; title: string; body: string }> }>): Record<string, FileData> {
  const now = new Date().toISOString();
  const files: Record<string, FileData> = {};
  for (const group of groups) {
    for (const file of group.files) {
      const path = `/${safeSegment(group.directory)}/${safeSegment(file.id)}-${safeSegment(file.title)}.md`;
      files[path] = { content: file.body, mimeType: "text/markdown", created_at: now, modified_at: now };
    }
  }
  return files;
}

export function artifactsFromDirectorFiles(
  files: Record<string, FileData> | undefined,
  initialFiles: Record<string, FileData>,
  orgId: string,
  runId: string
): Artifact[] {
  if (!files) return [];
  const artifacts: Artifact[] = [];
  const changed = Object.entries(files).flatMap(([path, file]) => {
    if (!path.startsWith("/artifacts/") && !path.startsWith("/workspace/")) return [];
    const content = Array.isArray(file.content) ? file.content.join("\n") : file.content;
    if (typeof content !== "string") return [];
    const initial = initialFiles[path];
    const initialContent = initial ? (Array.isArray(initial.content) ? initial.content.join("\n") : initial.content) : null;
    if (content === initialContent) return [];
    const fileRecord = file as FileData & { mimeType?: unknown; mime_type?: unknown };
    const declaredMime = typeof fileRecord.mimeType === "string"
      ? fileRecord.mimeType
      : typeof fileRecord.mime_type === "string"
        ? fileRecord.mime_type
        : null;
    const extension = path.split(".").at(-1)?.toLowerCase();
    const inferredMime = extension === "html" ? "text/html"
      : extension === "css" ? "text/css"
        : extension === "js" || extension === "mjs" ? "text/javascript"
          : extension === "svg" ? "image/svg+xml"
            : extension === "json" ? "application/json"
              : extension === "md" ? "text/markdown"
                : "text/plain";
    return [{ path, content, mimeType: declaredMime ?? inferredMime }];
  });

  const grouped = new Map<string, typeof changed>();
  for (const file of changed) {
    if (!file.path.startsWith("/artifacts/")) continue;
    const relative = file.path.slice("/artifacts/".length);
    const directory = relative.includes("/") ? relative.split("/")[0] : null;
    if (!directory) continue;
    const root = `/artifacts/${directory}/`;
    grouped.set(root, [...(grouped.get(root) ?? []), file]);
  }
  const bundledPaths = new Set<string>();
  for (const [root, group] of grouped) {
    const entry = group.find((file) => file.mimeType === "text/html")
      ?? group.find((file) => file.path.toLowerCase().endsWith(".html"));
    if (!entry || group.length < 2) continue;
    const projectFiles: ArtifactFile[] = group.map((file) => {
      const relativePath = file.path.slice(root.length);
      const role: ArtifactFile["role"] = file.path === entry.path
        ? "entry"
        : file.mimeType === "text/css"
          ? "style"
          : file.mimeType.includes("javascript")
            ? "script"
            : file.mimeType.startsWith("image/")
              ? "asset"
              : "document";
      return { path: relativePath, mimeType: file.mimeType, content: file.content, encoding: "utf8", role };
    });
    const directory = root.slice("/artifacts/".length, -1);
    const project: ArtifactProject = {
      kind: "project",
      version: 1,
      name: directory.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      root,
      entrypoint: entry.path.slice(root.length),
      files: projectFiles,
      integrations: [],
      metadata: { source: "deepagents", transport: "native_filesystem" }
    };
    for (const file of group) bundledPaths.add(file.path);
    artifacts.push({
      id: `artifact_${crypto.randomUUID()}`,
      orgId,
      runId,
      type: "artifact",
      title: project.name,
      body: JSON.stringify(project, null, 2),
      metadata: { source: "deepagents", path: root, renderer: "project", entrypoint: project.entrypoint, fileCount: project.files.length }
    });
  }

  for (const file of changed) {
    if (bundledPaths.has(file.path)) continue;
    artifacts.push({
      id: `artifact_${crypto.randomUUID()}`,
      orgId,
      runId,
      type: "draft",
      title: file.path.split("/").at(-1) ?? "Director artifact",
      body: file.content,
      metadata: { source: "deepagents", path: file.path }
    });
  }
  return artifacts;
}

// ── Evidence collector & completion evaluator ────────────────

export type CompletionVerdict = {
  passed: boolean;
  evidence: CompletionEvidence;
  unmetCriteria: string[];
};

export function collectEvidence(
  events: RunEvent[],
  completedChildRunIds: string[],
  artifactTitles: string[]
): CompletionEvidence {
  const toolCalls: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type === "tool_call_started") {
      const op = String(ev.payload?.operation ?? "");
      if (op) toolCalls[op] = (toolCalls[op] ?? 0) + 1;
    }
  }

  const evalResults: Record<string, { score: number; passed: boolean }> = {};
  for (const ev of events) {
    if (ev.type === "eval_score_updated" && ev.payload?.evalId) {
      evalResults[String(ev.payload.evalId)] = {
        score: Number(ev.payload.score ?? 0),
        passed: ev.payload.passed === true,
      };
    }
  }

  const todosTotal = events.filter(
    (ev) => ev.type === "tool_call_started" && ev.payload?.operation === "write_todos"
  ).length;
  const todosCompleted = events.filter(
    (ev) => ev.type === "tool_call_result" && ev.payload?.operation === "write_todos"
  ).length;

  return {
    artifacts: artifactTitles,
    completedWorkflows: completedChildRunIds,
    toolCalls,
    evalResults,
    todosCompleted,
    todosTotal,
  };
}

export function evaluateCompletion(
  criteria: CompletionCriteria,
  evidence: CompletionEvidence
): CompletionVerdict {
  const unmet: string[] = [];

  // Required artifacts
  for (const required of criteria.requiredArtifacts) {
    const found = evidence.artifacts.some((a) => a.includes(required) || a === required);
    if (!found) unmet.push(`Required artifact "${required}" was not created.`);
  }

  // Required workflows
  for (const required of criteria.requiredWorkflows) {
    const found = evidence.completedWorkflows.some((wf) => wf.includes(required));
    if (!found) unmet.push(`Required workflow "${required}" was not completed.`);
  }

  // Required tool calls
  for (const tc of criteria.requiredToolCalls) {
    const count = evidence.toolCalls[tc.capability] ?? 0;
    if (count < tc.minCount) {
      unmet.push(`Required tool call "${tc.capability}" was called ${count} time(s), minimum ${tc.minCount}.`);
    }
  }

  // Required eval thresholds
  for (const evalReq of criteria.requiredEvalThresholds) {
    const result = evidence.evalResults[evalReq.evalId];
    if (!result) {
      unmet.push(`Eval "${evalReq.evalId}" has no result.`);
    } else if (result.score < evalReq.minScore) {
      unmet.push(`Eval "${evalReq.evalId}" scored ${result.score}, minimum ${evalReq.minScore}.`);
    }
  }

  return {
    passed: unmet.length === 0,
    evidence,
    unmetCriteria: unmet,
  };
}
