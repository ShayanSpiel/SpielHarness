import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertConnection } from "@spielos/db";
import { encryptConnectionSecret } from "../../../../../lib/connection-secrets";
import { loadIntegrationCatalog } from "../../../../../lib/integration-catalog";
import { getOrg } from "../../../../../lib/server";
import { googleOAuthStateSigningSecret, verifyGoogleOAuthContext } from "../../../../../lib/google-oauth-state";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function redirectWithOAuthCleanup(path: string): NextResponse {
  const response = NextResponse.redirect(`${getBaseUrl()}${path}`);
  response.cookies.set("google_oauth_context", "", { path: "/api/auth/google", maxAge: 0 });
  // Remove credentials left by older application versions as well.
  response.cookies.delete("google_access_token");
  response.cookies.delete("google_refresh_token");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const context = verifyGoogleOAuthContext(
    cookieStore.get("google_oauth_context")?.value,
    googleOAuthStateSigningSecret()
  );

  if (error) {
    return redirectWithOAuthCleanup(`/settings?tab=connections&error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !context || state !== context.state) {
    return redirectWithOAuthCleanup("/settings?tab=connections&error=invalid_state");
  }

  const redirectUri = `${getBaseUrl()}/api/auth/google/callback`;

  try {
    const org = await getOrg();
    if (!org.userId || org.userId !== context.userId || org.orgId !== context.orgId) {
      return redirectWithOAuthCleanup("/settings?tab=connections&error=workspace_changed");
    }

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
      console.error("Google OAuth token exchange failed", { status: tokenResponse.status });
      return redirectWithOAuthCleanup("/settings?tab=connections&error=token_exchange_failed");
    }

    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    const preset = (await loadIntegrationCatalog()).find((item) => item.id === context.integration);
    if (!preset) throw new Error("Unknown Google integration preset.");
    const account = profile.email ?? "Google account";
    const credential = encryptConnectionSecret({ provider: "google", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000, scope: tokens.scope });
    const connectionName = `${preset.name} — ${account}`;
    await upsertConnection(org.sql, org.orgId, {
      name: connectionName,
      kind: "oauth",
      status: "configured",
      config: { presetId: preset.id, icon: preset.icon, logo: preset.logo, description: preset.description, account, oauthCredential: credential },
      operations: preset.operations as unknown as Array<Record<string, unknown>>,
      enabled: true
    });

    return redirectWithOAuthCleanup(`/settings?tab=connections&connected=${encodeURIComponent(preset.name)}`);
  } catch (err) {
    console.error("OAuth callback error", err);
    return redirectWithOAuthCleanup("/settings?tab=connections&error=connection_failed");
  }
}
