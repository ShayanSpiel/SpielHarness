import { errorResponse, getOrg, requireSupabase } from "../../../../../lib/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { id } = await params;
    await supabase
      .from("runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id);
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
