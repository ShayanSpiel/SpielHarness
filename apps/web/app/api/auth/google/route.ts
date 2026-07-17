import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createGoogleOAuthContext, googleOAuthStateSigningSecret } from "../../../../lib/google-oauth-state";
import { errorResponse, getOrg } from "../../../../lib/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

const SCOPES: Record<string, string[]> = {
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.send"],
  "google-calendar": ["openid", "email", "https://www.googleapis.com/auth/calendar"],
  "google-analytics": ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly"],
  "google-drive": ["openid", "email", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"]
};

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function GET(request: Request) {
  try {
    if (!CLIENT_ID) return NextResponse.json({ error: "Google OAuth is not configured" }, { status: 503 });
    const integration = new URL(request.url).searchParams.get("integration") ?? "google-drive";
    if (!SCOPES[integration]) return NextResponse.json({ error: "Unsupported Google integration" }, { status: 400 });
    const org = await getOrg();
    if (!org.userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const secret = googleOAuthStateSigningSecret();
    if (!secret) return NextResponse.json({ error: "Google OAuth state signing is not configured" }, { status: 503 });

    const redirectUri = `${getBaseUrl()}/api/auth/google/callback`;
    const state = randomUUID();

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES[integration].join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authUrl.toString());
    response.cookies.set("google_oauth_context", createGoogleOAuthContext({
      state,
      integration,
      orgId: org.orgId,
      userId: org.userId,
      expiresAt: Date.now() + 10 * 60 * 1000
    }, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/auth/google"
    });
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
