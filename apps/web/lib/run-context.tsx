"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useRuntimeStore, type RunLifecycleStatus, type ContextItem, type DurableRunState, type LiveRunUsage } from "./runtime-store";
import { orderRunEvents } from "./run-events";
import { type Artifact, type HumanInputRequest, type RunEvent, type RunStatus, type RunType } from "@spielos/core";

export type { RunLifecycleStatus, ContextItem, DurableRunState, LiveRunUsage };

export type RunContextValue = {
  contextItems: ContextItem[];
  setContextItems: (items: ContextItem[]) => void;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
  pendingModelId: string | null;
  setPendingModelId: (id: string | null) => void;
  pendingReasoningEffort: string;
  setPendingReasoningEffort: (effort: string) => void;
  pendingExecutionMode: string;
  setPendingExecutionMode: (mode: string) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  durableState: DurableRunState | null;
  setDurableState: (state: DurableRunState | null) => void;
  liveUsage: LiveRunUsage | null;
  setLiveUsage: (usage: LiveRunUsage | null) => void;
  activity: string | null;
  setActivity: (activity: string | null) => void;
  events: RunEvent[];
  appendEvent: (event: RunEvent) => void;
  clearEvents: () => void;
  artifacts: Artifact[];
  appendArtifact: (artifact: Artifact) => void;
  clearArtifacts: () => void;
  humanInputRequest: HumanInputRequest | null;
  setHumanInputRequest: (req: HumanInputRequest | null) => void;
  setRunStatus: (status: RunStatus) => void;
  status: RunLifecycleStatus;
  running: boolean;
  runType: RunType | null;
  setRunType: (type: RunType | null) => void;
  activeActor: { roleId: string; roleName: string } | null;
  activeActors: Array<{ agentId: string; roleId: string; roleName: string; nodeTitle: string }>;
  reset: () => void;
  currentGeneration: string | null;
  beginRunAttempt: () => string;
  isGenerationCurrent: (gid: string) => boolean;
  activateRunProjection: (runId: string) => void;
  hasActiveStream: (runId: string) => boolean;
  attachStream: (runId: string) => void;
  detachStream: (runId: string) => void;
};

const RunContext = createContext<RunContextValue | null>(null);

function useProxyStore(): RunContextValue {
  const store = useRuntimeStore();

  const activeActor = useMemo(() => {
    const ordered = orderRunEvents(store.events);
    const latest = [...ordered].reverse().find(
      (e) => (e.type === "node_started" || e.type === "skill_started" || e.type === "tool_call_started") && e.payload?.roleId,
    );
    if (latest?.payload?.roleId && latest?.payload?.roleName) {
      return { roleId: latest.payload.roleId as string, roleName: latest.payload.roleName as string };
    }
    return null;
  }, [store.events]);

  const activeActors = useMemo(() => {
    const map = new Map<string, { agentId: string; roleId: string; roleName: string; nodeTitle: string }>();
    const ordered = orderRunEvents(store.events);
    for (const e of ordered) {
      const roleId = e.payload?.roleId;
      const roleName = e.payload?.roleName;
      if (typeof roleId === "string" && typeof roleName === "string" &&
        (e.type === "node_started" || e.type === "skill_started" || e.type === "tool_call_started")) {
        const agentId = typeof e.payload?.agentId === "string" ? e.payload.agentId : e.nodeId ?? roleId;
        if (!map.has(agentId)) {
          map.set(agentId, { agentId, roleId, roleName, nodeTitle: e.nodeTitle ?? roleName });
        }
      }
      if ((e.type === "node_completed" || e.type === "node_failed" || e.type === "node_skipped") && e.nodeId) {
        map.delete(e.nodeId);
      }
      if (e.type === "tool_call_result" && typeof e.payload?.callId === "string") {
        map.delete(e.payload.callId);
      }
    }
    return Array.from(map.values());
  }, [store.events]);

  const value: RunContextValue = {
    contextItems: store.contextItems,
    setContextItems: store.setContextItems,
    addContext: store.addContext,
    removeContext: store.removeContext,
    clearContext: store.clearContext,
    pendingModelId: store.pendingModelId,
    setPendingModelId: store.setPendingModelId,
    pendingReasoningEffort: store.pendingReasoningEffort,
    setPendingReasoningEffort: store.setPendingReasoningEffort,
    pendingExecutionMode: store.pendingExecutionMode,
    setPendingExecutionMode: store.setPendingExecutionMode,
    pickerOpen: store.pickerOpen,
    setPickerOpen: store.setPickerOpen,
    activeRunId: store.activeRunId,
    setActiveRunId: (id) => id ? store.activateRunProjection(id) : store.resetRun(),
    durableState: store.durableState,
    setDurableState: store.setDurableState,
    liveUsage: store.liveUsage,
    setLiveUsage: store.setLiveUsage,
    activity: store.activity,
    setActivity: store.setActivity,
    events: store.events,
    appendEvent: store.appendEvent,
    clearEvents: store.clearEvents,
    artifacts: store.artifacts,
    appendArtifact: store.appendArtifact,
    clearArtifacts: store.clearArtifacts,
    humanInputRequest: store.humanInputRequest,
    setHumanInputRequest: store.setHumanInputRequest,
    setRunStatus: store.setRunStatus,
    status: store.runStatus,
    running: store.runStatus === "running",
    runType: store.runType,
    setRunType: store.setRunType,
    activeActor,
    activeActors,
    reset: store.resetRun ?? (() => {}),
    currentGeneration: null,
    beginRunAttempt: store.beginRunAttempt ?? (() => ""),
    isGenerationCurrent: store.isGenerationCurrent ?? (() => false),
    activateRunProjection: store.activateRunProjection ?? (() => {}),
    hasActiveStream: store.hasActiveStream,
    attachStream: store.attachStream,
    detachStream: store.detachStream,
  };
  return value;
}

export function RunContextProvider({ children }: { children: ReactNode }) {
  const value = useProxyStore();
  return createElement(RunContext.Provider, { value }, children);
}

export function useRunContext(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRunContext must be used within <RunContextProvider>");
  return value;
}
