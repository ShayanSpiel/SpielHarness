import type { Artifact } from "@spielos/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { artifactTypeToFileType } from "./execution-service";

const WRITABLE_TYPES = new Set(["knowledge", "strategy", "prompt", "artifact", "draft", "evidence", "asset", "publish_package"]);

export async function persistRunArtifact(supabase: SupabaseClient, orgId: string, runId: string, artifact: Artifact, selectedContext: unknown) {
  const action = typeof artifact.metadata?.workspaceAction === "string" ? artifact.metadata.workspaceAction : null;
  const folderName = typeof artifact.metadata?.folderName === "string" ? artifact.metadata.folderName.trim() : "";
  let folderId: string | null = null;
  if (folderName) {
    const { data: existing } = await supabase.from("folders").select("id").eq("org_id", orgId).eq("name", folderName).is("deleted_at", null).limit(1).maybeSingle();
    if (existing?.id) folderId = existing.id;
    else {
      const { data: created, error } = await supabase.from("folders").insert({ org_id: orgId, name: folderName, sort_order: 100 }).select("id").single();
      if (error) throw error;
      folderId = created.id;
    }
  }
  if (action === "create_folder") return { fileId: null, folderId };
  const requestedType = typeof artifact.metadata?.fileType === "string" ? artifact.metadata.fileType : artifactTypeToFileType(artifact.type);
  const fileType = WRITABLE_TYPES.has(requestedType) ? requestedType : "draft";
  if (action === "update") {
    const fileId = typeof artifact.metadata?.fileId === "string" ? artifact.metadata.fileId : null;
    if (!fileId) throw new Error("Workspace update is missing fileId.");
    const patch: Record<string, unknown> = { title: artifact.title, body: artifact.body, file_type: fileType, metadata: { ...artifact.metadata, sourceRunId: runId, selectedContext } };
    if (folderId) patch.folder_id = folderId;
    const { data, error } = await supabase.from("files").update(patch).eq("id", fileId).eq("org_id", orgId).neq("status", "deleted").select("id").single();
    if (error) throw error;
    return { fileId: data.id as string, folderId };
  }
  const { data, error } = await supabase.from("files").insert({ org_id: orgId, file_type: fileType, folder_id: folderId, title: artifact.title, body: artifact.body, metadata: { ...artifact.metadata, artifactType: artifact.type, sourceRunId: runId, selectedContext }, status: "active" }).select("id").single();
  if (error) throw error;
  return { fileId: data.id as string, folderId };
}
