import { errorResponse, getOrg, requireSupabase } from "../../../../../lib/server";

type FileRow = {
  id: string;
  org_id: string;
  file_type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { id } = await params;

    const { data: links, error: linkError } = await supabase
      .from("generated_files")
      .select("file_id")
      .eq("org_id", org.orgId)
      .eq("run_id", id)
      .eq("relationship", "output");
    if (linkError) throw linkError;

    const fileIds = (links ?? []).map((row: { file_id: string }) => row.file_id);
    if (fileIds.length === 0) return Response.json({ artifacts: [] });

    const { data, error } = await supabase
      .from("files")
      .select("id, org_id, file_type, title, body, metadata")
      .eq("org_id", org.orgId)
      .in("id", fileIds);
    if (error) throw error;

    return Response.json({
      artifacts: ((data ?? []) as FileRow[]).map((file) => ({
        id: file.id,
        orgId: file.org_id,
        runId: id,
        type: file.file_type,
        title: file.title,
        body: file.body,
        parentArtifactIds: [],
        metadata: file.metadata ?? {}
      }))
    });
  } catch (err) {
    return errorResponse(err);
  }
}
