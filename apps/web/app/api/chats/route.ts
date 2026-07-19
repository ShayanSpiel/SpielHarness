import {
  createChat,
  listChats,
  updateChatMetadata
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const chats = await listChats(org.sql, org.orgId);
    // Phase 3: chat metadata only — messages are fetched separately
    // via /api/chats/:id/messages with cursor pagination.
    return Response.json({
      chats: chats.map((c) => ({
        ...c,
        chat_messages: [] // kept for backward compat; always empty now
      }))
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = (await request.json()) as { id?: string; title?: string };
    const id = body.id ?? crypto.randomUUID();
    const chat = await createChat(org.sql, org.orgId, id, body.title?.trim() || "New chat");
    return Response.json({ chat }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = (await request.json()) as { id?: string; title?: string; archived?: boolean; metadata?: Record<string, unknown> };
    if (!body.id) throw new HttpError(400, "id is required");
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim() || "New chat";
    if (body.archived !== undefined) patch.archived_at = body.archived ? new Date().toISOString() : null;
    if (body.metadata !== undefined) {
      const updated = await updateChatMetadata(org.sql, org.orgId, body.id, body.metadata);
      if (!updated) throw new HttpError(404, "Chat not found");
      if (Object.keys(patch).length === 0) return Response.json({ chat: updated });
    }
    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, "no fields to update");
    }
    const rows = await org.sql`
      update chats
      set ${org.sql(patch)}
      where org_id = ${org.orgId} and id = ${body.id}
      returning id, org_id, title, created_at, updated_at, archived_at
    `;
    if (rows.length === 0) throw new HttpError(404, "Chat not found");
    return Response.json({ chat: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}
