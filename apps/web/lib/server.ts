import { cookies, headers } from "next/headers";
import { createSql, getMembership, getUserOrgs, type Sql } from "@spielos/db";
import { auth } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const getCached = <T>(key: string, init: () => T): T => {
  const g = globalThis as unknown as Record<string, T | undefined>;
  if (!g[key]) g[key] = init();
  return g[key]!;
};

function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return getCached("__sql_pool", () => createSql(url));
}

export type OrgContext = {
  sql: Sql;
  orgId: string;
  userId: string | null;
  role: "owner" | "admin" | null;
  isDemo: boolean;
};

const sessionCache = new Map<string, { userId: string; expiresAt: number }>();
const SESSION_TTL = 30_000;

function extractSessionToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1] ?? null;
}

async function resolveUserId(cookieHeader: string): Promise<string | null> {
  const token = extractSessionToken(cookieHeader);
  if (!token) return null;

  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookieHeader }),
  }).catch(() => null);

  if (session?.user) {
    sessionCache.set(token, {
      userId: session.user.id,
      expiresAt: Date.now() + SESSION_TTL,
    });
    return session.user.id;
  }

  sessionCache.delete(token);
  return null;
}

export async function getOrg(): Promise<OrgContext> {
  const sql = getSql();
  if (!sql) {
    throw new HttpError(503, "Database is not configured. Set DATABASE_URL.");
  }

  const reqHeaders = await headers();
  const cookieHeader = reqHeaders.get("cookie") ?? "";
  const userId = await resolveUserId(cookieHeader);

  if (!userId) {
    throw new HttpError(401, "Authentication required.");
  }

  const cookieStore = await cookies();
  const orgIdCookie = cookieStore.get("spielos.org")?.value;
  const roleCookie = cookieStore.get("spielos.org-role")?.value as "owner" | "admin" | undefined;

  if (orgIdCookie && roleCookie) {
    const membership = await getMembership(sql, userId, orgIdCookie);
    if (membership) {
      return {
        sql,
        orgId: orgIdCookie,
        userId,
        role: membership.role as "owner" | "admin",
        isDemo: false,
      };
    }
  }

  if (orgIdCookie) {
    const userOrgs = await getUserOrgs(sql, userId);
    const match = userOrgs.find((o) => o.org_id === orgIdCookie);
    if (match) {
      return {
        sql,
        orgId: orgIdCookie,
        userId,
        role: match.role as "owner" | "admin",
        isDemo: false,
      };
    }
  }

  const userOrgs = await getUserOrgs(sql, userId);
  if (userOrgs.length > 0) {
    return {
      sql,
      orgId: userOrgs[0].org_id,
      userId,
      role: userOrgs[0].role as "owner" | "admin",
      isDemo: false,
    };
  }

  throw new HttpError(403, "No workspace found.");
}

export function requireRole(
  org: OrgContext,
  allowed: Array<"owner" | "admin">
): void {
  if (org.isDemo) return;
  if (!org.userId) {
    throw new HttpError(401, "Authentication required.");
  }
  if (!org.role || !allowed.includes(org.role)) {
    throw new HttpError(403, "You do not have permission to perform this action.");
  }
}

export const requireWrite = (org: OrgContext) =>
  requireRole(org, ["owner", "admin"]);

export const requireAdmin = (org: OrgContext) =>
  requireRole(org, ["owner", "admin"]);

export const requireOwner = (org: OrgContext) =>
  requireRole(org, ["owner"]);

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return Response.json({ error: message }, { status: 500 });
}
