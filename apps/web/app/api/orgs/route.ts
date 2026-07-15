import { cookies } from "next/headers";
import { getOrg, errorResponse, requireOwner } from "../../../lib/server";
import { createOrg as createOrgInDb, getUserOrgs } from "@spielos/db";

export async function GET() {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const userOrgs = await getUserOrgs(org.sql, org.userId);
    return Response.json({ orgs: userOrgs });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { name, slug } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return Response.json({ error: "Name is required" }, { status: 400 });
    }

    const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);

    const created = await createOrgInDb(org.sql, name.trim(), orgSlug, org.userId);
    return Response.json({ org: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const org = await getOrg();
    requireOwner(org);

    const body = await request.json();
    const { name, slug } = body;

    if (name) {
      await org.sql`
        update orgs set name = ${name}, updated_at = now()
        where id = ${org.orgId}
      `;
    }

    if (slug) {
      const existing = await org.sql<{ id: string }[]>`
        select id from orgs where slug = ${slug} and id <> ${org.orgId} limit 1
      `;
      if (existing.length > 0) {
        return Response.json({ error: "Slug is already taken" }, { status: 409 });
      }
      await org.sql`
        update orgs set slug = ${slug}, updated_at = now()
        where id = ${org.orgId}
      `;
    }

    return Response.json({ success: true, name, slug });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    const org = await getOrg();
    requireOwner(org);

    await org.sql`
      update orgs set deleted_at = now(), slug = slug || '-deleted-' || floor(extract(epoch from now()))::text
      where id = ${org.orgId} and deleted_at is null
    `;

    const cookieStore = await cookies();
    cookieStore.delete("spielos.org");
    cookieStore.delete("spielos.org-name");
    cookieStore.delete("spielos.org-role");

    return Response.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
