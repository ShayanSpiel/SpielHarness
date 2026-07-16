import { atomicCheckpoint, getRun } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";
import { signalRun } from "../../../../../lib/run-registry";
import { publishDomainEvent } from "../../../../../lib/realtime";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const { id } = await params;

    const existing = await getRun(org.sql, org.orgId, id);
    if (!existing) throw new HttpError(404, "Run not found");
    if (existing.status === "cancelled" || existing.status === "completed") {
      return Response.json({ ok: true, already: existing.status });
    }

    const requestedAt = new Date().toISOString();
    await atomicCheckpoint(org.sql, org.orgId, id, {
      status: "cancelled",
      completedAt: requestedAt,
      state: {
        ...(existing.state ?? {}),
        cancel_requested_at: requestedAt
      },
      events: [
        {
          event_type: "run_cancelled",
          node_id: null,
          node_title: null,
          skill_id: null,
          skill_name: null,
          message: "Run cancelled by user.",
          payload: { requestedAt }
        }
      ],
      expectedCheckpointVersion: Number(existing.checkpoint_version ?? 0)
    });

    // Phase 3: signal the in-process execute route (if any) so the
    // graph stops without waiting for the next checkpoint boundary.
    // The DB write above is the durable record; the abort is the
    // immediate signal. If no process holds the run (idle / crashed),
    // the cancel is still authoritative.
    signalRun(id, "cancel");

    // Phase 4: notify other tabs / dashboards. The status change is
    // the durable event; the realtime channel is a fanout convenience.
    publishDomainEvent(`run:${id}`, {
      type: "run.status.changed",
      orgId: org.orgId,
      runId: id,
      status: "cancelled",
      checkpointVersion: Number(existing.checkpoint_version ?? 0) + 1,
      ts: requestedAt
    });

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
