import { errorResponse, getOrg, requireSupabase } from "../../../../../lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { id } = await params;
    const { data, error } = await supabase
      .from("run_events")
      .select("*")
      .eq("run_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return Response.json({ events: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
