import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("tools")
      .select("*")
      .eq("org_id", org.orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ skills: data ?? [] });
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
      .from("tools")
      .insert({
        org_id: org.orgId,
        name: body.name,
        description: body.description ?? "",
        input_schema: body.inputSchema ?? {},
        output_schema: body.outputSchema ?? {},
        side_effect: body.sideEffect ?? "none",
        provider_config: body.providerConfig ?? {
          kind: body.kind ?? "llm_call",
          slug: body.slug,
          implementation: body.implementation ?? "",
          humanQuestions: body.humanQuestions ?? [],
          evalRubrics: body.evalRubrics ?? [],
          overallThreshold: body.overallThreshold
        },
        enabled: body.enabled ?? true
      })
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "create",
      p_entity_type: "skill",
      p_entity_id: data.id,
      p_before: null,
      p_after: data
    });
    return Response.json({ skill: data }, { status: 201 });
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
    const { data: before } = await supabase.from("tools").select("*").eq("id", body.id).single();

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.inputSchema !== undefined) patch.input_schema = body.inputSchema;
    if (body.outputSchema !== undefined) patch.output_schema = body.outputSchema;
    if (body.sideEffect !== undefined) patch.side_effect = body.sideEffect;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.kind !== undefined || body.implementation !== undefined || body.humanQuestions !== undefined || body.evalRubrics !== undefined) {
      const prev = (before?.provider_config ?? {}) as Record<string, unknown>;
      patch.provider_config = {
        ...prev,
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.implementation !== undefined ? { implementation: body.implementation } : {}),
        ...(body.humanQuestions !== undefined ? { humanQuestions: body.humanQuestions } : {}),
        ...(body.evalRubrics !== undefined ? { evalRubrics: body.evalRubrics } : {}),
        ...(body.overallThreshold !== undefined ? { overallThreshold: body.overallThreshold } : {})
      };
    }

    const { data, error } = await supabase.from("tools").update(patch).eq("id", body.id).select().single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "update",
      p_entity_type: "skill",
      p_entity_id: data.id,
      p_before: before,
      p_after: data
    });
    return Response.json({ skill: data });
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
    const { data: before } = await supabase.from("tools").select("*").eq("id", id).single();
    const { data, error } = await supabase
      .from("tools")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "delete",
      p_entity_type: "skill",
      p_entity_id: id,
      p_before: before,
      p_after: data
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
