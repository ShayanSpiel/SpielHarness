import { listRunEvents } from "@spielos/db";
import { errorResponse, getOrg } from "../../../../../lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const events = await listRunEvents(org.sql, org.orgId, id);
    return Response.json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
