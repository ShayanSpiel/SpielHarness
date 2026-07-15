import {
  createFile,
  getFile,
  listHarnessFiles,
  softDeleteFile,
  updateFile
} from "@spielos/db";
import type { MemoryKind, MemoryRecord, MemoryScope } from "@spielos/core";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../lib/server";

function toMemory(row: Awaited<ReturnType<typeof listHarnessFiles>>[number]): MemoryRecord | null {
  const metadata = row.metadata ?? {};
  if (metadata.memoryRecord !== true || row.status === "deleted") return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: metadata.memoryKind === "episodic" ? "episodic" : "semantic",
    scope: ["workspace", "user", "role", "workflow"].includes(String(metadata.memoryScope))
      ? metadata.memoryScope as MemoryScope
      : "workspace",
    scopeId: typeof metadata.scopeId === "string" ? metadata.scopeId : null,
    provenance: {
      sourceType: ["user", "run", "file", "system"].includes(String(metadata.sourceType))
        ? metadata.sourceType as MemoryRecord["provenance"]["sourceType"]
        : "user",
      sourceId: typeof metadata.sourceId === "string" ? metadata.sourceId : null,
      reason: typeof metadata.reason === "string" ? metadata.reason : "Added by a workspace member."
    },
    confidence: typeof metadata.confidence === "number" ? metadata.confidence : 1,
    authority: metadata.authority === "user_confirmed" ? "user_confirmed" : "learned",
    status: ["proposed", "approved", "superseded", "forgotten"].includes(String(metadata.memoryStatus))
      ? metadata.memoryStatus as MemoryRecord["status"]
      : "proposed",
    pinned: metadata.pinned === true,
    supersedesId: typeof metadata.supersedesId === "string" ? metadata.supersedesId : null,
    conflictIds: Array.isArray(metadata.potentialConflictIds) ? metadata.potentialConflictIds.filter((id): id is string => typeof id === "string") : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET() {
  try {
    const org = await getOrg();
    const files = await listHarnessFiles(org.sql, org.orgId);
    const memories = files.map(toMemory).filter((memory): memory is MemoryRecord => Boolean(memory));
    const workspaceFiles = files
      .filter((file) => file.metadata?.workspaceConfig === true && file.status !== "deleted")
      .map((file) => ({
        id: file.id,
        title: file.title,
        body: file.body,
        updatedAt: file.updated_at,
        metadata: file.metadata
      }));
    return Response.json({ memories, workspaceFiles });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = await request.json() as {
      title?: string;
      body?: string;
      kind?: MemoryKind;
      scope?: MemoryScope;
      scopeId?: string | null;
      sourceType?: MemoryRecord["provenance"]["sourceType"];
      sourceId?: string | null;
      reason?: string;
      confidence?: number;
      approved?: boolean;
      pinned?: boolean;
      supersedesId?: string | null;
    };
    if (!body.title?.trim() || !body.body?.trim()) throw new HttpError(400, "title and body are required");
    const scope = body.scope ?? "workspace";
    const scopeId = scope === "user" ? org.userId : (body.scopeId ?? null);
    const files = await listHarnessFiles(org.sql, org.orgId);
    const duplicate = files
      .map(toMemory)
      .find((memory) => memory && memory.scope === scope && memory.scopeId === scopeId && normalize(memory.body) === normalize(body.body!));
    if (duplicate) throw new HttpError(409, `An equivalent memory already exists (${duplicate.id}).`);
    const possibleConflict = files
      .map(toMemory)
      .find((memory) => memory && memory.status !== "forgotten" && memory.status !== "superseded" && memory.scope === scope && memory.scopeId === scopeId && normalize(memory.title) === normalize(body.title!) && memory.id !== body.supersedesId);
    if (possibleConflict && !body.supersedesId) {
      throw new HttpError(409, `A memory with this title already exists (${possibleConflict.id}). Select it under “Supersedes memory” to record the contradiction explicitly.`);
    }

    if (body.supersedesId && body.approved) {
      const prior = await getFile(org.sql, org.orgId, body.supersedesId);
      if (!prior || prior.metadata?.memoryRecord !== true) throw new HttpError(400, "supersedesId does not reference a memory");
      await updateFile(org.sql, org.orgId, prior.id, {
        metadata: { ...prior.metadata, memoryStatus: "superseded", supersededAt: new Date().toISOString() }
      });
    }
    const row = await createFile(org.sql, org.orgId, {
      title: body.title.trim(),
      body: body.body.trim(),
      fileType: "knowledge",
      status: "active",
      metadata: {
        memoryRecord: true,
        memoryKind: body.kind ?? "semantic",
        memoryScope: scope,
        scopeId,
        sourceType: body.sourceType ?? "user",
        sourceId: body.sourceId ?? null,
        reason: body.reason?.trim() || "Explicitly added by a workspace member.",
        confidence: Math.min(1, Math.max(0, body.confidence ?? 1)),
        authority: body.approved ? "user_confirmed" : "learned",
        memoryStatus: body.approved ? "approved" : "proposed",
        pinned: body.pinned ?? false,
        supersedesId: body.supersedesId ?? null
      }
    });
    return Response.json({ memory: toMemory(row)! }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = await request.json() as Partial<MemoryRecord> & { id?: string; approve?: boolean; approved?: boolean };
    if (!body.id) throw new HttpError(400, "id is required");
    const existing = await getFile(org.sql, org.orgId, body.id);
    if (!existing || existing.metadata?.memoryRecord !== true) throw new HttpError(404, "Memory not found");
    const nextScope = body.scope ?? existing.metadata.memoryScope;
    const nextScopeId = nextScope === "user" ? org.userId : body.scopeId;
    const approval = body.approved ?? body.approve;
    const conflictIds = Array.isArray(existing.metadata.potentialConflictIds)
      ? existing.metadata.potentialConflictIds.filter((id): id is string => typeof id === "string")
      : [];
    if (approval === true && conflictIds.length > 0 && !body.supersedesId && !existing.metadata.supersedesId) {
      throw new HttpError(409, "Resolve the possible contradiction by selecting the memory this record supersedes before approval.");
    }
    if (body.supersedesId && approval === true) {
      if (body.supersedesId === body.id) throw new HttpError(400, "A memory cannot supersede itself");
      const prior = await getFile(org.sql, org.orgId, body.supersedesId);
      if (!prior || prior.metadata?.memoryRecord !== true) throw new HttpError(400, "supersedesId does not reference a memory");
      await updateFile(org.sql, org.orgId, prior.id, {
        metadata: { ...prior.metadata, memoryStatus: "superseded", supersededAt: new Date().toISOString() }
      });
    }
    const metadata = {
      ...existing.metadata,
      ...(body.kind ? { memoryKind: body.kind } : {}),
      ...(body.scope ? { memoryScope: body.scope } : {}),
      ...(body.scope !== undefined || body.scopeId !== undefined ? { scopeId: nextScopeId ?? null } : {}),
      ...(body.confidence !== undefined ? { confidence: Math.min(1, Math.max(0, body.confidence)) } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      ...(body.status ? { memoryStatus: body.status } : {}),
      ...(approval === true ? { memoryStatus: "approved", authority: "user_confirmed", approvedAt: new Date().toISOString() } : {}),
      ...(approval === false ? { memoryStatus: "proposed", authority: "learned", approvedAt: null } : {}),
      ...(body.supersedesId !== undefined ? { supersedesId: body.supersedesId } : {}),
      ...(body.provenance ? {
        sourceType: body.provenance.sourceType,
        sourceId: body.provenance.sourceId,
        reason: body.provenance.reason
      } : {})
    };
    const row = await updateFile(org.sql, org.orgId, body.id, {
      title: body.title,
      body: body.body,
      metadata
    });
    return Response.json({ memory: toMemory(row)! });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const mode = url.searchParams.get("mode") ?? "forget";
    if (!id) throw new HttpError(400, "id is required");
    const existing = await getFile(org.sql, org.orgId, id);
    if (!existing || existing.metadata?.memoryRecord !== true) throw new HttpError(404, "Memory not found");
    if (mode === "remove") {
      await softDeleteFile(org.sql, org.orgId, id);
    } else {
      await updateFile(org.sql, org.orgId, id, {
        status: "archived",
        metadata: { ...existing.metadata, memoryStatus: "forgotten", forgottenAt: new Date().toISOString() }
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
