import { errorResponse, getOrg, HttpError, requireOrgRole, requireSupabase } from "../../../lib/server";
import { loadIntegrationCatalog, type IntegrationOperation as Operation, type IntegrationPreset } from "../../../lib/integration-catalog";


function clientConnection(row: Record<string, unknown>) {
  const secretEnvKey = typeof row.secret_env_key === "string" ? row.secret_env_key : null;
  const secretReady = !secretEnvKey || Boolean(process.env[secretEnvKey]);
  const config = (row.config as Record<string, unknown> | null) ?? {};
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.enabled === false ? "disabled" : secretReady ? row.status : "needs_secret",
    baseUrl: row.base_url,
    secretEnvKey,
    secretConfigured: secretEnvKey ? secretReady : null,
    operations: (row.operations as Operation[] | null) ?? [],
    logo: typeof config.logo === "string" ? config.logo : null,
    account: typeof config.account === "string" ? config.account : null,
    enabled: row.enabled !== false
  };
}

export async function GET() {
  const rawCatalog = await loadIntegrationCatalog().catch(() => [] as IntegrationPreset[]);
  const catalog = rawCatalog.map((preset) => ({
    ...preset,
    oauthReady: preset.kind !== "oauth" || (preset.id === "notion"
      ? Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET)
      : Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET))
  }));
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase.from("connections").select("*")
      .eq("org_id", org.orgId).is("deleted_at", null).order("name");
    if (error) {
      return Response.json({ integrations: [], presets: catalog, setupRequired: true });
    }
    return Response.json({ integrations: (data ?? []).map(clientConnection), presets: catalog });
  } catch {
    return Response.json({ integrations: [], presets: catalog, setupRequired: true });
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = await request.json() as Record<string, unknown>;
    const preset = typeof body.presetId === "string" ? (await loadIntegrationCatalog()).find((item) => item.id === body.presetId) : undefined;
    const name = body.name ?? preset?.name;
    if (!name) throw new HttpError(400, "name is required");
    const { data, error } = await supabase.from("connections").insert({
      org_id: org.orgId,
      name,
      kind: body.kind ?? preset?.kind ?? "api",
      base_url: body.baseUrl || preset?.baseUrl || null,
      secret_env_key: body.secretEnvKey || preset?.secretEnvKey || null,
      config: preset ? { presetId: preset.id, icon: preset.icon, logo: preset.logo, description: preset.description } : {},
      operations: body.operations ?? preset?.operations ?? [],
      status: body.status ?? (preset?.kind === "oauth" ? "needs_secret" : "configured"),
      enabled: body.enabled ?? true
    }).select().single();
    if (error) throw error;
    return Response.json({ integration: clientConnection(data) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = await request.json() as Record<string, unknown>;
    if (!body.id) throw new HttpError(400, "id is required");
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.baseUrl !== undefined) patch.base_url = body.baseUrl || null;
    if (body.secretEnvKey !== undefined) patch.secret_env_key = body.secretEnvKey || null;
    if (body.operations !== undefined) patch.operations = body.operations;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    const { data, error } = await supabase.from("connections").update(patch)
      .eq("id", body.id).eq("org_id", org.orgId).select().single();
    if (error) throw error;
    return Response.json({ integration: clientConnection(data) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const { error } = await supabase.from("connections").update({ deleted_at: new Date().toISOString() })
      .eq("id", id).eq("org_id", org.orgId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
