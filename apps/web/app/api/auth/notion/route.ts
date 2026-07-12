import { NextResponse } from "next/server";

function baseUrl() { return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"; }

export async function GET() {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Notion OAuth is not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET." }, { status: 503 });
  const state = crypto.randomUUID();
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", `${baseUrl()}/api/auth/notion/callback`);
  url.searchParams.set("state", state);
  const response = NextResponse.redirect(url);
  response.cookies.set("notion_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/auth/notion" });
  return response;
}
