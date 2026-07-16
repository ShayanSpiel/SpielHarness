import { getOrg, errorResponse, requireOwner } from "../../../../../lib/server";
import {
  getOrgInvitations as getOrgInvitationsInDb,
  cancelInvitation as cancelInvitationInDb,
} from "@spielos/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const org = await getOrg();
    requireOwner(org);

    const { id: orgId } = await params;

    const invitations = await getOrgInvitationsInDb(org.sql, orgId);
    return Response.json({ invitations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const org = await getOrg();
    requireOwner(org);

    const { id: orgId } = await params;
    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get("invitationId");

    if (!invitationId) {
      return Response.json({ error: "invitationId is required" }, { status: 400 });
    }

    // Ensure the invitation belongs to this org
    const invitations = await getOrgInvitationsInDb(org.sql, orgId);
    const match = invitations.find((i) => i.id === invitationId);
    if (!match) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }

    const removed = await cancelInvitationInDb(org.sql, invitationId);
    if (!removed) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
