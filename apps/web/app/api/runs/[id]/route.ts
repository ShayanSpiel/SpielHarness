import { getRun, getRunUsageTotals, listRunEvents, listRunOutputFileIds, getFilesByIds } from "@spielos/db";
import { errorResponse, getOrg, HttpError } from "../../../../lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const run = await getRun(org.sql, org.orgId, id);
    if (!run) throw new HttpError(404, "Run not found");
    const [events, outputIds, usage] = await Promise.all([
      listRunEvents(org.sql, org.orgId, id),
      listRunOutputFileIds(org.sql, org.orgId, id),
      getRunUsageTotals(org.sql, org.orgId, id)
    ]);
    const files = outputIds.length ? await getFilesByIds(org.sql, org.orgId, outputIds) : [];
    return Response.json({ run, events, usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      toolCalls: Number((run.state?.budget as Record<string, unknown> | undefined)?.toolCalls ?? 0)
    }, artifacts: files.map((file) => ({
      id: file.id,
      orgId: file.org_id,
      runId: id,
      type: file.file_type,
      title: file.title,
      body: file.body,
      metadata: file.metadata ?? {}
    })) });
  } catch (error) {
    return errorResponse(error);
  }
}
