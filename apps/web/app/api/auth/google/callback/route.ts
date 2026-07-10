import { NextResponse } from "next/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${getBaseUrl()}/knowledge?error=${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${getBaseUrl()}/knowledge?error=no_code`);
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
        `${getBaseUrl()}/knowledge?error=token_exchange_failed`
      );
    }

    const tokens = await tokenResponse.json();

    const response = NextResponse.redirect(`${getBaseUrl()}/knowledge`);

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
      `${getBaseUrl()}/knowledge?error=internal_error`
    );
  }
}
