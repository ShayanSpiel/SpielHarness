import type {
  RunStatus,
  RunEvent,
  Artifact,
  HumanInputRequest,
  ChatMessage,
  SseFrame,
  RunType,
} from "./index.ts";

export type TransportStatus = "idle" | "submitting" | "connecting" | "streaming" | "reconnecting" | "closed" | "error";

export type RunLifecycleStatus = "idle" | RunStatus;

export type LiveRunUsage = {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  contextInputTokens?: number;
  contextOutputTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  contextModelId?: string | null;
};

export type DurableRunState = {
  goal?: {
    objective: string;
    constraints: string[];
    successCriteria: string[];
  };
  budget?: {
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
    maxDurationMs: number | null;
    maxToolCalls: number | null;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    contextInputTokens?: number;
    contextOutputTokens?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    contextModelId?: string | null;
    startedAt: string;
    deadlineAt: string | null;
  };
  context?: {
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
  };
  progress?: {
    milestone?: string;
    nextActions?: string[];
    [key: string]: unknown;
  };
  verification?: {
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type RunEntry = {
  runId: string;
  chatId: string;
  turnId: string;
  generationId: string;
  runStatus: RunLifecycleStatus;
  transportStatus: TransportStatus;
  runType: RunType;
  checkpointVersion: number;
  streamId: string | null;
  lastStreamSequence: number;
  error: string | null;
  activity: string | null;
  usage: LiveRunUsage | null;
  humanInput: HumanInputRequest | null;
  events: RunEvent[];
  artifacts: Artifact[];
  durableState: DurableRunState | null;
};

export type RuntimeAction =
  | { type: "submission_started"; chatId: string; generationId: string; idempotencyKey: string }
  | { type: "submission_rejected"; generationId: string; error: string }
  | { type: "run_bound"; chatId: string; runId: string; turnId: string; generationId: string }
  | { type: "stream_opened"; runId: string; streamId: string; initialSequence?: number }
  | { type: "stream_progressed"; runId: string; sequence: number; firstSequence?: number; checkpointVersion?: number }
  | { type: "frame_received"; runId: string; frame: SseFrame; sequence: number; checkpointVersion?: number }
  | { type: "checkpoint_observed"; runId: string; checkpointVersion: number }
  | { type: "stream_closed"; runId: string; status: RunStatus }
  | { type: "transport_error"; runId: string; error: string }
  | { type: "restore_loaded"; runId: string; runType: RunType; runStatus: RunStatus; durableState: DurableRunState | null; usage: LiveRunUsage | null; humanInput: HumanInputRequest | null; events: RunEvent[]; artifacts: Artifact[]; checkpointVersion: number }
  | { type: "realtime_hint_received"; runId: string; checkpointVersion: number }
  | { type: "cancel_requested"; runId: string }
  | { type: "cancel_confirmed"; runId: string }
  | { type: "human_input_received"; runId: string; request: HumanInputRequest }
  | { type: "human_input_submitted"; runId: string; generationId?: string }
  | { type: "text_appended"; runId: string; text: string }
  | { type: "transient_message_replaced"; runId: string; message: ChatMessage };

export function orderRunEvents(events: readonly RunEvent[]): RunEvent[] {
  return events
    .map((event, arrival) => ({ event, arrival }))
    .sort((left, right) => {
      const leftSequence = left.event.sequence > 0 ? left.event.sequence : null;
      const rightSequence = right.event.sequence > 0 ? right.event.sequence : null;
      if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      const timeDelta = Date.parse(left.event.createdAt) - Date.parse(right.event.createdAt);
      if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
      return left.arrival - right.arrival;
    })
    .map(({ event }) => event);
}

export function createRunEntry(
  runId: string,
  chatId: string,
  turnId: string,
  generationId: string,
): RunEntry {
  return {
    runId,
    chatId,
    turnId,
    generationId,
    runStatus: "running",
    transportStatus: "connecting",
    runType: "chat" as RunType,
    checkpointVersion: 0,
    streamId: null,
    lastStreamSequence: -1,
    error: null,
    activity: null,
    usage: null,
    humanInput: null,
    events: [],
    artifacts: [],
    durableState: null,
  };
}

export function runtimeReducer(
  state: { runs: Record<string, RunEntry>; activeRunId: string | null },
  action: RuntimeAction,
): { runs: Record<string, RunEntry>; activeRunId: string | null } {
  const runs = { ...state.runs };

  switch (action.type) {
    case "submission_started": {
      const runId = `pending:${action.generationId}`;
      const prior = state.activeRunId ? state.runs[state.activeRunId] : undefined;
      const sameChatProjection = prior?.chatId === action.chatId ? prior : undefined;
      runs[runId] = {
        ...createRunEntry(runId, action.chatId, "", action.generationId),
        transportStatus: "submitting",
        // Context capacity and durable progress describe the conversation,
        // not the HTTP attempt. Retain them until authoritative frames for
        // the new run arrive so a submission never flashes the inspector.
        usage: sameChatProjection?.usage ?? null,
        durableState: sameChatProjection?.durableState ?? null,
      };
      return { runs, activeRunId: runId };
    }

    case "submission_rejected": {
      for (const [id, entry] of Object.entries(runs)) {
        if (entry.generationId === action.generationId) {
          runs[id] = {
            ...entry,
            transportStatus: "error",
            error: action.error,
            runStatus: "failed",
          };
        }
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "run_bound": {
      for (const [id, entry] of Object.entries(runs)) {
        if (entry.generationId === action.generationId && id.startsWith("pending:")) {
          const wasActive = state.activeRunId === id;
          delete runs[id];
          const newEntry = {
            ...entry,
            runId: action.runId,
            chatId: action.chatId || entry.chatId,
            turnId: action.turnId,
            transportStatus: "connecting" as TransportStatus,
          };
          runs[action.runId] = newEntry;
          return { runs, activeRunId: wasActive ? action.runId : state.activeRunId };
        }
      }
      const existing = runs[action.runId];
      if (existing) {
        runs[action.runId] = {
          ...existing,
          chatId: action.chatId || existing.chatId,
          turnId: action.turnId || existing.turnId,
          generationId: action.generationId || existing.generationId,
          transportStatus: "connecting",
          error: null,
        };
        return {
          runs,
          activeRunId: state.activeRunId === action.runId ? action.runId : state.activeRunId,
        };
      }
      runs[action.runId] = {
        ...createRunEntry(action.runId, action.chatId, action.turnId, action.generationId),
        transportStatus: "connecting",
      };
      return { runs, activeRunId: action.runId };
    }

    case "stream_opened": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = {
          ...entry,
          streamId: action.streamId,
          lastStreamSequence: action.initialSequence ?? -1,
          transportStatus: "streaming",
          error: null,
        };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "stream_progressed": {
      const entry = runs[action.runId];
      if (!entry || action.sequence < 0 || action.sequence <= entry.lastStreamSequence) return state;
      const firstSequence = action.firstSequence ?? action.sequence;
      runs[action.runId] = {
        ...entry,
        lastStreamSequence: action.sequence,
        checkpointVersion: typeof action.checkpointVersion === "number"
          ? Math.max(entry.checkpointVersion, action.checkpointVersion)
          : entry.checkpointVersion,
        transportStatus: firstSequence > entry.lastStreamSequence + 1
          ? "reconnecting"
          : entry.streamId ? "streaming" : entry.transportStatus,
      };
      return { runs, activeRunId: state.activeRunId };
    }

    case "frame_received": {
      const entry = runs[action.runId];
      if (!entry) return state;
      let nextEntry: RunEntry = { ...entry };
      if (action.sequence >= 0) {
        if (action.sequence <= nextEntry.lastStreamSequence) return state;
        if (action.sequence > nextEntry.lastStreamSequence + 1) {
          nextEntry.transportStatus = "reconnecting";
        } else if (nextEntry.streamId) {
          nextEntry.transportStatus = "streaming";
        }
        nextEntry.lastStreamSequence = action.sequence;
      }
      if (typeof action.checkpointVersion === "number") {
        nextEntry.checkpointVersion = Math.max(nextEntry.checkpointVersion, action.checkpointVersion);
      }
      const frame = action.frame;
      if (frame.kind === "event") {
        if (!nextEntry.events.some((e) => e.id === frame.event.id)) {
          nextEntry.events = orderRunEvents([...nextEntry.events, frame.event]);
        }
        if (
          frame.event.type === "run_started"
          || frame.event.type === "node_started"
          || frame.event.type === "skill_started"
          || frame.event.type === "tool_call_started"
          || frame.event.type === "node_retrying"
          || frame.event.type === "status"
        ) {
          nextEntry.activity = frame.event.message;
        }
        if (frame.event.type === "run_completed") nextEntry.runStatus = "completed";
        if (frame.event.type === "run_failed") nextEntry.runStatus = "failed";
        if (frame.event.type === "run_cancelled") nextEntry.runStatus = "cancelled";
        if (frame.event.type === "human_input_requested") nextEntry.runStatus = "waiting_human";
      } else if (frame.kind === "artifact") {
        if (!nextEntry.artifacts.some((a) => a.id === frame.artifact.id)) {
          nextEntry.artifacts = [...nextEntry.artifacts, frame.artifact];
        }
      } else if (frame.kind === "run_state") {
        nextEntry.durableState = frame.state as unknown as DurableRunState;
      } else if (frame.kind === "usage") {
        nextEntry.usage = frame.usage as unknown as LiveRunUsage;
      } else if (frame.kind === "human_input") {
        nextEntry.humanInput = frame.request;
      } else if (frame.kind === "status") {
        nextEntry.activity = frame.message;
      } else if (frame.kind === "error") {
        nextEntry.runStatus = "failed";
        nextEntry.error = frame.message;
      }
      runs[action.runId] = nextEntry;
      return { runs, activeRunId: state.activeRunId };
    }

    case "checkpoint_observed": {
      const entry = runs[action.runId];
      if (entry && action.checkpointVersion > entry.checkpointVersion) {
        runs[action.runId] = { ...entry, checkpointVersion: action.checkpointVersion };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "stream_closed": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = {
          ...entry,
          transportStatus: action.status === "running" ? "reconnecting" : "closed",
          runStatus: action.status,
          streamId: null,
          activity: action.status === "running" ? entry.activity : null,
          humanInput: action.status === "waiting_human" ? entry.humanInput : null,
        };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "transport_error": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = { ...entry, transportStatus: "error", error: action.error };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "restore_loaded": {
      const entry = runs[action.runId];
      if (entry) {
        if (entry.streamId || action.checkpointVersion < entry.checkpointVersion) return state;
        runs[action.runId] = {
          ...entry,
          runType: action.runType,
          runStatus: action.runStatus,
          durableState: action.durableState,
          usage: action.usage,
          humanInput: action.humanInput,
          events: orderRunEvents(action.events),
          artifacts: action.artifacts,
          checkpointVersion: Math.max(entry.checkpointVersion, action.checkpointVersion),
          transportStatus: "closed",
          error: null,
          activity: null,
        };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "realtime_hint_received": {
      const entry = runs[action.runId];
      if (entry && action.checkpointVersion > entry.checkpointVersion) {
        runs[action.runId] = { ...entry, checkpointVersion: action.checkpointVersion };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "cancel_requested": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = {
          ...entry,
          transportStatus: "submitting",
          activity: "Cancelling…",
        };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "cancel_confirmed": {
      return { runs, activeRunId: state.activeRunId };
    }

    case "human_input_received": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = { ...entry, humanInput: action.request, runStatus: "waiting_human" };
      }
      return { runs, activeRunId: state.activeRunId };
    }

    case "human_input_submitted": {
      const entry = runs[action.runId];
      if (entry) {
        runs[action.runId] = {
          ...entry,
          humanInput: null,
          generationId: action.generationId ?? entry.generationId,
          runStatus: "running",
          transportStatus: "submitting",
        };
      }
      return { runs, activeRunId: state.activeRunId };
    }
  }

  return state;
}
