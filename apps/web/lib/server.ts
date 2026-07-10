import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000001";

export type OrgContext = {
  orgId: string;
  supabase: SupabaseClient;
  isDemo: boolean;
};

export function getSupabaseServer(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getOrg(): Promise<OrgContext> {
  const supabase = getSupabaseServer();
  const cookieStore = await cookies();
  const sessionOrg = cookieStore.get("spielos.org")?.value;
  if (supabase && sessionOrg) {
    return { orgId: sessionOrg, supabase, isDemo: sessionOrg === DEMO_ORG_ID };
  }
  if (supabase) {
    return { orgId: DEMO_ORG_ID, supabase, isDemo: true };
  }
  // No Supabase configured — return a stub so API routes can return clean 503s
  return {
    orgId: sessionOrg ?? DEMO_ORG_ID,
    supabase: null as unknown as SupabaseClient,
    isDemo: true
  };
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
