import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../../lib/server";

type FileType =
  | "knowledge"
  | "strategy"
  | "prompt"
  | "artifact"
  | "draft"
  | "evidence"
  | "asset"
  | "eval_report"
  | "publish_package"
  | "harness_role"
  | "harness_skill"
  | "harness_workstream"
  | "harness_eval"
  | "harness_template"
  | "harness_chat_message";

type FileStatus = "draft" | "active" | "archived" | "deleted";

const HARNESS_FILE_TYPES: FileType[] = [
  "knowledge",
  "strategy",
  "prompt",
  "artifact",
  "draft",
  "evidence",
  "asset",
  "eval_report",
  "publish_package",
  "harness_role",
  "harness_skill",
  "harness_workstream",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
];

const HARNESS_KINDS = HARNESS_FILE_TYPES as string[];
const FILE_STATUSES = new Set<FileStatus>(["draft", "active", "archived", "deleted"]);

type FileRow = {
  id: string;
  org_id: string;
  folder_id: string | null;
  file_type: FileType;
  status: FileStatus;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function toClientFile(row: FileRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    folderId: row.folder_id,
    fileType: row.file_type,
    status: row.status,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("files")
      .select("id, org_id, folder_id, file_type, status, title, body, metadata, created_at, updated_at")
      .eq("org_id", org.orgId)
      .in("file_type", HARNESS_KINDS)
      .neq("status", "deleted")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ files: ((data ?? []) as FileRow[]).map(toClientFile) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as {
      id?: string;
      title: string;
      body?: string;
      fileType: string;
      status?: string;
      folderId?: string | null;
      metadata?: Record<string, unknown>;
    };
    if (!body.title?.trim()) throw new HttpError(400, "title is required");
    if (!HARNESS_KINDS.includes(body.fileType)) throw new HttpError(400, "invalid fileType");
    if (body.status && !FILE_STATUSES.has(body.status as FileStatus)) throw new HttpError(400, "invalid status");
    if (body.folderId) {
      const { data: folder } = await supabase.from("folders").select("id").eq("id", body.folderId).eq("org_id", org.orgId).single();
      if (!folder) throw new HttpError(400, "folder does not belong to this workspace");
    }
    const insert: Record<string, unknown> = {
      org_id: org.orgId,
      title: body.title.trim(),
      body: body.body ?? "",
      file_type: body.fileType as FileType,
      status: (body.status as FileStatus) ?? "draft",
      folder_id: body.folderId ?? null,
      metadata: body.metadata ?? {},
      content_format: "markdown"
    };
    if (body.id) insert.id = body.id;
    const { data, error } = await supabase
      .from("files")
      .insert(insert)
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "create",
      p_entity_type: "file",
      p_entity_id: data.id,
      p_before: null,
      p_after: data
    });
    return Response.json({ file: toClientFile(data as FileRow) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as {
      id: string;
      title?: string;
      body?: string;
      fileType?: string;
      status?: string;
      folderId?: string | null;
      metadata?: Record<string, unknown>;
    };
    if (!body.id) throw new HttpError(400, "id is required");
    if (body.fileType !== undefined && !HARNESS_KINDS.includes(body.fileType)) throw new HttpError(400, "invalid fileType");
    if (body.status !== undefined && !FILE_STATUSES.has(body.status as FileStatus)) throw new HttpError(400, "invalid status");
    if (body.folderId) {
      const { data: folder } = await supabase.from("folders").select("id").eq("id", body.folderId).eq("org_id", org.orgId).single();
      if (!folder) throw new HttpError(400, "folder does not belong to this workspace");
    }

    const { data: before } = await supabase
      .from("files")
      .select("*")
      .eq("id", body.id)
      .eq("org_id", org.orgId)
      .single();

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.body !== undefined) patch.body = body.body;
    if (body.fileType !== undefined) patch.file_type = body.fileType;
    if (body.status !== undefined) patch.status = body.status;
    if (body.folderId !== undefined) patch.folder_id = body.folderId;
    if (body.metadata !== undefined) patch.metadata = body.metadata;

    const { data, error } = await supabase
      .from("files")
      .update(patch)
      .eq("id", body.id)
      .eq("org_id", org.orgId)
      .select()
      .single();
    if (error) throw error;

    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "update",
      p_entity_type: "file",
      p_entity_id: data.id,
      p_before: before,
      p_after: data
    });
    return Response.json({ file: toClientFile(data as FileRow) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const { data: references, error: referenceError } = await supabase
      .from("file_relations")
      .select("source_file_id")
      .eq("org_id", org.orgId)
      .eq("target_file_id", id)
      .limit(1);
    if (referenceError) throw referenceError;
    if (references?.length) throw new HttpError(409, "This object is still referenced by another active harness object.");
    const { data: before } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .eq("org_id", org.orgId)
      .single();
    const { data, error } = await supabase
      .from("files")
      .update({ status: "deleted" })
      .eq("id", id)
      .eq("org_id", org.orgId)
      .select()
      .single();
    if (error) throw error;
    await supabase.rpc("write_audit", {
      p_org_id: org.orgId,
      p_actor_id: null,
      p_action: "delete",
      p_entity_type: "file",
      p_entity_id: id,
      p_before: before,
      p_after: data
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
