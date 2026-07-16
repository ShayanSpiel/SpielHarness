// In-process registry of running execute routes. Lets the cancel/pause
// routes (which arrive on a different request) signal the original
// request's AbortController. Scoped to the Node process; multi-worker
// deployments will need a Redis-backed pub/sub (see Phase 5).

type Listener = (reason: "cancel" | "pause" | "client_disconnect") => void;

type Entry = {
  controller: AbortController;
  listeners: Set<Listener>;
};

const g = globalThis as unknown as { __spielosRunRegistry?: Map<string, Entry> };

function getRegistry(): Map<string, Entry> {
  if (!g.__spielosRunRegistry) g.__spielosRunRegistry = new Map();
  return g.__spielosRunRegistry;
}

export function registerRun(runId: string, controller: AbortController): () => void {
  const registry = getRegistry();
  const entry: Entry = { controller, listeners: new Set() };
  registry.set(runId, entry);
  return () => {
    const current = registry.get(runId);
    if (current === entry) registry.delete(runId);
  };
}

export function signalRun(
  runId: string,
  reason: "cancel" | "pause" | "client_disconnect"
): boolean {
  const registry = getRegistry();
  const entry = registry.get(runId);
  if (!entry) return false;
  for (const listener of entry.listeners) {
    try { listener(reason); } catch { /* ignore */ }
  }
  if (reason === "cancel" || reason === "client_disconnect") {
    entry.controller.abort(reason);
  }
  return true;
}

export function onRunSignal(runId: string, listener: Listener): () => void {
  const registry = getRegistry();
  const entry = registry.get(runId);
  if (!entry) return () => undefined;
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function isRunActive(runId: string): boolean {
  return getRegistry().has(runId);
}
