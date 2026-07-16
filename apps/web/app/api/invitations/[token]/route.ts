import { errorResponse } from "../../../../lib/server";
import { createSql } from "@spielos/db";
import {
  findInvitationByToken,
  acceptInvitation as acceptInvitationInDb,
  addMember as addMemberInDb,
  getProfile,
} from "@spielos/db";
import { auth } from "../../../../lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const sql = createSql(process.env.DATABASE_URL!);
    const invitation = await findInvitationByToken(sql, token);

    if (!invitation) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }

    if (invitation.status !== "pending") {
      return Response.json({ error: "Invitation has already been used" }, { status: 400 });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return Response.json({ error: "Invitation has expired" }, { status: 400 });
    }

    return Response.json({
      email: invitation.email,
      org_name: invitation.org_name,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const sql = createSql(process.env.DATABASE_URL!);
    const invitation = await findInvitationByToken(sql, token);

    if (!invitation) {
      return Response.json({ error: "Invitation not found" }, { status: 404 });
    }

    if (invitation.status !== "pending") {
      return Response.json({ error: "Invitation has already been used" }, { status: 400 });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return Response.json({ error: "Invitation has expired" }, { status: 400 });
    }

    const headers = new Headers(_request.headers);
    const session = await auth.api.getSession({ headers }).catch(() => null);

    if (!session?.user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const profile = await getProfile(sql, session.user.id);
    if (!profile || profile.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return Response.json(
        { error: "This invitation was sent to a different email address" },
        { status: 403 }
      );
    }

    await addMemberInDb(sql, invitation.org_id, session.user.id, invitation.role as "admin");
    await acceptInvitationInDb(sql, invitation.id);

    return Response.json({ org_id: invitation.org_id, org_name: invitation.org_name });
  } catch (err) {
    return errorResponse(err);
  }
}
