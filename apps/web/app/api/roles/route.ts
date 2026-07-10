import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .eq("org_id", org.orgId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ roles: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.name || !body.prompt) throw new HttpError(400, "name and prompt are required");
    const { data, error } = await supabase
      .from("roles")
      .insert({
        org_id: org.orgId,
        name: body.name,
        description: body.description ?? "",
        prompt: body.prompt,
        model_id: body.modelId ?? null,
        memory_policy: body.memoryPolicy ?? [],
        input_file_types: body.inputArtifactTypes ?? [],
        output_file_types: body.outputArtifactTypes ?? [],
        metadata: { skillIds: body.skillIds ?? [] },
        status: body.status ?? "active"
      })
      .select()
      .single();
    if (error) throw error;
    if (Array.isArray(body.skillIds)) {
      for (const skillId of body.skillIds) {
        await supabase
          .from("role_skills")
          .insert({ org_id: org.orgId, role_id: data.id, skill_id: skillId })
          .throwOnError();
      }
    }
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "create",
      p_entity_type: "role",
      p_entity_id: data.id,
      p_before: null,
      p_after: data
    });
    return Response.json({ role: data }, { status: 201 });
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
    const { data: before } = await supabase.from("roles").select("*").eq("id", body.id).single();

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.prompt !== undefined) patch.prompt = body.prompt;
    if (body.modelId !== undefined) patch.model_id = body.modelId;
    if (body.memoryPolicy !== undefined) patch.memory_policy = body.memoryPolicy;
    if (body.inputArtifactTypes !== undefined) patch.input_file_types = body.inputArtifactTypes;
    if (body.outputArtifactTypes !== undefined) patch.output_file_types = body.outputArtifactTypes;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase.from("roles").update(patch).eq("id", body.id).select().single();
    if (error) throw error;

    if (Array.isArray(body.skillIds)) {
      await supabase.from("role_skills").delete().eq("role_id", body.id);
      for (const skillId of body.skillIds) {
        await supabase
          .from("role_skills")
          .insert({ org_id: org.orgId, role_id: body.id, skill_id: skillId });
      }
      patch.metadata = { skillIds: body.skillIds };
    }

    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "update",
      p_entity_type: "role",
      p_entity_id: data.id,
      p_before: before,
      p_after: data
    });
    return Response.json({ role: data });
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
    const { data: before } = await supabase.from("roles").select("*").eq("id", id).single();
    const { data, error } = await supabase
      .from("roles")
      .update({ status: "archived" })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "archive",
      p_entity_type: "role",
      p_entity_id: id,
      p_before: before,
      p_after: data
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
