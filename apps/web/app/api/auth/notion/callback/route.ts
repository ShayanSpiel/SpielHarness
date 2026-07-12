import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptConnectionSecret } from "../../../../../lib/connection-secrets";
import { loadIntegrationCatalog } from "../../../../../lib/integration-catalog";
import { getOrg, requireSupabase } from "../../../../../lib/server";

function baseUrl() { return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"; }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  if (!code || !state || state !== cookieStore.get("notion_oauth_state")?.value) return NextResponse.redirect(`${baseUrl()}/settings?tab=connections&error=no_code`);
  try {
    const clientId = process.env.NOTION_CLIENT_ID ?? "";
    const clientSecret = process.env.NOTION_CLIENT_SECRET ?? "";
    const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: `${baseUrl()}/api/auth/notion/callback` })
    });
    if (!tokenResponse.ok) throw new Error(`Notion token exchange failed: ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { access_token: string; workspace_id?: string; workspace_name?: string; bot_id?: string };
    const preset = (await loadIntegrationCatalog()).find((item) => item.id === "notion");
    if (!preset) throw new Error("Notion preset is missing.");
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const account = token.workspace_name ?? token.workspace_id ?? "Notion workspace";
    const credential = encryptConnectionSecret({ provider: "notion", accessToken: token.access_token, workspaceId: token.workspace_id, botId: token.bot_id });
    const { error } = await supabase.from("connections").upsert({ org_id: org.orgId, name: `${preset.name} — ${account}`, kind: "oauth", status: "configured", config: { presetId: preset.id, icon: preset.icon, logo: preset.logo, description: preset.description, account, oauthCredential: credential }, operations: preset.operations, enabled: true, deleted_at: null }, { onConflict: "org_id,name" });
    if (error) throw error;
    const response = NextResponse.redirect(`${baseUrl()}/settings?tab=connections&connected=Notion`);
    response.cookies.delete("notion_oauth_state");
    return response;
  } catch (error) {
    console.error("Notion OAuth callback error", error);
    return NextResponse.redirect(`${baseUrl()}/settings?tab=connections&error=connection_failed`);
  }
}
