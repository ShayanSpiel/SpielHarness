import { errorResponse, getOrg, HttpError, requireOrgRole, requireSupabase } from "../../../../lib/server";

type ResetMode = "files" | "prompts" | "all" | "nuke";

const PROMPT_FILE_TYPES = [
  "prompt",
  "harness_role",
  "harness_skill",
  "harness_workstream",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
];

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const body = (await request.json().catch(() => ({}))) as { mode?: ResetMode; confirm?: string };
    const mode = (body.mode ?? "files") as ResetMode;
    if (body.confirm !== "RESET") {
      throw new HttpError(400, 'Pass { confirm: "RESET" } to confirm.');
    }

    if (mode === "files" || mode === "all" || mode === "nuke") {
      const { data: fileIds } = await supabase
        .from("files")
        .select("id")
        .eq("org_id", org.orgId);
      const ids = (fileIds ?? []).map((r) => r.id);
      if (ids.length) {
        await supabase.from("file_chunks").delete().in("file_id", ids);
        await supabase.from("file_versions").delete().in("file_id", ids);
        await supabase.from("file_lineage").delete().or(
          `child_file_id.in.(${ids.join(",")}),parent_file_id.in.(${ids.join(",")})`
        );
        await supabase.from("generated_files").delete().in("file_id", ids);
        await supabase.from("run_input_files").delete().in("file_id", ids);
        await supabase.from("chat_context_files").delete().in("file_id", ids);
        await supabase.from("files").delete().in("id", ids);
      }
    }
    if (mode === "prompts" || mode === "all" || mode === "nuke") {
      const { data: promptIds } = await supabase
        .from("files")
        .select("id")
        .eq("org_id", org.orgId)
        .in("file_type", PROMPT_FILE_TYPES);
      const ids = (promptIds ?? []).map((r) => r.id);
      if (ids.length) {
        await supabase.from("file_versions").delete().in("file_id", ids);
        await supabase.from("files").delete().in("id", ids);
      }
    }
    if (mode === "all" || mode === "nuke") {
      await supabase.from("run_events").delete().eq("org_id", org.orgId);
      await supabase.from("runs").delete().eq("org_id", org.orgId);
      await supabase.from("eval_reports").delete().eq("org_id", org.orgId);
      await supabase.from("role_skills").delete().eq("org_id", org.orgId);
      await supabase.from("role_tools").delete().eq("org_id", org.orgId);
      await supabase.from("tools").delete().eq("org_id", org.orgId);
      await supabase.from("graph_template_versions").delete().eq("org_id", org.orgId);
      await supabase.from("graph_templates").delete().eq("org_id", org.orgId);
      await supabase.from("chats").delete().eq("org_id", org.orgId);
      await supabase.from("models").delete().eq("org_id", org.orgId);
      await supabase.from("model_providers").delete().eq("org_id", org.orgId);
      await supabase.from("folders").delete().eq("org_id", org.orgId);
      await supabase.from("roles").delete().eq("org_id", org.orgId);
    }
    if (mode === "nuke") {
      // Leave the org itself in place; orgs is shared infra
    }
    return Response.json({ ok: true, mode });
  } catch (err) {
    return errorResponse(err);
  }
}
