import { getRun, listRunEvents } from "@spielos/db";
import { errorResponse, getOrg } from "../../../../../lib/server";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;

    const run = await getRun(org.sql, org.orgId, id);
    if (!run) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let lastId: string | undefined;

        // Send existing events immediately
        const existing = await listRunEvents(org.sql, org.orgId, id);
        for (const event of existing) {
          controller.enqueue(encoder.encode(frame({
            kind: "event",
            event: {
              id: event.id,
              type: event.event_type,
              nodeId: event.node_id,
              nodeTitle: event.node_title,
              skillId: event.skill_id,
              skillName: event.skill_name,
              message: event.message,
              payload: event.payload,
              createdAt: event.created_at
            }
          })));
          lastId = event.id;
        }

        // Poll for new events until run is terminal
        const terminal = new Set(["completed", "failed", "cancelled"]);
        const poll = async () => {
          if (terminal.has(run.status)) {
            controller.close();
            return;
          }
          const refreshed = await getRun(org.sql, org.orgId, id);
          if (terminal.has(refreshed?.status ?? "")) {
            controller.enqueue(encoder.encode(frame({ kind: "done", runId: id, status: refreshed!.status })));
            controller.close();
            return;
          }
          const events = await listRunEvents(org.sql, org.orgId, id, lastId);
          for (const event of events) {
            controller.enqueue(encoder.encode(frame({
              kind: "event",
              event: {
                id: event.id,
                type: event.event_type,
                nodeId: event.node_id,
                nodeTitle: event.node_title,
                skillId: event.skill_id,
                skillName: event.skill_name,
                message: event.message,
                payload: event.payload,
                createdAt: event.created_at
              }
            })));
            lastId = event.id;
          }
          setTimeout(poll, 1000);
        };
        setTimeout(poll, 1000);
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
