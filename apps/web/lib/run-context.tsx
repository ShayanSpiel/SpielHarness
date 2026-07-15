"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Artifact, HumanInputRequest, RunBudget, RunEvent, RunGoal, RunProgress, RunStatus, RunType, RunVerification } from "@spielos/core";
import { orderRunEvents } from "./run-events";

export type RunLifecycleStatus = "idle" | RunStatus;

export type ContextItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
};

export type DurableRunState = {
  goal?: RunGoal;
  budget?: RunBudget;
  progress?: RunProgress;
  verification?: RunVerification;
};

export type LiveRunUsage = {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
};

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
  status: RunLifecycleStatus;
  running: boolean;
  startRun: (type: RunType, activity?: string | null) => void;
  setRunStatus: (status: RunStatus) => void;
  runType: RunType | null;
  setRunType: (type: RunType | null) => void;
  activeActor: { roleId: string; roleName: string } | null;
  activeActors: Array<{ agentId: string; roleId: string; roleName: string; nodeTitle: string }>;
  continuationText: string;
  appendContinuationText: (text: string) => void;
  clearContinuationText: () => void;
  reset: () => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function RunContextProvider({ children }: { children: ReactNode }) {
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingReasoningEffort, setPendingReasoningEffort] = useState("auto");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [durableState, setDurableState] = useState<DurableRunState | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveRunUsage | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [humanInputRequest, setHumanInputRequest] = useState<HumanInputRequest | null>(null);
  const [status, setStatus] = useState<RunLifecycleStatus>("idle");
  const [runType, setRunType] = useState<RunType | null>(null);
  const [activeActor, setActiveActor] = useState<{ roleId: string; roleName: string } | null>(null);
  const [activeActors, setActiveActors] = useState<Array<{ agentId: string; roleId: string; roleName: string; nodeTitle: string }>>([]);
  const [continuationText, setContinuationText] = useState("");

  const addContext = useCallback((item: ContextItem) => {
    setContextItems((current) => {
      if (current.some((entry) => entry.id === item.id)) return current;
      return [...current, item];
    });
  }, []);

  const removeContext = useCallback((id: string) => {
    setContextItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearContext = useCallback(() => setContextItems([]), []);

  const setRunStatus = useCallback((next: RunStatus) => {
    setStatus(next);
    if (next !== "running") setActivity(null);
    if (next === "completed" || next === "failed" || next === "cancelled") {
      setActiveActor(null);
      setActiveActors([]);
      setHumanInputRequest(null);
    }
  }, []);

  const startRun = useCallback((type: RunType, initialActivity: string | null = null) => {
    setEvents([]);
    setArtifacts([]);
    setActiveRunId(null);
    setDurableState(null);
    setLiveUsage(null);
    setActivity(initialActivity);
    setHumanInputRequest(null);
    setRunType(type);
    setActiveActor(null);
    setActiveActors([]);
    setContinuationText("");
    setStatus("running");
  }, []);

  const appendEvent = useCallback((event: RunEvent) => {
    setEvents((current) =>
      current.some((entry) => entry.id === event.id)
        ? current
        : orderRunEvents([...current, event])
    );
    const roleId = event.payload?.roleId;
    const roleName = event.payload?.roleName;
    if (
      typeof roleId === "string" &&
      typeof roleName === "string" &&
      (event.type === "node_started" || event.type === "skill_started" || event.type === "tool_call_started")
    ) {
      setActiveActor({ roleId, roleName });
      const agentId = typeof event.payload?.agentId === "string" ? event.payload.agentId : event.nodeId ?? roleId;
      setActiveActors((current) => current.some((actor) => actor.agentId === agentId)
        ? current
        : [...current, { agentId, roleId, roleName, nodeTitle: event.nodeTitle ?? roleName }]);
    }
    if ((event.type === "node_completed" || event.type === "node_failed" || event.type === "node_skipped") && event.nodeId) {
      setActiveActors((current) => current.filter((actor) => actor.agentId !== event.nodeId));
    }
    if (
      event.type === "run_started" ||
      event.type === "node_started" ||
      event.type === "skill_started" ||
      event.type === "tool_call_started" ||
      event.type === "node_retrying"
    ) {
      setActivity(event.message);
    }
    if (event.type === "run_started") setStatus("running");
    if (event.type === "human_input_requested") setRunStatus("waiting_human");
    if (event.type === "run_completed") setRunStatus("completed");
    if (event.type === "run_failed") setRunStatus("failed");
    if (event.type === "run_cancelled") setRunStatus("cancelled");
  }, [setRunStatus]);

  const clearEvents = useCallback(() => setEvents([]), []);
  const appendContinuationText = useCallback((text: string) => {
    setContinuationText((current) => current + text);
  }, []);
  const clearContinuationText = useCallback(() => setContinuationText(""), []);

  const appendArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((current) =>
      current.some((entry) => entry.id === artifact.id) ? current : [...current, artifact]
    );
  }, []);

  const clearArtifacts = useCallback(() => setArtifacts([]), []);

  const reset = useCallback(() => {
    setEvents([]);
    setArtifacts([]);
    setActiveRunId(null);
    setDurableState(null);
    setLiveUsage(null);
    setActivity(null);
    setHumanInputRequest(null);
    setStatus("idle");
    setRunType(null);
    setActiveActor(null);
    setActiveActors([]);
    setContinuationText("");
  }, []);

  const value = useMemo<RunContextValue>(
    () => ({
      contextItems,
      setContextItems,
      addContext,
      removeContext,
      clearContext,
      pendingModelId,
      setPendingModelId,
      pendingReasoningEffort,
      setPendingReasoningEffort,
      pickerOpen,
      setPickerOpen,
      activeRunId,
      setActiveRunId,
      durableState,
      setDurableState,
      liveUsage,
      setLiveUsage,
      activity,
      setActivity,
      events,
      appendEvent,
      clearEvents,
      artifacts,
      appendArtifact,
      clearArtifacts,
      humanInputRequest,
      setHumanInputRequest,
      status,
      running: status === "running",
      startRun,
      setRunStatus,
      runType,
      setRunType,
      activeActor,
      activeActors,
      continuationText,
      appendContinuationText,
      clearContinuationText,
      reset
    }),
    [
      contextItems,
      setContextItems,
      addContext,
      removeContext,
      clearContext,
      pendingModelId,
      pendingReasoningEffort,
      pickerOpen,
      setPickerOpen,
      activeRunId,
      setActiveRunId,
      durableState,
      liveUsage,
      activity,
      setActivity,
      events,
      appendEvent,
      clearEvents,
      artifacts,
      appendArtifact,
      clearArtifacts,
      humanInputRequest,
      setHumanInputRequest,
      status,
      startRun,
      setRunStatus,
      runType,
      activeActor,
      activeActors,
      continuationText,
      appendContinuationText,
      clearContinuationText,
      reset
    ]
  );

  return createElement(RunContext.Provider, { value }, children);
}

export function useRunContext(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRunContext must be used within <RunContextProvider>");
  return value;
}
