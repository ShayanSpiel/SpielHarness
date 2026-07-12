import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encryptConnectionSecret } from "../../../../../lib/connection-secrets";
import { loadIntegrationCatalog } from "../../../../../lib/integration-catalog";
import { getOrg, requireSupabase } from "../../../../../lib/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("google_oauth_state")?.value;
  const integration = cookieStore.get("google_oauth_integration")?.value ?? "google-drive";

  if (error) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?tab=connections&error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?tab=connections&error=no_code`);
  }

  const redirectUri = `${getBaseUrl()}/api/auth/google/callback`;

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      console.error("Token exchange failed", body);
      return NextResponse.redirect(
        `${getBaseUrl()}/settings?tab=connections&error=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    const preset = (await loadIntegrationCatalog()).find((item) => item.id === integration);
    if (!preset) throw new Error("Unknown Google integration preset.");
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const account = profile.email ?? "Google account";
    const credential = encryptConnectionSecret({ provider: "google", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000, scope: tokens.scope });
    const connectionName = `${preset.name} — ${account}`;
    const { error: connectionError } = await supabase.from("connections").upsert({
      org_id: org.orgId,
      name: connectionName,
      kind: "oauth",
      status: "configured",
      config: { presetId: preset.id, icon: preset.icon, logo: preset.logo, description: preset.description, account, oauthCredential: credential },
      operations: preset.operations,
      enabled: true,
      deleted_at: null
    }, { onConflict: "org_id,name" });
    if (connectionError) throw connectionError;

    const response = NextResponse.redirect(`${getBaseUrl()}/settings?tab=connections&connected=${encodeURIComponent(preset.name)}`);
    response.cookies.delete("google_oauth_state");
    response.cookies.delete("google_oauth_integration");

    response.cookies.set("google_access_token", tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokens.expires_in || 3600,
      path: "/"
    });

    if (tokens.refresh_token) {
      response.cookies.set("google_refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60,
        path: "/"
      });
    }

    return response;
  } catch (err) {
    console.error("OAuth callback error", err);
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?tab=connections&error=connection_failed`
    );
  }
}
