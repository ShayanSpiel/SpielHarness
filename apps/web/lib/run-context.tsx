"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { DEFAULT_EXECUTION_MODE, type Artifact, type ExecutionMode, type HumanInputRequest, type RunBudget, type RunEvent, type RunGoal, type RunProgress, type RunStatus, type RunType, type RunVerification } from "@spielos/core";
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

export type PendingCommit = {
  chatId: string;
  runId: string;
} | null;

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
  pendingExecutionMode: ExecutionMode;
  setPendingExecutionMode: (mode: ExecutionMode) => void;
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
  // Phase 1 additions:
  currentGeneration: string | null;
  beginRunAttempt: () => string;
  isGenerationCurrent: (gid: string) => boolean;
  activateRunProjection: (runId: string) => void;
  pendingCommit: PendingCommit;
  commitPendingChat: (commit: PendingCommit) => void;
  consumePendingCommit: () => PendingCommit;
  hasActiveStream: (runId: string) => boolean;
  attachStream: (runId: string) => void;
  detachStream: (runId: string) => void;
  // Phase 2: checkpoint version for monotonic restoration
  highestCheckpointVersion: number;
  recordCheckpointVersion: (version: number) => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function RunContextProvider({ children }: { children: ReactNode }) {
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [pendingReasoningEffort, setPendingReasoningEffort] = useState("auto");
  const [pendingExecutionMode, setPendingExecutionMode] = useState(DEFAULT_EXECUTION_MODE);
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
  const [continuationText, setContinuationText] = useState("");
  const [currentGeneration, setCurrentGeneration] = useState<string | null>(null);
  const generationRef = useRef<string | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingCommit>(null);
  const [streamOwnership, setStreamOwnership] = useState<Record<string, string>>({});
  const [highestCheckpointVersion, setHighestCheckpointVersion] = useState(0);

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
      setHumanInputRequest(null);
    }
  }, []);

  // Phase 1: split startRun into non-destructive attempt + deferred activation
  const startRun = useCallback((type: RunType, initialActivity: string | null = null) => {
    setEvents([]);
    setArtifacts([]);
    setActiveRunId(null);
    setDurableState(null);
    setLiveUsage(null);
    setActivity(initialActivity);
    setHumanInputRequest(null);
    setRunType(type);
    setContinuationText("");
    setStatus("running");
  }, []);

  const beginRunAttempt = useCallback(() => {
    const generation = crypto.randomUUID();
    generationRef.current = generation;
    setCurrentGeneration(generation);
    // Status is set for immediate UI feedback but events/artifacts
    // are NOT cleared — that happens in activateRunProjection.
    setStatus("running");
    setActivity("Thinking\u2026");
    return generation;
  }, []);

  const activateRunProjection = useCallback((runId: string) => {
    setEvents([]);
    setArtifacts([]);
    setActiveRunId(runId);
    setDurableState(null);
    setLiveUsage(null);
  }, []);

  const commitPendingChat = useCallback((commit: PendingCommit) => {
    if (commit) setPendingCommit(commit);
  }, []);

  const consumePendingCommit = useCallback(() => {
    let commit: PendingCommit = null;
    setPendingCommit((current) => {
      commit = current;
      return null;
    });
    return commit;
  }, []);

  const attachStream = useCallback((runId: string) => {
    const gen = crypto.randomUUID();
    setStreamOwnership((prev) => ({ ...prev, [runId]: gen }));
  }, []);

  const detachStream = useCallback((runId: string) => {
    setStreamOwnership((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  }, []);

  const hasActiveStream = useCallback((runId: string): boolean => {
    return runId in streamOwnership;
  }, [streamOwnership]);

  const recordCheckpointVersion = useCallback((version: number) => {
    setHighestCheckpointVersion((prev) => Math.max(prev, version));
  }, []);

  const appendEvent = useCallback((event: RunEvent) => {
    setEvents((current) =>
      current.some((entry) => entry.id === event.id)
        ? current
        : orderRunEvents([...current, event])
    );
    if (
      event.type === "run_started" ||
      event.type === "node_started" ||
      event.type === "skill_started" ||
      event.type === "tool_call_started" ||
      event.type === "node_retrying" ||
      event.type === "status"
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

  // Derive `activeActor` and `activeActors` from the events timeline. The
  // timeline is the source of truth; mirroring derived state was creating
  // double bookkeeping and racing with later events. Use a memo so each
  // event append recomputes once per render.
  const { activeActor: derivedActiveActor, activeActors: derivedActiveActors } = useMemo(() => {
    let latest: { roleId: string; roleName: string } | null = null;
    const map = new Map<string, { agentId: string; roleId: string; roleName: string; nodeTitle: string }>();
    const ordered = orderRunEvents(events);
    for (const event of ordered) {
      const roleId = event.payload?.roleId;
      const roleName = event.payload?.roleName;
      if (
        typeof roleId === "string" &&
        typeof roleName === "string" &&
        (event.type === "node_started" || event.type === "skill_started" || event.type === "tool_call_started")
      ) {
        latest = { roleId, roleName };
        const agentId = typeof event.payload?.agentId === "string" ? event.payload.agentId : event.nodeId ?? roleId;
        if (!map.has(agentId)) {
          map.set(agentId, { agentId, roleId, roleName, nodeTitle: event.nodeTitle ?? roleName });
        }
      }
      if ((event.type === "node_completed" || event.type === "node_failed" || event.type === "node_skipped") && event.nodeId) {
        map.delete(event.nodeId);
      }
      if (event.type === "tool_call_result" && typeof event.payload?.callId === "string") {
        map.delete(event.payload.callId);
      }
    }
    return { activeActor: latest, activeActors: Array.from(map.values()) };
  }, [events]);
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
      pendingExecutionMode,
      setPendingExecutionMode,
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
      activeActor: derivedActiveActor,
      activeActors: derivedActiveActors,
      continuationText,
      appendContinuationText,
      clearContinuationText,
      reset,
      currentGeneration,
      isGenerationCurrent: (gid: string) => gid === generationRef.current,
      beginRunAttempt,
      activateRunProjection,
      pendingCommit,
      commitPendingChat,
      consumePendingCommit,
      hasActiveStream,
      attachStream,
      detachStream,
      highestCheckpointVersion,
      recordCheckpointVersion
    }),
    [
      contextItems,
      setContextItems,
      addContext,
      removeContext,
      clearContext,
      pendingModelId,
      pendingReasoningEffort,
      pendingExecutionMode,
      setPendingExecutionMode,
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
      derivedActiveActor,
      derivedActiveActors,
      continuationText,
      appendContinuationText,
      clearContinuationText,
      reset,
      currentGeneration,
      beginRunAttempt,
      activateRunProjection,
      pendingCommit,
      commitPendingChat,
      consumePendingCommit,
      hasActiveStream,
      attachStream,
      detachStream,
      highestCheckpointVersion,
      recordCheckpointVersion
    ]
  );

  return createElement(RunContext.Provider, { value }, children);
}

export function useRunContext(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRunContext must be used within <RunContextProvider>");
  return value;
}
