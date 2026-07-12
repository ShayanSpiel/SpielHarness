import { errorResponse, getOrg, HttpError, requireOrgRole, requireSupabase } from "../../../lib/server";

function toClient(row: Record<string, unknown>) {
  const secret = row.kind === "secret_ref";
  const envKey = secret && typeof row.value === "string" ? row.value : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    value: secret ? null : row.value,
    envKey,
    configured: secret ? Boolean(envKey && process.env[envKey]) : true,
    description: row.description,
    enabled: row.enabled
  };
}

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase.from("workspace_variables").select("*").eq("org_id", org.orgId).order("name");
    if (error) throw error;
    return Response.json({ variables: (data ?? []).map(toClient) });
  } catch (err) { return errorResponse(err); }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = await request.json() as Record<string, unknown>;
    if (!body.name) throw new HttpError(400, "name is required");
    const value = body.kind === "secret_ref" ? body.envKey : body.value;
    const { data, error } = await supabase.from("workspace_variables").insert({ org_id: org.orgId, name: body.name, kind: body.kind ?? "variable", value: value ?? null, description: body.description ?? "", enabled: body.enabled ?? true }).select().single();
    if (error) throw error;
    return Response.json({ variable: toClient(data) }, { status: 201 });
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const { error } = await supabase.from("workspace_variables").delete().eq("id", id).eq("org_id", org.orgId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (err) { return errorResponse(err); }
}
