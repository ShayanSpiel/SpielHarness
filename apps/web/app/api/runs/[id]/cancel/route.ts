import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../../../lib/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const { id } = await params;
    const { data, error } = await supabase
      .from("runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", org.orgId)
      .select("id")
      .single();
    if (error || !data) throw new HttpError(404, "Run not found");
    await supabase.from("run_events").insert({
      org_id: org.orgId,
      run_id: id,
      event_type: "run_cancelled",
      message: "Run cancelled by user."
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
