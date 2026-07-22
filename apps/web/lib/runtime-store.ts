"use client";

import { create } from "zustand";
import {
  type ChatMessage,
  type RunEvent,
  type Artifact,
  type HumanInputRequest,
  type Chat as CoreChat,
  type RunType,
  type TransportStatus,
  type RunLifecycleStatus,
  type LiveRunUsage,
  type DurableRunState,
  type RunEntry,
  type RuntimeAction,
  runtimeReducer,
  createRunEntry,
  orderRunEvents,
  messageRowToChatMessage,
  upsertMessage as mergeMessage,
  mergeMessages,
  reconcileChats,
} from "@spielos/core";
import { toast } from "@spielos/design-system";
import { fetchJsonWithRetry } from "./fetch-json";

// Re-exported for backward compat with existing consumers
export type { DurableRunState, RunLifecycleStatus, LiveRunUsage, RuntimeAction } from "@spielos/core";

export type ContextItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
};

function updateActiveRunDerived(
  runs: Record<string, RunEntry>,
  activeRunId: string | null,
): Partial<RuntimeDerivedState> {
  const entry = activeRunId && runs[activeRunId] ? runs[activeRunId] : null;
  return {
    activeRunId: activeRunId,
    runStatus: entry?.runStatus ?? "idle",
    transportStatus: entry?.transportStatus ?? "idle",
    runType: entry?.runType ?? null,
    activity: entry?.activity ?? null,
    events: entry?.events ?? [],
    artifacts: entry?.artifacts ?? [],
    durableState: entry?.durableState ?? null,
    liveUsage: entry?.usage ?? null,
    humanInputRequest: entry?.humanInput ?? null,
    checkpointVersion: entry?.checkpointVersion ?? 0,
  };
}

type RuntimeDerivedState = {
  activeRunId: string | null;
  runStatus: RunLifecycleStatus;
  transportStatus: TransportStatus;
  runType: RunType | null;
  activity: string | null;
  events: RunEvent[];
  artifacts: Artifact[];
  durableState: DurableRunState | null;
  liveUsage: LiveRunUsage | null;
  humanInputRequest: HumanInputRequest | null;
  checkpointVersion: number;
};

// ── Store state ──────────────────────────────────────────────────

export type RuntimeState = {
  runs: Record<string, RunEntry>;
  activeRunId: string | null;
  runStatus: RunLifecycleStatus;
  transportStatus: TransportStatus;
  runType: RunType | null;
  activity: string | null;
  events: RunEvent[];
  artifacts: Artifact[];
  durableState: DurableRunState | null;
  liveUsage: LiveRunUsage | null;
  humanInputRequest: HumanInputRequest | null;
  checkpointVersion: number;
  activeStreams: Set<string>;

  chats: Chat[];
  activeChatId: string | null;
  messages: Record<string, ChatMessage[]>;
  ready: boolean;
  chatVersions: Map<string, number>;

  contextItems: ContextItem[];
  pendingModelId: string | null;
  pendingReasoningEffort: string;
  pendingExecutionMode: string;
  pickerOpen: boolean;
};

type Actions = {
  dispatch: (action: RuntimeAction) => void;

  isGenerationCurrent: (gid: string) => boolean;
  beginRunAttempt: () => string;
  resetRun: () => void;
  activateRunProjection: (runId: string) => void;
  startNewChat: () => void;
  restoreRun: (runId: string, options?: { force?: boolean }) => Promise<void>;

  setActiveChat: (id: string | null) => void;
  createChat: (title?: string, activate?: boolean) => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  archiveChat: (id: string) => Promise<void>;
  updateChatMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
  appendMessage: (chatId: string, message: { role: "user" | "assistant" | "system"; body: string }) => Promise<ChatMessage>;
  fetchChatMessages: (chatId: string) => Promise<void>;
  hydrateChat: (chatId: string, value: { messages: ChatMessage[]; metadata?: Record<string, unknown> }) => void;
  reloadChats: () => Promise<void>;
  upsertMessage: (chatId: string, msg: ChatMessage) => void;
  reconcilePersistedMessage: (chatId: string, msg: ChatMessage, generationId?: string) => void;
  appendStreamText: (chatId: string, runId: string, generationId: string, text: string) => void;
  discardTransientGeneration: (chatId: string, generationId: string) => void;
  upsertChat: (chat: CoreChat) => void;

  attachStream: (runId: string) => void;
  detachStream: (runId: string) => void;
  hasActiveStream: (runId: string) => boolean;

  // Backward-compat flat setters (use dispatch instead for new code)
  setRunStatus: (status: RunLifecycleStatus) => void;
  setRunType: (type: RunType | null) => void;
  setActivity: (activity: string | null) => void;
  appendEvent: (event: RunEvent) => void;
  clearEvents: () => void;
  appendArtifact: (artifact: Artifact) => void;
  clearArtifacts: () => void;
  setDurableState: (state: DurableRunState | null) => void;
  setLiveUsage: (usage: LiveRunUsage | null) => void;
  setHumanInputRequest: (request: HumanInputRequest | null) => void;

  setContextItems: (items: ContextItem[]) => void;
  addContext: (item: ContextItem) => void;
  removeContext: (id: string) => void;
  clearContext: () => void;
  setPendingModelId: (id: string | null) => void;
  setPendingReasoningEffort: (effort: string) => void;
  setPendingExecutionMode: (mode: string) => void;
  setPickerOpen: (open: boolean) => void;
};

const ACTIVE_CHAT_STORAGE_KEY = "spielos.activeChatId";

function nowIso() {
  return new Date().toISOString();
}

function storeActiveChatId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
}

const restoreRequests = new Map<string, Promise<void>>();

type RestorePayload = {
  checkpointVersion?: number;
  run: {
    chat_id: string | null;
    type: RunType;
    status: Exclude<RunLifecycleStatus, "idle">;
    state: Record<string, unknown>;
    inputs: Record<string, unknown>;
  };
  chat?: {
    id: string;
    title: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  } | null;
  messages?: Array<Record<string, unknown>>;
  usage: LiveRunUsage;
  events: Array<{
    id: string;
    org_id: string;
    run_id: string;
    event_type: RunEvent["type"];
    sequence: number;
    node_id: string | null;
    node_title: string | null;
    skill_id: string | null;
    skill_name: string | null;
    message: string;
    payload: Record<string, unknown>;
    event_key: string | null;
    created_at: string;
  }>;
  artifacts: Artifact[];
};

function applyDispatch(
  set: (partial: Partial<RuntimeState> | ((state: RuntimeState) => Partial<RuntimeState>)) => void,
  get: () => RuntimeState,
  action: RuntimeAction,
): void {
  if (process.env.NODE_ENV !== "production") {
    const preview = action.type === "frame_received"
      ? { type: action.type, runId: action.runId, kind: action.frame.kind, seq: action.sequence }
      : action.type === "run_bound"
        ? { type: action.type, runId: action.runId, chatId: action.chatId }
        : action.type === "stream_closed"
          ? { type: action.type, runId: action.runId, status: action.status }
          : action.type === "submission_started"
            ? { type: action.type, chatId: action.chatId, generationId: action.generationId?.slice(0, 8) }
            : { type: action.type };
    console.log(`[STORE] dispatch`, preview);
  }
  set((state) => {
    const { runs, activeRunId } = runtimeReducer(
      { runs: state.runs, activeRunId: state.activeRunId },
      action,
    );
    const derived = updateActiveRunDerived(runs, activeRunId);
    const patch: Partial<RuntimeState> = { runs, activeRunId, ...derived };
    if (
      (action.type === "submission_started" || (action.type === "run_bound" && activeRunId === action.runId))
      && action.chatId
      && action.chatId !== state.activeChatId
    ) {
      patch.activeChatId = action.chatId;
    }
    return patch;
  });
}

export const useRuntimeStore = create<RuntimeState & Actions>()((set, get) => ({
  runs: {},
  activeRunId: null,
  runStatus: "idle" as RunLifecycleStatus,
  transportStatus: "idle",
  runType: null,
  activity: null,
  events: [],
  artifacts: [],
  durableState: null,
  liveUsage: null,
  humanInputRequest: null,
  checkpointVersion: 0,
  activeStreams: new Set(),

  chats: [],
  activeChatId: null,
  messages: {},
  ready: false,
  chatVersions: new Map(),

  contextItems: [],
  pendingModelId: null,
  pendingReasoningEffort: "auto",
  pendingExecutionMode: "direct",
  pickerOpen: false,

  dispatch: (action) => {
    applyDispatch(set, get, action);
    if (action.type === "run_bound" && action.chatId && get().activeRunId === action.runId) {
      storeActiveChatId(action.chatId);
    }
  },

  isGenerationCurrent: (gid) => {
    const s = get();
    for (const entry of Object.values(s.runs)) {
      if (entry.generationId === gid) return true;
    }
    return false;
  },

  beginRunAttempt: () => {
    const generation = crypto.randomUUID();
    return generation;
  },

  resetRun: () => set((s) => ({ activeRunId: null, ...updateActiveRunDerived(s.runs, null) })),

  activateRunProjection: (runId) => {
    set((s) => {
      const runs = { ...s.runs };
      if (!runs[runId]) {
        // Route restoration is not execution. Keep an unhydrated projection
        // idle until the durable run says otherwise so reloads never fabricate
        // a running assistant turn ("Thinking…" / Stop) for terminal runs.
        runs[runId] = {
          ...createRunEntry(runId, s.activeChatId ?? "", "", ""),
          runStatus: "idle",
          transportStatus: "idle",
        };
      }
      const derived = updateActiveRunDerived(runs, runId);
      return { runs, activeRunId: runId, ...derived };
    });
  },

  startNewChat: () => {
    storeActiveChatId(null);
    set((s) => ({
      activeChatId: null,
      activeRunId: null,
      contextItems: [],
      pickerOpen: false,
      ...updateActiveRunDerived(s.runs, null),
    }));
  },

  restoreRun: async (runId, options) => {
    if (!runId || runId.startsWith("pending:")) return;
    const beforeRequest = get();
    if (beforeRequest.runs[runId]?.streamId || beforeRequest.activeStreams.has(runId)) return;
    const existingRequest = restoreRequests.get(runId);
    if (existingRequest) return existingRequest;
    const request = (async () => {
      const before = get();
      const entry = before.runs[runId];
      get().activateRunProjection(runId);
      const since = options?.force ? -1 : (entry?.checkpointVersion ?? 0);
      const response = await fetch(`/api/runs/${runId}?since=${since}`, { cache: "no-store" });
      if (response.status === 304) return;
      if (!response.ok) throw new Error(`Run restore failed: HTTP ${response.status}`);
      const payload = await response.json() as RestorePayload;
      const latest = get();
      const latestEntry = latest.runs[runId];
      if (latestEntry?.streamId || latest.activeStreams.has(runId)) return;
      const checkpointVersion = payload.checkpointVersion ?? 0;
      if (!options?.force && latestEntry && checkpointVersion < latestEntry.checkpointVersion) return;
      const restoredState = payload.run.state as DurableRunState;
      const inputBudget = payload.run.inputs?.budget;
      const withBudget = restoredState.budget || !inputBudget || typeof inputBudget !== "object"
        ? restoredState
        : { ...restoredState, budget: inputBudget as DurableRunState["budget"] };
      const inputContext = payload.run.inputs?.contextLimits;
      const durableState = withBudget.context || !inputContext || typeof inputContext !== "object"
        ? withBudget
        : { ...withBudget, context: inputContext as DurableRunState["context"] };
      const humanInput = payload.run.status === "waiting_human"
        && restoredState.pendingHumanInput
        && typeof restoredState.pendingHumanInput === "object"
        ? restoredState.pendingHumanInput as HumanInputRequest
        : null;
      get().dispatch({
        type: "restore_loaded",
        runId,
        runType: payload.run.type,
        runStatus: payload.run.status,
        durableState,
        usage: payload.usage ?? null,
        humanInput,
        events: payload.events.map((event) => ({
          id: event.event_key ?? event.id,
          orgId: event.org_id,
          runId: event.run_id,
          type: event.event_type,
          sequence: Number(event.sequence),
          nodeId: event.node_id ?? undefined,
          nodeTitle: event.node_title ?? undefined,
          skillId: event.skill_id ?? undefined,
          skillName: event.skill_name ?? undefined,
          message: event.message,
          payload: event.payload ?? {},
          createdAt: event.created_at,
        })),
        artifacts: payload.artifacts ?? [],
        checkpointVersion,
      });
      if (payload.run.chat_id) {
        const chatId = payload.run.chat_id;
        const incoming = (payload.messages ?? [])
          .filter((message) => {
            const role = String(message.role ?? "");
            return role === "user" || role === "assistant" || role === "system";
          })
          .map((message) => messageRowToChatMessage(message as Parameters<typeof messageRowToChatMessage>[0]));
        const local = get().messages[chatId] ?? [];
        get().hydrateChat(chatId, {
          messages: mergeMessages(local, incoming),
          metadata: payload.chat?.metadata,
        });
        if (payload.chat) {
          get().upsertChat({
            id: payload.chat.id,
            orgId: "",
            title: payload.chat.title,
            metadata: payload.chat.metadata ?? {},
            createdAt: payload.chat.created_at,
            updatedAt: payload.chat.updated_at,
            archivedAt: payload.chat.archived_at,
          });
        }
        storeActiveChatId(chatId);
        set({ activeChatId: chatId });
      }
    })().catch((error) => {
      if (process.env.NODE_ENV !== "production") console.error("Run restore failed:", error);
    }).finally(() => {
      restoreRequests.delete(runId);
    });
    restoreRequests.set(runId, request);
    return request;
  },

  setActiveChat: (id) => {
    storeActiveChatId(id);
    set({ activeChatId: id });
    if (id) get().fetchChatMessages(id).catch(() => {});
  },

  createChat: async (title = "New chat", activate = true) => {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error("Failed to create chat");
    const data = (await res.json()) as {
      chat: { id: string; title: string; metadata: Record<string, unknown>; created_at: string; updated_at: string; archived_at: string | null };
    };
    const chat: Chat = {
      id: data.chat.id,
      title: data.chat.title,
      createdAt: data.chat.created_at,
      updatedAt: data.chat.updated_at,
      archivedAt: data.chat.archived_at,
      metadata: data.chat.metadata ?? {},
    };
    const versions = new Map(get().chatVersions);
    versions.set(chat.id, (versions.get(chat.id) ?? 0) + 1);
    set((s) => ({
      chats: [chat, ...s.chats],
      messages: { ...s.messages, [chat.id]: [] },
      chatVersions: versions,
    }));
    if (activate) {
      storeActiveChatId(chat.id);
      set({ activeChatId: chat.id });
    }
    return chat;
  },

  renameChat: async (id, title) => {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!res.ok) return;
    const versions = new Map(get().chatVersions);
    versions.set(id, (versions.get(id) ?? 0) + 1);
    set((s) => ({
      chats: s.chats.map((c) => (c.id === id ? { ...c, title, updatedAt: nowIso() } : c)),
      chatVersions: versions,
    }));
  },

  archiveChat: async (id) => {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, archived: true }),
    });
    if (!res.ok) return;
    set((s) => {
      const messages = { ...s.messages };
      delete messages[id];
      return {
        chats: s.chats.filter((c) => c.id !== id),
        messages,
        activeChatId: s.activeChatId === id ? null : s.activeChatId,
      };
    });
    storeActiveChatId(null);
  },

  updateChatMetadata: async (id, patch) => {
    set((s) => ({
      chats: s.chats.map((chat) =>
        chat.id === id ? { ...chat, metadata: { ...chat.metadata, ...patch }, updatedAt: nowIso() } : chat,
      ),
    }));
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, metadata: patch }),
    });
    if (!res.ok) {
      await get().reloadChats();
      throw new Error("Failed to save chat context");
    }
  },

  appendMessage: async (chatId, message) => {
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error("Failed to append message");
    const data = (await res.json()) as { message: ChatMessage };
    set((s) => ({
      messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), data.message] },
    }));
    return data.message;
  },

  fetchChatMessages: async (chatId) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages?limit=200`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: Array<Record<string, unknown>> };
      if (!Array.isArray(data.messages)) return;
      const incoming = data.messages
        .filter((m) => {
          const role = String(m.role ?? "");
          return role === "user" || role === "assistant" || role === "system";
        })
        .map((m) => messageRowToChatMessage(m as Parameters<typeof messageRowToChatMessage>[0]));
      set((s) => {
        const activeGenerations = new Set(Object.values(s.runs)
          .filter((entry) => entry.chatId === chatId && (entry.runStatus === "running" || entry.runStatus === "waiting_human"))
          .map((entry) => entry.generationId));
        const local = (s.messages[chatId] ?? []).filter((message) => {
          const generationId = typeof message.metadata?.generationId === "string" ? message.metadata.generationId : null;
          if (!message.metadata?.optimistic && !message.metadata?.transient) return true;
          return Boolean(generationId && activeGenerations.has(generationId));
        });
        return { messages: { ...s.messages, [chatId]: mergeMessages(local, incoming) } };
      });
    } catch {
      // Messages arrive on next reload or when the user opens the chat
    }
  },

  hydrateChat: (chatId, value) => {
    set((s) => ({
      messages: { ...s.messages, [chatId]: value.messages },
      chats: value.metadata
        ? s.chats.map((c) =>
            c.id === chatId ? { ...c, metadata: { ...c.metadata, ...value.metadata }, updatedAt: nowIso() } : c,
          )
        : s.chats,
    }));
  },

  reloadChats: async () => {
    if (typeof window !== "undefined" && window.location.pathname === "/login") {
      set({ ready: true });
      return;
    }
    try {
      const versionsAtStart = new Map(get().chatVersions);
      const data = await fetchJsonWithRetry<{
        chats: Array<{
          id: string;
          title: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
          metadata: Record<string, unknown>;
        }>;
      }>("/api/chats", { cache: "no-store" });
      const newChats: Chat[] = data.chats.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        archivedAt: c.archived_at,
        metadata: c.metadata ?? {},
      }));
      const { chatVersions, activeChatId, contextItems, pendingModelId, pendingReasoningEffort, pendingExecutionMode, pickerOpen, runs, activeRunId } = get();
      const mutatedIds = new Set<string>();
      for (const [id, version] of chatVersions) {
        if (version > (versionsAtStart.get(id) ?? 0)) {
          mutatedIds.add(id);
        }
      }
      const reconciled = reconcileChats(get().chats, newChats, mutatedIds);
      set({
        chats: reconciled,
        activeChatId: activeChatId && reconciled.some((c) => c.id === activeChatId && !c.archivedAt) ? activeChatId : null,
        ready: true,
        contextItems,
        pendingModelId,
        pendingReasoningEffort,
        pendingExecutionMode,
        pickerOpen,
        runs,
        activeRunId,
      });
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to load chats:", err);
      }
      toast.error("Chat history could not be loaded", {
        description: "SpielOS will retry when the workspace refreshes.",
      });
      set({ ready: true });
    }
  },

  upsertMessage: (chatId, msg) => {
    set((s) => ({
      messages: { ...s.messages, [chatId]: mergeMessage(s.messages[chatId] ?? [], msg) },
    }));
  },

  reconcilePersistedMessage: (chatId, msg, generationId) => {
    set((s) => {
      const current = s.messages[chatId] ?? [];
      const cleaned = generationId
        ? current.filter((message) => {
            if (message.metadata?.generationId !== generationId) return true;
            if (msg.role === "user") return !message.metadata?.optimistic;
            if (msg.role === "assistant") return !message.metadata?.transient;
            return true;
          })
        : current;
      return { messages: { ...s.messages, [chatId]: mergeMessage(cleaned, msg) } };
    });
  },

  appendStreamText: (chatId, runId, generationId, text) => {
    if (!text) return;
    set((s) => {
      const current = s.messages[chatId] ?? [];
      const id = `stream:${generationId}`;
      const existing = current.find((message) => message.id === id);
      const streamed: ChatMessage = existing
        ? { ...existing, body: existing.body + text }
        : {
            id,
            chatId,
            orgId: "",
            role: "assistant",
            body: text,
            metadata: { transient: true, generationId, runId },
            createdAt: nowIso(),
            sequenceNumber: (current.at(-1)?.sequenceNumber ?? current.length) + 1,
          };
      return { messages: { ...s.messages, [chatId]: mergeMessage(current, streamed) } };
    });
  },

  discardTransientGeneration: (chatId, generationId) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).filter((message) =>
          message.metadata?.generationId !== generationId || (!message.metadata?.transient && !message.metadata?.optimistic)),
      },
    }));
  },

  upsertChat: (chat) => {
    const versions = new Map(get().chatVersions);
    versions.set(chat.id, (versions.get(chat.id) ?? 0) + 1);
    set((s) => {
      const idx = s.chats.findIndex((c) => c.id === chat.id);
      if (idx >= 0) {
        const copy = [...s.chats];
        copy[idx] = { ...copy[idx], ...chat } as Chat;
        return { chats: copy, chatVersions: versions };
      }
      return {
        chats: [{ ...chat, archivedAt: (chat as { archivedAt?: string | null }).archivedAt ?? null } as Chat, ...s.chats],
        chatVersions: versions,
      };
    });
  },

  // Backward-compat flat setters that delegate to the per-run entry
  // These update the active run's entry in the runs map
  setRunStatus: (status) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { runStatus: status };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], runStatus: status };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  setRunType: (runType) => set({ runType }),

  setActivity: (activity) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { activity };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], activity };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  appendEvent: (event) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) {
        if (s.events.some((e) => e.id === event.id)) return {};
        return { events: orderRunEvents([...s.events, event]) };
      }
      const runs = { ...s.runs };
      const entry = { ...runs[s.activeRunId] };
      const updated = entry.events.some((e) => e.id === event.id)
        ? entry.events
        : orderRunEvents([...entry.events, event]);
      let newStatus: RunLifecycleStatus = entry.runStatus;
      if (event.type === "human_input_requested") newStatus = "waiting_human" as RunLifecycleStatus;
      if (event.type === "run_completed") newStatus = "completed";
      if (event.type === "run_failed") newStatus = "failed";
      if (event.type === "run_cancelled") newStatus = "cancelled";
      entry.events = updated;
      entry.runStatus = newStatus;
      if (event.type === "run_started" || event.type === "node_started" || event.type === "skill_started" || event.type === "tool_call_started" || event.type === "node_retrying" || event.type === "status") {
        entry.activity = event.message;
      }
      runs[s.activeRunId] = entry;
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  clearEvents: () => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { events: [] };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], events: [] };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, events: [], ...derived };
    });
  },

  appendArtifact: (artifact) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) {
        return s.artifacts.some((a) => a.id === artifact.id) ? {} : { artifacts: [...s.artifacts, artifact] };
      }
      const runs = { ...s.runs };
      const entry = { ...runs[s.activeRunId] };
      entry.artifacts = entry.artifacts.some((a) => a.id === artifact.id)
        ? entry.artifacts
        : [...entry.artifacts, artifact];
      runs[s.activeRunId] = entry;
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  clearArtifacts: () => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { artifacts: [] };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], artifacts: [] };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, artifacts: [], ...derived };
    });
  },

  setDurableState: (durableState) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { durableState };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], durableState };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  setLiveUsage: (liveUsage) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { liveUsage };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], usage: liveUsage };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  setHumanInputRequest: (humanInputRequest) => {
    set((s) => {
      if (!s.activeRunId || !s.runs[s.activeRunId]) return { humanInputRequest };
      const runs = { ...s.runs };
      runs[s.activeRunId] = { ...runs[s.activeRunId], humanInput: humanInputRequest };
      const derived = updateActiveRunDerived(runs, s.activeRunId);
      return { runs, ...derived };
    });
  },

  attachStream: (runId) => {
    set((s) => {
      const next = new Set(s.activeStreams);
      next.add(runId);
      return { activeStreams: next };
    });
  },

  detachStream: (runId) => {
    set((s) => {
      const runs = { ...s.runs };
      if (runs[runId]?.streamId) runs[runId] = { ...runs[runId], streamId: null };
      const next = new Set(s.activeStreams);
      next.delete(runId);
      return { runs, activeStreams: next, ...updateActiveRunDerived(runs, s.activeRunId) };
    });
  },

  hasActiveStream: (runId) => get().activeStreams.has(runId),

  setContextItems: (contextItems) => set({ contextItems }),
  addContext: (item) => {
    set((s) => (s.contextItems.some((entry) => entry.id === item.id) ? s : { contextItems: [...s.contextItems, item] }));
  },
  removeContext: (id) => {
    set((s) => ({ contextItems: s.contextItems.filter((entry) => entry.id !== id) }));
  },
  clearContext: () => set({ contextItems: [] }),
  setPendingModelId: (pendingModelId) => set({ pendingModelId }),
  setPendingReasoningEffort: (pendingReasoningEffort) => set({ pendingReasoningEffort }),
  setPendingExecutionMode: (pendingExecutionMode) => set({ pendingExecutionMode }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),
}));
