import {
  createChat,
  listChats
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const chats = await listChats(org.sql, org.orgId);
    const ids = chats.map((c) => c.id);
    const messages = ids.length
      ? await org.sql<{ id: string; chat_id: string; role: string; body: string; metadata: Record<string, unknown>; created_at: string }[]>`
          select id, chat_id, role, body, metadata, created_at
          from chat_messages
          where org_id = ${org.orgId} and chat_id = any(${ids})
          order by created_at asc
        `
      : [];
    const byChat = new Map<string, (typeof messages)[number][]>();
    for (const m of messages) {
      const list = byChat.get(m.chat_id) ?? [];
      list.push(m);
      byChat.set(m.chat_id, list);
    }
    return Response.json({
      chats: chats.map((c) => ({
        ...c,
        chat_messages: byChat.get(c.id) ?? []
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
    const body = (await request.json()) as { id?: string; title?: string; archived?: boolean };
    if (!body.id) throw new HttpError(400, "id is required");
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim() || "New chat";
    if (body.archived !== undefined) patch.archived_at = body.archived ? new Date().toISOString() : null;
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
