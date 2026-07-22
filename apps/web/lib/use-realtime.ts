"use client";

import { useEffect, useRef } from "react";
import type { DomainEvent, Topic } from "./realtime";

// Phase 4: client-side subscriber. Opens a streaming `fetch` to
// `/api/realtime?topic=...` and invokes the listener for every event
// the relay forwards. Uses `fetch` + ReadableStream instead of
// `EventSource` so we can stop on permanent errors (4xx) — EventSource
// reconnects blindly on any close and turns a 401 into a request
// storm. On transient failures we reconnect with exponential backoff
// capped at 30s. The relay emits a `context.invalidated` greeting on
// connect, which the store uses as a "data is fresh" signal.

export function useRealtimeSubscription(
  topic: Topic | null,
  orgId: string | null,
  listener: (event: DomainEvent) => void
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => {
    if (!topic || !orgId || typeof window === "undefined") return;
    let closed = false;
    let backoffMs = 1000;
    let controller: AbortController | null = null;

    const open = async () => {
      if (closed) return;
      controller = new AbortController();
      try {
        const res = await fetch(`/api/realtime?topic=${encodeURIComponent(topic)}`, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
          credentials: "same-origin"
        });
        if (!res.ok) {
          // 4xx is permanent: the relay rejected this topic. Stop.
          if (res.status >= 400 && res.status < 500) {
            closed = true;
            controller?.abort();
            return;
          }
          // 5xx and network errors are transient: back off and retry.
          if (!closed) {
            setTimeout(open, backoffMs);
            backoffMs = Math.min(backoffMs * 2, 30_000);
          }
          return;
        }
        if (!res.body) {
          if (!closed) setTimeout(open, backoffMs);
          return;
        }
        // Success — reset the backoff for the next failure.
        backoffMs = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            const dataLine = frame
              .split("\n")
              .find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            if (!payload) continue;
            try {
              const event = JSON.parse(payload) as DomainEvent;
              if (event.orgId !== orgId) continue;
              listenerRef.current(event);
            } catch {
              /* malformed frame, skip */
            }
          }
        }
        // Stream ended without `done`. Treat as transient unless the
        // tab is closing; reconnect with backoff.
        if (!closed) {
          setTimeout(open, backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      } catch (err) {
        if (closed) return;
        // AbortError is the expected close path; do not reconnect.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTimeout(open, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    };
    void open();
    return () => {
      closed = true;
      controller?.abort();
    };
  }, [topic, orgId]);
}
