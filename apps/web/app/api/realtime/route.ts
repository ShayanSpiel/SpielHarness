import { getRun } from "@spielos/db";
import { errorResponse, getOrg, HttpError } from "../../../lib/server";
import { subscribeDomainEvent, type DomainEvent, type Topic } from "../../../lib/realtime";

function sseFrame(data: DomainEvent): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const KEEPALIVE_INTERVAL_MS = 25_000;

export async function GET(request: Request) {
  try {
    const org = await getOrg();
    const url = new URL(request.url);
    const topicParam = url.searchParams.get("topic");
    if (!topicParam) throw new HttpError(400, "topic is required");
    if (!/^(org:[^:]+|run:[^:]+)$/.test(topicParam)) {
      throw new HttpError(400, "topic must be `org:<id>` or `run:<id>`.");
    }
    const topic = topicParam as Topic;
    const [scope, id] = topic.split(":", 2) as ["org" | "run", string];
    if (scope === "run") {
      // Cross-tenant guard: a session for org A cannot subscribe to a
      // run owned by org B. The relay refuses to open the channel.
      const run = await getRun(org.sql, org.orgId, id);
      if (!run) throw new HttpError(404, "Run not found in this workspace.");
    } else if (id !== org.orgId) {
      throw new HttpError(403, "Cannot subscribe to another workspace's events.");
    }

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`retry: 5000\n\n`));
        controller.enqueue(encoder.encode(sseFrame({
          type: "context.invalidated",
          orgId: org.orgId,
          reason: "realtime-connected",
          ts: new Date().toISOString()
        })));
        unsubscribe = subscribeDomainEvent(topic, (event: DomainEvent) => {
          // Defense in depth: the relay filters out events that don't
          // belong to the requesting org, even if the topic shape
          // matches. The transport is in-process today but the
          // contract should not assume trust.
          if (event.orgId !== org.orgId) return;
          try { controller.enqueue(encoder.encode(sseFrame(event))); }
          catch { /* client disconnected */ }
        });
        keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
          catch { /* client disconnected */ }
        }, KEEPALIVE_INTERVAL_MS);
      },
      cancel() {
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (err) {
    return errorResponse(err);
  }
}
