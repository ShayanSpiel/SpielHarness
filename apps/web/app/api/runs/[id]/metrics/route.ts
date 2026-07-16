import { getRunMetrics, listRecentRunMetrics } from "@spielos/db";
import { errorResponse, getOrg, HttpError } from "../../../../../lib/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const url = new URL(request.url);
    const recent = url.searchParams.get("recent");

    if (recent) {
      const limit = Math.min(200, Math.max(1, Number(recent) || 50));
      const rows = await listRecentRunMetrics(org.sql, org.orgId, limit);
      return Response.json({ metrics: rows });
    }

    const metrics = await getRunMetrics(org.sql, org.orgId, id);
    if (!metrics) throw new HttpError(404, "Metrics not found for this run");
    return Response.json({ metrics });
  } catch (err) {
    return errorResponse(err);
  }
}
