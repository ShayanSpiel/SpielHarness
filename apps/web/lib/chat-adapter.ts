"use client";

import type { Artifact, HumanInputRequest, RunEvent } from "@spielos/core";
import type {
  ChatModelAdapter,
  ChatModelRunResult,
  ThreadAssistantMessagePart
} from "@assistant-ui/react";
import { useMemo, useRef } from "react";
import { useRunContext } from "./run-context";
import { useWorkspaceStore } from "./use-workspace-store";

type StreamItem =
  | {
      kind: "run";
      runId: string;
      target?: { type: string; id?: string };
      selectedContext?: Array<{ id: string; kind: string; title: string }>;
    }
  | { kind: "event"; event: RunEvent }
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "human_input"; request: HumanInputRequest }
  | {
      kind: "status";
      status: {
        phase: string;
        nodeTitle?: string;
        roleName?: string;
        skillName?: string;
        message: string;
      };
    }
  | { kind: "text"; text: string }
  | { kind: "error"; message: string };

function getMessageText(message: { content: readonly unknown[] }) {
  return message.content
    .filter((part): part is { type: "text"; text: string } =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join("\n");
}

function isTerminal(event: RunEvent): boolean {
  return event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled";
}

function chatProgress(event: RunEvent): string | null {
  if (event.type === "node_started") return event.message;
  if (event.type === "human_input_requested") return event.message;
  if (event.type === "eval_score_updated") return event.message;
  if (event.type === "run_failed") return `Run failed: ${event.message}`;
  if (event.type === "run_completed") return null;
  return null;
}

function shouldFlushText(text: string) {
  return text.length >= 80 || /[\n.!?:;]\s*$/.test(text);
}

export function useSpielosChatAdapter(): ChatModelAdapter {
  const store = useWorkspaceStore();
  const run = useRunContext();

  const storeRef = useRef(store);
  storeRef.current = store;
  const runRef = useRef(run);
  runRef.current = run;
  const lastUserMsgId = useRef<string | null>(null);

  return useMemo(() => ({
    async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult, void> {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;

      // Skip if we already processed this exact user message
      if (lastUser.id === lastUserMsgId.current) return;
      lastUserMsgId.current = lastUser.id;

      const text = getMessageText(lastUser);
      const { contextItems } = runRef.current;

      const contextRefs = contextItems.map((item) => ({
        id: item.id,
        kind: item.kind === "tool" ? "skill" : item.kind === "workstream" ? "workflow" : item.kind
      }));

      const currentRun = runRef.current;
      currentRun.clearEvents();
      currentRun.setHumanInputRequest(null);
      currentRun.setActiveRunId(null);
      currentRun.setActivity("Starting run...");
      currentRun.setRunning(true);

      const payload = { prompt: text, contextRefs };

      const response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortSignal
      });

      if (!response.ok || !response.body) {
        let message = `Run failed: HTTP ${response.status}`;
        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          /* ignore */
        }
        currentRun.setRunning(false);
        yield {
          content: [{ type: "text", text: message }] as unknown as readonly ThreadAssistantMessagePart[]
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let narrative = "";
      let textBuffer = "";
      let progressStarted = false;
      const seen = new Set<string>();

      const yieldCurrent = (): ChatModelRunResult => ({
        content: [{ type: "text", text: narrative }] as unknown as readonly ThreadAssistantMessagePart[]
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abortSignal.aborted) {
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((entry) => entry.startsWith("data: "));
            if (!line) continue;
            let item: StreamItem;
            try {
              item = JSON.parse(line.slice(6)) as StreamItem;
            } catch {
              continue;
            }
            let changed = true;
            if (item.kind === "run") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.setActiveRunId(item.runId);
              currentRun.setRunTitle(text.slice(0, 80) || "Run");
              narrative += "Run started.";
              progressStarted = true;
            } else if (item.kind === "status") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.setActivity(item.status.message);
              if (item.status.phase === "node_started" || item.status.phase === "generating") {
                const label = [
                  item.status.nodeTitle ? `Step: ${item.status.nodeTitle}` : null,
                  item.status.roleName ? `Role: ${item.status.roleName}` : null,
                  item.status.skillName ? `Skill: ${item.status.skillName}` : null
                ].filter(Boolean).join(" · ");
                const next = label ? `${item.status.message}\n${label}` : item.status.message;
                if (!narrative.includes(next)) {
                  narrative += (narrative ? "\n" : "") + next;
                  progressStarted = true;
                }
              }
            } else if (item.kind === "event") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.appendEvent(item.event);
              if (!seen.has(item.event.id)) {
                seen.add(item.event.id);
                const progress = chatProgress(item.event);
                if (progress) {
                  narrative += (narrative ? "\n" : "") + progress;
                  progressStarted = true;
                }
              }
              if (isTerminal(item.event)) {
                currentRun.setActivity(null);
                currentRun.setRunning(false);
                const s = storeRef.current;
                if (s.activeChatId) s.touchChat(s.activeChatId);
              }
            } else if (item.kind === "artifact") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.appendArtifact(item.artifact);
              const s = storeRef.current;
              if (s.activeChatId) {
                s.appendArtifact(s.activeChatId, item.artifact);
              }
              narrative += `\n\nOutput: ${item.artifact.title}\n${item.artifact.body.slice(0, 1200)}`;
            } else if (item.kind === "human_input") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.setActivity(null);
              currentRun.setRunning(false);
              currentRun.setHumanInputRequest(item.request);
              narrative += `\n\nQuestion: ${item.request.header ?? "Input requested"}\nAwaiting your answer.`;
            } else if (item.kind === "text") {
              if (progressStarted && narrative && !narrative.endsWith("\n\n")) narrative += "\n\n";
              progressStarted = false;
              textBuffer += item.text;
              if (shouldFlushText(textBuffer)) {
                narrative += textBuffer;
                textBuffer = "";
              } else {
                changed = false;
              }
            } else if (item.kind === "error") {
              if (textBuffer) {
                narrative += textBuffer;
                textBuffer = "";
              }
              currentRun.setActivity(null);
              currentRun.setRunning(false);
              narrative += `\n\nError: ${item.message}`;
            }
            if (changed) yield yieldCurrent();
          }
        }
      } finally {
        if (textBuffer) {
          narrative += textBuffer;
          textBuffer = "";
        }
        runRef.current.setActivity(null);
        runRef.current.setRunning(false);
      }

      yield yieldCurrent();
    }
  }), []);
}
