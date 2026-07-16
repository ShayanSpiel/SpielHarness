import { getOrg, errorResponse, requireOwner } from "../../../../../lib/server";
import {
  getMembership,
  getProfile,
  findProfileByEmail,
  addMember as addMemberInDb,
  updateMemberRole as updateMemberRoleInDb,
  removeMember as removeMemberInDb,
  createInvitation,
} from "@spielos/db";
import { sendInviteEmail } from "../../../../../lib/email";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: orgId } = await params;

    const membership = await getMembership(org.sql, org.userId, orgId);
    if (!membership) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    const members = await org.sql<{
      profile_id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      role: string;
      created_at: string;
    }[]>`
      select
        m.profile_id,
        p.email,
        p.display_name,
        p.avatar_url,
        m.role::text as role,
        m.created_at
      from org_memberships m
      join profiles p on p.id = m.profile_id
      where m.org_id = ${orgId}
      order by
        case m.role
          when 'owner' then 1
          when 'admin' then 2
        end,
        p.display_name asc nulls last,
        p.email asc
    `;

    return Response.json({ members });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const org = await getOrg();
    requireOwner(org);

    const { id: orgId } = await params;
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return Response.json({ error: "Email is required" }, { status: 400 });
    }

    const profile = await findProfileByEmail(org.sql, email.trim().toLowerCase());
    if (!profile) {
      const inviterProfile = await getProfile(org.sql, org.userId!);
      const inviterName = inviterProfile?.display_name ?? inviterProfile?.email ?? "Someone";

      const orgRow = await org.sql<{ name: string }[]>`
        select name from orgs where id = ${orgId} limit 1
      `;
      const orgName = orgRow[0]?.name ?? "a workspace";

      const invitation = await createInvitation(org.sql, orgId, email.trim().toLowerCase(), "admin", org.userId!);

      await sendInviteEmail({
        email: email.trim().toLowerCase(),
        inviterName,
        orgName,
        token: invitation.token,
      });

      return Response.json({ invitation, invited: true }, { status: 201 });
    }

    const member = await addMemberInDb(org.sql, orgId, profile.id);
    return Response.json({ member }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const org = await getOrg();
    requireOwner(org);

    const { id: orgId } = await params;
    const body = await request.json();
    const { userId, role } = body;

    if (!userId || !role) {
      return Response.json({ error: "userId and role are required" }, { status: 400 });
    }

    const validRoles = ["owner", "admin"];
    if (!validRoles.includes(role)) {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    const updated = await updateMemberRoleInDb(org.sql, orgId, userId, role as "owner" | "admin");
    if (!updated) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    return Response.json({ success: true });
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
    const userId = searchParams.get("userId");

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }

    // Prevent removing the last owner
    const membership = await getMembership(org.sql, userId, orgId);
    if (membership?.role === "owner") {
      const owners = await org.sql<{ count: number }[]>`
        select count(*)::int as count
        from org_memberships
        where org_id = ${orgId} and role = 'owner'
      `;
      if (owners[0]?.count <= 1) {
        return Response.json(
          { error: "Cannot remove the last owner" },
          { status: 400 }
        );
      }
    }

    const removed = await removeMemberInDb(org.sql, orgId, userId);
    if (!removed) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
