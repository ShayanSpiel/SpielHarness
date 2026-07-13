import { appendRunEvents, getRun, updateRun } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const { id } = await params;

    const existing = await getRun(org.sql, org.orgId, id);
    if (!existing) throw new HttpError(404, "Run not found");

    await updateRun(org.sql, org.orgId, id, {
      status: "cancelled",
      completedAt: new Date().toISOString()
    });

    await appendRunEvents(org.sql, org.orgId, id, [
      {
        event_type: "run_cancelled",
        node_id: null,
        node_title: null,
        skill_id: null,
        skill_name: null,
        message: "Run cancelled by user.",
        payload: {}
      }
    ]);

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
