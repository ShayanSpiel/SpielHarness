import { listChatMessages, appendChatMessage, touchChat } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const { id } = await params;
    const url = new URL(request.url);
    const after = url.searchParams.get("after") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const messages = await listChatMessages(org.sql, org.orgId, id, { after, limit });
    return Response.json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const { id } = await params;
    const body = (await request.json()) as { role: string; body: string; metadata?: Record<string, unknown> };
    if (!body.role || !body.body) throw new HttpError(400, "role and body are required");
    const message = await appendChatMessage(org.sql, org.orgId, id, body.role, body.body, body.metadata ?? {});
    await touchChat(org.sql, org.orgId, id);
    return Response.json({ message }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
