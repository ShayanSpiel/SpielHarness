"use client";

import { useRealtimeSubscription } from "./use-realtime";
import type { DomainEvent } from "./realtime";
import { useRuntimeStore } from "./runtime-store";

// Singleton event bus for realtime events.
// The RealtimeHub subscribes once per org and fans out to registered listeners.
// Consumers register via `onRealtimeEvent` and unregister via the returned function.

type Listener = (event: DomainEvent) => void;

const listeners: Set<Listener> = new Set();

export function onRealtimeEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function dispatchToListeners(event: DomainEvent) {
  for (const fn of listeners) {
    try { fn(event); } catch { /* consumer error, continue */ }
  }
}

// Single org-level realtime subscription. Mounted once in AppProviders.
export function RealtimeHub() {
  const orgCookie = typeof document === "undefined" ? null : document.cookie
    .split("; ")
    .find((row) => row.startsWith("spielos.org="))
    ?.split("=")[1] ?? null;

  useRealtimeSubscription(orgCookie ? `org:${orgCookie}` : null, orgCookie, (event: DomainEvent) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[REALTIME] event`, { type: event.type, runId: (event as Record<string, unknown>).runId });
    }

    // Runtime store events — run status changes
    if (event.type === "run.status.changed") {
      const store = useRuntimeStore.getState();
      const hasStream = store.hasActiveStream(event.runId);
      if (process.env.NODE_ENV !== "production") {
        console.log(`[REALTIME] run.status.changed`, { runId: event.runId, hasActiveStream: hasStream, activeRunId: store.activeRunId });
      }
      if (hasStream) return; // SSE is authority during active stream
      if (store.activeRunId === event.runId) {
        void store.restoreRun(event.runId, { force: true });
      }
      void store.reloadChats();
    }

    // Status message updates — carry the human-readable status text
    // ("Thinking...", "Generating...", "Running tools...") that SSE
    // status frames would normally deliver.  These are needed even
    // during an active SSE stream because the dev proxy may buffer
    // the SSE chunks, leaving the UI stuck on "Thinking...".
    if (event.type === "run.status.message") {
      const store = useRuntimeStore.getState();
      const msg = (event as Record<string, unknown>).message;
      if (typeof msg === "string" && store.activeRunId === event.runId) {
        store.setActivity(msg);
      }
    }

    // Dispatch to all registered listeners (domain store, etc.)
    dispatchToListeners(event);
  });

  return null;
}
