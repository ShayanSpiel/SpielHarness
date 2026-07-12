import { errorResponse, getOrg, HttpError, requireOrgRole, requireSupabase } from "../../../lib/server";

function clientModel(row: Record<string, unknown> & { model_providers?: Record<string, unknown> | Record<string, unknown>[] }) {
  const provider = Array.isArray(row.model_providers) ? row.model_providers[0] : row.model_providers;
  return {
    id: row.id,
    provider: provider?.name ?? "Provider",
    label: row.label,
    model: row.model,
    baseUrl: provider?.base_url ?? "",
    enabled: row.enabled !== false
  };
}

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase.from("models")
      .select("id, label, model, config, enabled, provider_id, model_providers(id, name, base_url, metadata)")
      .eq("org_id", org.orgId)
      .order("label");
    if (error) throw error;
    return Response.json({ models: (data ?? []).map((row) => clientModel(row as never)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = await request.json() as { id?: string; provider?: string; label?: string; model?: string; baseUrl?: string; enabled?: boolean };
    if (!body.provider?.trim() || !body.label?.trim() || !body.model?.trim()) throw new HttpError(400, "provider, label, and model are required");
    let { data: provider } = await supabase.from("model_providers").select("id").eq("org_id", org.orgId).eq("name", body.provider.trim()).maybeSingle();
    if (!provider) {
      const { data, error } = await supabase.from("model_providers").insert({
        org_id: org.orgId,
        name: body.provider.trim(),
        base_url: body.baseUrl?.trim() || null,
        metadata: { kind: body.provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
        enabled: true
      }).select("id").single();
      if (error) throw error;
      provider = data;
    }
    const { data, error } = await supabase.from("models").insert({
      ...(body.id ? { id: body.id } : {}), org_id: org.orgId, provider_id: provider.id,
      label: body.label.trim(), model: body.model.trim(), enabled: body.enabled ?? true
    }).select("id, label, model, config, enabled, provider_id, model_providers(id, name, base_url, metadata)").single();
    if (error) throw error;
    return Response.json({ model: clientModel(data as never) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = await request.json() as { id?: string; label?: string; model?: string; enabled?: boolean };
    if (!body.id) throw new HttpError(400, "id is required");
    const patch: Record<string, unknown> = {};
    if (body.label !== undefined) patch.label = body.label.trim();
    if (body.model !== undefined) patch.model = body.model.trim();
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    const { data, error } = await supabase.from("models").update(patch)
      .eq("id", body.id).eq("org_id", org.orgId)
      .select("id, label, model, config, enabled, provider_id, model_providers(id, name, base_url, metadata)").single();
    if (error) throw error;
    return Response.json({ model: clientModel(data as never) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const { error } = await supabase.from("models").delete().eq("id", id).eq("org_id", org.orgId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
