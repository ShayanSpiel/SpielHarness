import { getFilesByIds, listRunOutputFileIds } from "@spielos/db";
import { errorResponse, getOrg } from "../../../../../lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const ids = await listRunOutputFileIds(org.sql, org.orgId, id);
    if (ids.length === 0) return Response.json({ artifacts: [] });
    const files = await getFilesByIds(org.sql, org.orgId, ids);
    return Response.json({
      artifacts: files.map((f) => ({
        id: f.id,
        orgId: f.org_id,
        type: f.file_type,
        title: f.title,
        body: f.body,
        metadata: f.metadata ?? {}
      }))
    });
  } catch (err) {
    return errorResponse(err);
  }
}
