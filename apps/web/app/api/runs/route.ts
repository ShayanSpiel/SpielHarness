import { listRuns } from "@spielos/db";
import { errorResponse, getOrg } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const runs = await listRuns(org.sql, org.orgId);
    return Response.json({ runs });
  } catch (err) {
    return errorResponse(err);
  }
}
