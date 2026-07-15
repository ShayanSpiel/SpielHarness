import { cookies } from "next/headers";
import { getOrg, errorResponse } from "../../../../lib/server";
import { getUserOrgs } from "@spielos/db";

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { orgId } = body;

    if (!orgId || typeof orgId !== "string") {
      return Response.json({ error: "orgId is required" }, { status: 400 });
    }

    // Verify the user has access to the target org
    const userOrgs = await getUserOrgs(org.sql, org.userId);
    const hasAccess = userOrgs.some((o) => o.org_id === orgId);

    if (!hasAccess) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

    // Find the org details
    const targetOrg = userOrgs.find((o) => o.org_id === orgId);

    // Set the org cookies
    const cookieStore = await cookies();
    cookieStore.set("spielos.org", orgId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    if (targetOrg) {
      cookieStore.set("spielos.org-name", targetOrg.org_name, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      cookieStore.set("spielos.org-role", targetOrg.role, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return Response.json({
      success: true,
      orgId,
      orgName: targetOrg?.org_name ?? null,
      role: targetOrg?.role ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
