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
import type { Artifact, HumanInputRequest, RunEvent, RunStatus, RunType } from "@spielos/core";
import { orderRunEvents } from "./run-events";

export type RunLifecycleStatus = "idle" | RunStatus;

export type ContextItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
};

export type RunContextValue = {
  contextItems: ContextItem[];
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
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
  continuationText: string;
  appendContinuationText: (text: string) => void;
  clearContinuationText: () => void;
  reset: () => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function RunContextProvider({ children }: { children: ReactNode }) {
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [humanInputRequest, setHumanInputRequest] = useState<HumanInputRequest | null>(null);
  const [status, setStatus] = useState<RunLifecycleStatus>("idle");
  const [runType, setRunType] = useState<RunType | null>(null);
  const [activeActor, setActiveActor] = useState<{ roleId: string; roleName: string } | null>(null);
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
      setHumanInputRequest(null);
    }
  }, []);

  const startRun = useCallback((type: RunType, initialActivity: string | null = null) => {
    setEvents([]);
    setArtifacts([]);
    setActiveRunId(null);
    setActivity(initialActivity);
    setHumanInputRequest(null);
    setRunType(type);
    setActiveActor(null);
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
    setActivity(null);
    setHumanInputRequest(null);
    setStatus("idle");
    setRunType(null);
    setActiveActor(null);
    setContinuationText("");
  }, []);

  const value = useMemo<RunContextValue>(
    () => ({
      contextItems,
      addContext,
      removeContext,
      clearContext,
      pickerOpen,
      setPickerOpen,
      activeRunId,
      setActiveRunId,
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
      continuationText,
      appendContinuationText,
      clearContinuationText,
      reset
    }),
    [
      contextItems,
      addContext,
      removeContext,
      clearContext,
      pickerOpen,
      setPickerOpen,
      activeRunId,
      setActiveRunId,
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
