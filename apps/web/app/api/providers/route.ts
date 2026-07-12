import { errorResponse, getOrg, HttpError, requireOrgRole, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data: providers, error: providerErr } = await supabase
      .from("model_providers")
      .select("*")
      .eq("org_id", org.orgId)
      .eq("enabled", true)
      .order("name", { ascending: true });
    if (providerErr) throw providerErr;
    const { data: models, error: modelErr } = await supabase
      .from("models")
      .select("*")
      .eq("org_id", org.orgId)
      .eq("enabled", true)
      .order("label", { ascending: true });
    if (modelErr) throw modelErr;
    return Response.json({ providers: providers ?? [], models: models ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name || !body.kind) throw new HttpError(400, "name and kind are required");
    const { data, error } = await supabase
      .from("model_providers")
      .insert({
        org_id: org.orgId,
        name: body.name,
        base_url: body.baseUrl ?? null,
        secret_ref: body.secretRef ?? null,
        metadata: { ...((body.metadata as Record<string, unknown> | undefined) ?? {}), kind: body.kind },
        enabled: body.enabled ?? true
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json({ provider: data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    await supabase.from("models").delete().eq("provider_id", id).eq("org_id", org.orgId);
    const { error } = await supabase.from("model_providers").delete().eq("id", id).eq("org_id", org.orgId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
