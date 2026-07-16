// Phase 4: Realtime domain events.
//
// Server-side pub/sub with an SSE relay. The transport is in-process
// (Node `EventEmitter`) for MVP because we run a single Node instance.
// The `RealtimeTransport` interface lets us swap in Supabase Realtime
// private channels later without touching the publisher or subscriber.
//
// The relay is the only thing the browser talks to; the service role
// never reaches the client. The relay enforces the topic → org boundary:
// a `run:<id>` topic is only opened for runs the requester's session
// owns (validated against the in-memory active set + the run row).

import { EventEmitter } from "node:events";

export type DomainEvent =
  | { type: "run.status.changed"; orgId: string; runId: string; status: string; checkpointVersion: number; ts: string }
  | { type: "run.output.updated"; orgId: string; runId: string; text: string; ts: string }
  | { type: "run.usage.updated"; orgId: string; runId: string; inputTokens: number; outputTokens: number; toolCalls: number; ts: string }
  | { type: "run.event.appended"; orgId: string; runId: string; eventId: string; eventType: string; ts: string }
  | { type: "file.created"; orgId: string; fileId: string; fileType: string; title: string; ts: string }
  | { type: "file.updated"; orgId: string; fileId: string; fileType: string; title: string; ts: string }
  | { type: "file.deleted"; orgId: string; fileId: string; ts: string }
  | { type: "context.invalidated"; orgId: string; reason: string; ts: string };

export type Topic = `org:${string}` | `run:${string}`;

export interface RealtimeTransport {
  publish(topic: Topic, event: DomainEvent): void;
  subscribe(topic: Topic, listener: (event: DomainEvent) => void): () => void;
}

// In-process transport. Topic strings are matched with an exact match
// plus a wildcard `org:*` subscriber that also receives every event for
// that org (so a client can subscribe to the org once and see every
// run).
class InProcessTransport implements RealtimeTransport {
  private readonly emitter = new EventEmitter();
  constructor() {
    // Reasonable ceiling for the per-process fanout. A single org on
    // MVP will never exceed this; bump it if needed.
    this.emitter.setMaxListeners(0);
  }
  publish(topic: Topic, event: DomainEvent): void {
    this.emitter.emit(topic, event);
    // Fan run events to the org topic so subscribers see all runs in
    // one place. The `run:` topic is the run-scoped channel.
    if (topic.startsWith("run:")) {
      this.emitter.emit(`org:${event.orgId}`, event);
    }
  }
  subscribe(topic: Topic, listener: (event: DomainEvent) => void): () => void {
    this.emitter.on(topic, listener);
    return () => this.emitter.off(topic, listener);
  }
}

const g = globalThis as unknown as { __spielosRealtime?: RealtimeTransport };

function getTransport(): RealtimeTransport {
  if (!g.__spielosRealtime) g.__spielosRealtime = new InProcessTransport();
  return g.__spielosRealtime;
}

export function publishDomainEvent(topic: Topic, event: DomainEvent): void {
  try {
    getTransport().publish(topic, event);
  } catch (err) {
    // Realtime is best-effort. The durable write has already happened.
    console.warn("[realtime] publish failed:", err instanceof Error ? err.message : err);
  }
}

export function subscribeDomainEvent(
  topic: Topic,
  listener: (event: DomainEvent) => void
): () => void {
  return getTransport().subscribe(topic, listener);
}

export function frame(data: DomainEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
