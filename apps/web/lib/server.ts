import { cookies, headers } from "next/headers";
import { createSql, type Sql } from "@spielos/db";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000001";

let cachedSql: Sql | null = null;

function getSql(): Sql | null {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  cachedSql = createSql(url);
  return cachedSql;
}

export type OrgContext = {
  sql: Sql;
  orgId: string;
  isDemo: boolean;
};

export async function getOrg(): Promise<OrgContext> {
  const sql = getSql();
  if (!sql) {
    throw new HttpError(503, "Database is not configured. Set DATABASE_URL.");
  }
  // Until auth is implemented, resolve to the demo org. The cookie is a
  // placeholder for future multi-tenancy.
  const cookieStore = await cookies();
  const requestedOrg = cookieStore.get("spielos.org")?.value;
  if (requestedOrg && requestedOrg !== DEMO_ORG_ID) {
    throw new HttpError(401, "Authentication required for non-demo workspaces.");
  }
  return {
    sql,
    orgId: DEMO_ORG_ID,
    isDemo: true
  };
}

export function requireRole(
  org: OrgContext,
  _allowed: Array<"owner" | "admin" | "editor" | "viewer">
) {
  void _allowed;
  // Until auth is implemented, the demo org has full access. Production
  // multi-tenant code will check `org_memberships` here.
  if (org.isDemo) return;
  throw new HttpError(403, "You do not have permission to perform this action.");
}

export const requireWrite = (org: OrgContext) =>
  requireRole(org, ["owner", "admin", "editor"]);

export const requireAdmin = (org: OrgContext) =>
  requireRole(org, ["owner", "admin"]);

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return Response.json({ error: message }, { status: 500 });
}

// Silently consume the headers import so it isn't tree-shaken if unused.
void headers;
