"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { Artifact, RunEvent } from "@spielos/core";

export type ContextItemKind = "role" | "tool" | "library" | "workstream" | "strategy" | "knowledge" | "eval";

export type ContextItem = {
  id: string;
  kind: ContextItemKind;
  title: string;
  subtitle?: string;
  body?: string;
  meta?: Record<string, string>;
};

export type StreamEvent = RunEvent & { receivedAt: string };

type RunContextValue = {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  contextItems: ContextItem[];
  contextOpen: (open: boolean) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
  events: StreamEvent[];
  appendEvent: (event: RunEvent) => void;
  replaceEvents: (events: RunEvent[]) => void;
  clearEvents: () => void;
  artifacts: Artifact[];
  appendArtifact: (artifact: Artifact) => void;
  replaceArtifacts: (artifacts: Artifact[]) => void;
  clearArtifacts: () => void;
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  runTitle: string;
  setRunTitle: (title: string) => void;
  running: boolean;
  setRunning: (running: boolean) => void;
  activity: string | null;
  setActivity: (activity: string | null) => void;
  resetRun: () => void;
  // Human-in-the-loop
  humanInputRequest: import("@spielos/core").HumanInputRequest | null;
  setHumanInputRequest: (req: import("@spielos/core").HumanInputRequest | null) => void;
};

const RunContext = createContext<RunContextValue | null>(null);

export function RunContextProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpenState] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runTitle, setRunTitle] = useState<string>("New run");
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [humanInputRequest, setHumanInputRequest] = useState<import("@spielos/core").HumanInputRequest | null>(null);
  const openedFromPickerRef = useRef(false);

  const setDrawerOpen = useCallback((open: boolean) => {
    setDrawerOpenState(open);
  }, []);

  const toggleDrawer = useCallback(() => {
    setDrawerOpenState((current) => !current);
  }, []);

  const contextOpen = useCallback((open: boolean) => {
    if (open) openedFromPickerRef.current = true;
  }, []);

  const addContext = useCallback((item: ContextItem) => {
    setContextItems((current) => {
      if (current.some((entry) => entry.id === item.id)) return current;
      return [...current, item];
    });
    setDrawerOpenState(true);
  }, []);

  const removeContext = useCallback((id: string) => {
    setContextItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearContext = useCallback(() => setContextItems([]), []);

  const appendEvent = useCallback((event: RunEvent) => {
    setEvents((current) => [...current, { ...event, receivedAt: new Date().toISOString() }]);
  }, []);

  const replaceEvents = useCallback((nextEvents: RunEvent[]) => {
    setEvents(nextEvents.map((event) => ({ ...event, receivedAt: event.createdAt })));
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  const appendArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((current) =>
      current.some((entry) => entry.id === artifact.id)
        ? current
        : [...current, artifact]
    );
  }, []);

  const replaceArtifacts = useCallback((nextArtifacts: Artifact[]) => {
    setArtifacts(nextArtifacts);
  }, []);

  const clearArtifacts = useCallback(() => setArtifacts([]), []);

  const resetRun = useCallback(() => {
    setEvents([]);
    setArtifacts([]);
    setActivity(null);
    setHumanInputRequest(null);
  }, []);

  const value = useMemo<RunContextValue>(
    () => ({
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      contextItems,
      contextOpen,
      pickerOpen,
      setPickerOpen,
      addContext,
      removeContext,
      clearContext,
      events,
      appendEvent,
      replaceEvents,
      clearEvents,
      artifacts,
      appendArtifact,
      replaceArtifacts,
      clearArtifacts,
      activeRunId,
      setActiveRunId,
      runTitle,
      setRunTitle,
      running,
      setRunning,
      activity,
      setActivity,
      resetRun,
      humanInputRequest,
      setHumanInputRequest
    }),
    [
      drawerOpen,
      setDrawerOpen,
      toggleDrawer,
      contextItems,
      contextOpen,
      pickerOpen,
      addContext,
      removeContext,
      clearContext,
      events,
      appendEvent,
      replaceEvents,
      clearEvents,
      artifacts,
      appendArtifact,
      replaceArtifacts,
      clearArtifacts,
      activeRunId,
      runTitle,
      running,
      activity,
      resetRun,
      humanInputRequest
    ]
  );

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRunContext() {
  const value = useContext(RunContext);
  if (!value) {
    throw new Error("useRunContext must be used inside <RunContextProvider />");
  }
  return value;
}

export const useRun = useRunContext;
