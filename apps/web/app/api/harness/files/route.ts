import { errorResponse, getOrg, requireSupabase } from "../../../../lib/server";

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
      .select("*")
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
    if (!body.title) throw new Error("title is required");
    const insert: Record<string, unknown> = {
      org_id: org.orgId,
      title: body.title,
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
    if (!body.id) throw new Error("id is required");

    const { data: before } = await supabase
      .from("files")
      .select("*")
      .eq("id", body.id)
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
    const supabase = requireSupabase(org);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) throw new Error("id is required");
    const { data: before } = await supabase
      .from("files")
      .select("*")
      .eq("id", id)
      .single();
    const { data, error } = await supabase
      .from("files")
      .update({ status: "deleted" })
      .eq("id", id)
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
