import { getRunRestoreSnapshot } from "@spielos/db";
import { normalizeBudget } from "@spielos/core";
import { errorResponse, getOrg, HttpError } from "../../../../lib/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const snapshot = await getRunRestoreSnapshot(org.sql, org.orgId, id);
    if (!snapshot) throw new HttpError(404, "Run not found");
    const { run, chat, messages, events, artifacts, usage } = snapshot;
    const sinceParam = new URL(request.url).searchParams.get("since");
    const since = sinceParam === null ? Number.NaN : Number(sinceParam);
    const checkpointVersion = Number(run.checkpoint_version ?? 0);
    if (Number.isFinite(since) && since >= checkpointVersion) {
      return new Response(null, { status: 304 });
    }
    const budget = normalizeBudget(run.state?.budget);
    return Response.json({ checkpointVersion, run, chat, messages, events, usage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      toolCalls: budget.toolCalls,
      contextInputTokens: budget.contextInputTokens,
      contextOutputTokens: budget.contextOutputTokens,
      totalInputTokens: usage.input_tokens || budget.totalInputTokens,
      totalOutputTokens: usage.output_tokens || budget.totalOutputTokens,
      contextModelId: budget.contextModelId,
    }, artifacts: artifacts.map((file) => ({
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
