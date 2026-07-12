import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { data, error } = await supabase
      .from("chats")
      .select("id, title, metadata, created_at, updated_at, archived_at")
      .eq("org_id", org.orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const chatIds = (data ?? []).map((chat) => chat.id);
    const { data: messages, error: messageError } = chatIds.length
      ? await supabase.from("chat_messages")
          .select("id, chat_id, role, body, metadata, created_at")
          .eq("org_id", org.orgId)
          .in("chat_id", chatIds)
          .order("created_at", { ascending: true })
          .limit(2000)
      : { data: [], error: null };
    if (messageError) throw messageError;
    const byChat = new Map<string, typeof messages>();
    for (const message of messages ?? []) {
      const list = byChat.get(message.chat_id) ?? [];
      list.push(message);
      byChat.set(message.chat_id, list);
    }
    return Response.json({
      chats: (data ?? []).map((chat) => ({ ...chat, chat_messages: byChat.get(chat.id) ?? [] }))
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as { id?: string; title?: string };
    const id = body.id ?? crypto.randomUUID();
    const { data, error } = await supabase
      .from("chats")
      .insert({ id, org_id: org.orgId, title: body.title?.trim() || "New chat" })
      .select("id, title, created_at, updated_at")
      .single();
    if (error) throw error;
    return Response.json({ chat: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as { id?: string; title?: string; archived?: boolean };
    if (!body.id) throw new HttpError(400, "id is required");
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim() || "New chat";
    if (body.archived !== undefined) patch.archived_at = body.archived ? new Date().toISOString() : null;
    const { data, error } = await supabase
      .from("chats")
      .update(patch)
      .eq("id", body.id)
      .eq("org_id", org.orgId)
      .select("id, title, created_at, updated_at, archived_at")
      .single();
    if (error) throw error;
    return Response.json({ chat: data });
  } catch (error) {
    return errorResponse(error);
  }
}
