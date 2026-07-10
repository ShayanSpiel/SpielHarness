import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("runs")
      .select("*")
      .eq("org_id", org.orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return Response.json({ runs: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const body = (await request.json()) as {
      prompt?: string;
      workstreamId?: string | null;
      runType?: string;
      inputs?: Record<string, unknown>;
    };
    if (!body.prompt) throw new HttpError(400, "prompt is required");
    const { data, error } = await supabase
      .from("runs")
      .insert({
        org_id: org.orgId,
        workstream_id: null,
        run_type: body.runType ?? "custom",
        prompt: body.prompt,
        status: "draft",
        inputs: {
          ...(body.inputs ?? {}),
          ...(body.workstreamId ? { workstreamId: body.workstreamId } : {})
        }
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json({ run: data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
