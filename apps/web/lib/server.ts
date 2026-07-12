import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000001";

export type OrgContext = {
  orgId: string;
  supabase: SupabaseClient;
  isDemo: boolean;
  profileId: string | null;
  membershipRole: "owner" | "admin" | "editor" | "viewer" | null;
};

export function getSupabaseServer(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getOrg(): Promise<OrgContext> {
  const supabase = getSupabaseServer();
  const cookieStore = await cookies();
  const requestedOrg = cookieStore.get("spielos.org")?.value;
  if (supabase) {
    const headerStore = await headers();
    const authorization = headerStore.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (token) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anonKey) throw new HttpError(500, "Supabase anonymous key is required for authentication");
      const authClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      const { data: { user }, error: userError } = await authClient.auth.getUser(token);
      if (userError || !user) throw new HttpError(401, "Invalid or expired session");

      let membershipQuery = supabase
        .from("org_memberships")
        .select("org_id, role")
        .eq("profile_id", user.id)
        .limit(1);
      if (requestedOrg) membershipQuery = membershipQuery.eq("org_id", requestedOrg);
      const { data: memberships, error: membershipError } = await membershipQuery;
      if (membershipError) throw membershipError;
      const orgId = memberships?.[0]?.org_id;
      if (!orgId) throw new HttpError(403, "You are not a member of this workspace");
      return {
        orgId,
        supabase,
        isDemo: orgId === DEMO_ORG_ID,
        profileId: user.id,
        membershipRole: memberships?.[0]?.role ?? null
      };
    }

    // Anonymous access is restricted to the local demo workspace. Never trust
    // an arbitrary workspace cookie when using privileged server credentials.
    if (requestedOrg && requestedOrg !== DEMO_ORG_ID) {
      throw new HttpError(401, "Authentication is required for this workspace");
    }
    return { orgId: DEMO_ORG_ID, supabase, isDemo: true, profileId: null, membershipRole: null };
  }
  // No Supabase configured — return a stub so API routes can return clean 503s
  return {
    orgId: DEMO_ORG_ID,
    supabase: null as unknown as SupabaseClient,
    isDemo: true,
    profileId: null,
    membershipRole: null
  };
}

export function requireOrgRole(org: OrgContext, allowed: Array<NonNullable<OrgContext["membershipRole"]>>) {
  if (org.isDemo && process.env.NODE_ENV !== "production") return;
  if (!org.profileId || !org.membershipRole || !allowed.includes(org.membershipRole)) {
    throw new HttpError(403, "You do not have permission to perform this action");
  }
}

export function requireOrgWrite(org: OrgContext) {
  requireOrgRole(org, ["owner", "admin", "editor"]);
}

export function requireSupabase(org: OrgContext): SupabaseClient {
  if (!org.supabase) {
    throw new HttpError(503, "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  return org.supabase;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return Response.json({ error: message }, { status: 500 });
}
