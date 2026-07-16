import { atomicCheckpoint, getRun } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";
import { signalRun } from "../../../../../lib/run-registry";
import { publishDomainEvent } from "../../../../../lib/realtime";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const { id } = await params;
    const existing = await getRun(org.sql, org.orgId, id);
    if (!existing) throw new HttpError(404, "Run not found");
    if (existing.status !== "running") throw new HttpError(409, "Only a running run can be paused");
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const requestedAt = new Date().toISOString();
    await atomicCheckpoint(org.sql, org.orgId, id, {
      status: "waiting_human",
      state: {
        ...(existing.state ?? {}),
        status: "waiting_human",
        pause_requested_at: requestedAt,
        pause: { requested: true, reason: body.reason?.trim() || "Paused by user.", requestedAt }
      },
      events: [{
        event_type: "status",
        node_id: null,
        node_title: null,
        skill_id: null,
        skill_name: null,
        message: "Run paused by user.",
        payload: { category: "pause", requestedAt }
      }],
      expectedCheckpointVersion: Number(existing.checkpoint_version ?? 0)
    });
    // Phase 3: signal the in-process execute route. The graph stops at
    // the next node boundary and yields a `waiting_human` checkpoint.
    signalRun(id, "pause");
    publishDomainEvent(`run:${id}`, {
      type: "run.status.changed",
      orgId: org.orgId,
      runId: id,
      status: "waiting_human",
      checkpointVersion: Number(existing.checkpoint_version ?? 0) + 1,
      ts: requestedAt
    });
    return Response.json({ ok: true, status: "waiting_human" });
  } catch (error) {
    return errorResponse(error);
  }
}
