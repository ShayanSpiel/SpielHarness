import { cookies, headers } from "next/headers";
import { createSql, getUserOrgs, type OrgWithMembership, type Sql } from "@spielos/db";
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
const pendingSessionLookups = new Map<string, Promise<string | null>>();
const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL = (() => {
  const raw = Number(process.env.SESSION_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SESSION_TTL_MS;
})();

type CachedOrg = { userId: string; orgId: string; role: "owner" | "admin"; memberships: OrgWithMembership[] };
const orgCache = new Map<string, { entry: CachedOrg; expiresAt: number }>();
const ORG_CACHE_TTL_MS = (() => {
  const raw = Number(process.env.ORG_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SESSION_TTL_MS;
})();

function readOrgCache(userId: string): CachedOrg | null {
  const hit = orgCache.get(userId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    orgCache.delete(userId);
    return null;
  }
  return hit.entry;
}

function writeOrgCache(userId: string, entry: CachedOrg): void {
  orgCache.set(userId, { entry, expiresAt: Date.now() + ORG_CACHE_TTL_MS });
}

function extractSessionToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1] ?? null;
}

function isRetriableSessionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message ?? "";
  return /terminat|closed|reset|connection|timeout|ETIMEDOUT|ECONNRESET|EPIPE|pool/i.test(message);
}

async function getSessionWithRetry(cookieHeader: string, attempts = 2): Promise<Awaited<ReturnType<typeof auth.api.getSession>>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    } catch (err) {
      lastError = err;
      if (!isRetriableSessionError(err) || attempt === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function resolveUserId(cookieHeader: string): Promise<string | null> {
  const token = extractSessionToken(cookieHeader);
  if (!token) return null;

  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  // A page boot can fan out into several protected API calls at once. They
  // share the same session token, so coalesce the database lookup instead of
  // acquiring one auth-pool client per request.
  const inFlight = pendingSessionLookups.get(token);
  if (inFlight) return inFlight;

  const lookup = (async () => {
    const session = await getSessionWithRetry(cookieHeader).catch((err) => {
      console.warn("[auth] getSession failed after retries:", err instanceof Error ? err.message : err);
      return null;
    });

    if (session?.user) {
      sessionCache.set(token, {
        userId: session.user.id,
        expiresAt: Date.now() + SESSION_TTL,
      });
      return session.user.id;
    }

    sessionCache.delete(token);
    return null;
  })();

  pendingSessionLookups.set(token, lookup);
  try {
    return await lookup;
  } finally {
    pendingSessionLookups.delete(token);
  }
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

  // Warm path: cached membership list for this user. OrgId from the cookie
  // is honored if the user is still a member; otherwise we fall through to
  // a single `getUserOrgs` and refresh the cache.
  const cached = readOrgCache(userId);
  let memberships: OrgWithMembership[] | null = cached?.memberships ?? null;

  if (!memberships) {
    memberships = await getUserOrgs(sql, userId);
    if (memberships.length > 0) {
      const first = memberships[0];
      writeOrgCache(userId, {
        userId,
        orgId: first.org_id,
        role: first.role as "owner" | "admin",
        memberships
      });
    }
  }

  if (orgIdCookie) {
    const match = memberships.find((m) => m.org_id === orgIdCookie);
    if (match) {
      return {
        sql,
        orgId: orgIdCookie,
        userId,
        // The client may select an organization, but it cannot choose the
        // authorization role. Membership is the only source of authority.
        role: match.role as "owner" | "admin",
        isDemo: false
      };
    }
  }

  if (memberships.length > 0) {
    const first = memberships[0];
    return {
      sql,
      orgId: first.org_id,
      userId,
      role: first.role as "owner" | "admin",
      isDemo: false
    };
  }

  throw new HttpError(403, "No workspace found.");
}

export function invalidateOrgCache(userId: string): void {
  orgCache.delete(userId);
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
  if (/CONNECT_TIMEOUT|ETIMEDOUT|connection timed out/i.test(message)) {
    return Response.json({ error: "The database connection timed out. Please retry the request." }, { status: 503 });
  }
  return Response.json({ error: message }, { status: 500 });
}
