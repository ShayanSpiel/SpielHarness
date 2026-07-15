import { appendRunEvents, getRun, updateRun } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";

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
    await updateRun(org.sql, org.orgId, id, {
      status: "waiting_human",
      state: {
        ...(existing.state ?? {}),
        status: "waiting_human",
        pause_requested_at: requestedAt,
        pause: { requested: true, reason: body.reason?.trim() || "Paused by user.", requestedAt }
      }
    });
    await appendRunEvents(org.sql, org.orgId, id, [{
      event_type: "status",
      node_id: null,
      node_title: null,
      skill_id: null,
      skill_name: null,
      message: "Run paused by user.",
      payload: { category: "pause", requestedAt }
    }]);
    return Response.json({ ok: true, status: "waiting_human" });
  } catch (error) {
    return errorResponse(error);
  }
}
