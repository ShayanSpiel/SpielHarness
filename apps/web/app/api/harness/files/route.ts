import {
  audit,
  createFile,
  fileHasIncomingReferences,
  getFile,
  listHarnessFiles,
  softDeleteFile,
  updateFile
} from "@spielos/db";
import type { FileRecord } from "@spielos/core";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../lib/server";

function toClient(row: {
  id: string;
  org_id: string;
  folder_id: string | null;
  file_type: string;
  status: string;
  title: string;
  body: string;
  content_format: string;
  metadata: Record<string, unknown>;
  current_version: number;
  created_at: string;
  updated_at: string;
}): FileRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    folderId: row.folder_id,
    fileType: row.file_type as FileRecord["fileType"],
    status: row.status as FileRecord["status"],
    title: row.title,
    body: row.body,
    contentFormat: row.content_format,
    metadata: row.metadata ?? {},
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const FILE_TYPES = [
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
  "harness_workflow",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
];

const FILE_STATUSES = ["draft", "active", "archived", "deleted"];

export async function GET() {
  try {
    const org = await getOrg();
    const files = await listHarnessFiles(org.sql, org.orgId);
    return Response.json({ files: files.map(toClient) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
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
    if (!FILE_TYPES.includes(body.fileType)) throw new HttpError(400, "invalid fileType");
    if (body.status && !FILE_STATUSES.includes(body.status)) {
      throw new HttpError(400, "invalid status");
    }

    const row = await createFile(org.sql, org.orgId, {
      id: body.id,
      title: body.title.trim(),
      body: body.body ?? "",
      fileType: body.fileType,
      status: body.status ?? "draft",
      folderId: body.folderId ?? null,
      metadata: body.metadata ?? {}
    });
    await audit(org.sql, org.orgId, {
      action: "create",
      entityType: "file",
      entityId: row.id,
      after: { id: row.id, fileType: row.file_type, status: row.status, title: row.title }
    });
    return Response.json({ file: toClient(row) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
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
    if (body.fileType && !FILE_TYPES.includes(body.fileType)) {
      throw new HttpError(400, "invalid fileType");
    }
    if (body.status && !FILE_STATUSES.includes(body.status)) {
      throw new HttpError(400, "invalid status");
    }
    const before = await getFile(org.sql, org.orgId, body.id);
    if (!before) throw new HttpError(404, "File not found");
    const row = await updateFile(org.sql, org.orgId, body.id, {
      title: body.title,
      body: body.body,
      fileType: body.fileType,
      status: body.status,
      folderId: body.folderId,
      metadata: body.metadata
    });
    await audit(org.sql, org.orgId, {
      action: "update",
      entityType: "file",
      entityId: row.id,
      before: { id: before.id, fileType: before.file_type, status: before.status, title: before.title, body: before.body, metadata: before.metadata },
      after: { id: row.id, fileType: row.file_type, status: row.status, title: row.title, body: row.body, metadata: row.metadata }
    });
    return Response.json({ file: toClient(row) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");

    const hasIncoming = await fileHasIncomingReferences(org.sql, org.orgId, id);
    if (hasIncoming) {
      throw new HttpError(409, "This object is still referenced by another active harness object.");
    }

    const before = await getFile(org.sql, org.orgId, id);
    if (!before) throw new HttpError(404, "File not found");
    await softDeleteFile(org.sql, org.orgId, id);
    await audit(org.sql, org.orgId, {
      action: "delete",
      entityType: "file",
      entityId: id,
      before: { id: before.id, fileType: before.file_type, status: before.status, title: before.title }
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
