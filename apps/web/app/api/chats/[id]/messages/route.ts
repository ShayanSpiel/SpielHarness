import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../../../lib/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const { id: chatId } = await params;
    const body = (await request.json()) as { role?: string; body?: string; metadata?: Record<string, unknown> };
    if (!body.body?.trim() || !["system", "user", "assistant", "tool"].includes(body.role ?? "")) {
      throw new HttpError(400, "valid role and body are required");
    }
    const { data: chat } = await supabase.from("chats").select("id").eq("id", chatId).eq("org_id", org.orgId).single();
    if (!chat) throw new HttpError(404, "Chat not found");
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ org_id: org.orgId, chat_id: chatId, role: body.role, body: body.body, metadata: body.metadata ?? {} })
      .select("id, role, body, metadata, created_at")
      .single();
    if (error) throw error;
    await supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId).eq("org_id", org.orgId);
    return Response.json({ message: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
