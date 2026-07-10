import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("graph_templates")
      .select("*")
      .eq("org_id", org.orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ workstreams: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name) throw new HttpError(400, "name is required");
    const { data, error } = await supabase
      .from("graph_templates")
      .insert({
        org_id: org.orgId,
        name: body.name,
        run_type: body.runType ?? "custom",
        definition: body.definition ?? { nodes: [], edges: [] },
        editable: body.editable ?? true,
        current_version: 1,
        status: body.status ?? "active"
      })
      .select()
      .single();
    if (error) throw error;
    await supabase.from("graph_template_versions").insert({
      org_id: org.orgId,
      graph_template_id: data.id,
      version: 1,
      name: data.name,
      description: (body.description as string) ?? "",
      definition: data.definition
    });
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "create",
      p_entity_type: "graph_template",
      p_entity_id: data.id,
      p_before: null,
      p_after: data
    });
    return Response.json({ workstream: data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const body = (await request.json()) as { id: string } & Record<string, unknown>;
    if (!body.id) throw new HttpError(400, "id is required");
    const { data: before } = await supabase
      .from("graph_templates")
      .select("*")
      .eq("id", body.id)
      .single();

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.definition !== undefined) patch.definition = body.definition;
    if (body.runType !== undefined) patch.run_type = body.runType;
    if (body.status !== undefined) patch.status = body.status;

    if (body.definition !== undefined) {
      patch.current_version = ((before?.current_version as number) ?? 0) + 1;
    }

    const { data, error } = await supabase
      .from("graph_templates")
      .update(patch)
      .eq("id", body.id)
      .select()
      .single();
    if (error) throw error;

    if (body.definition !== undefined) {
      await supabase.from("graph_template_versions").insert({
        org_id: org.orgId,
        graph_template_id: data.id,
        version: data.current_version,
        name: data.name,
        description: (body.description as string) ?? "",
        definition: data.definition
      });
    }

    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "update",
      p_entity_type: "graph_template",
      p_entity_id: data.id,
      p_before: before,
      p_after: data
    });
    return Response.json({ workstream: data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const { data: before } = await supabase
      .from("graph_templates")
      .select("*")
      .eq("id", id)
      .single();
    const { data, error } = await supabase
      .from("graph_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "delete",
      p_entity_type: "graph_template",
      p_entity_id: id,
      p_before: before,
      p_after: data
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
