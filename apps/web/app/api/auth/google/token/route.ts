import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google_access_token")?.value;
  const refreshToken = cookieStore.get("google_refresh_token")?.value;

  if (accessToken) {
    return NextResponse.json({ accessToken });
  }

  // Try refreshing if we have a refresh token
  if (refreshToken) {
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token"
        })
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json();
        const response = NextResponse.json({
          accessToken: tokens.access_token
        });

        response.cookies.set("google_access_token", tokens.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: tokens.expires_in || 3600,
          path: "/"
        });

        return response;
      }
    } catch (err) {
      console.error("Token refresh error", err);
    }
  }

  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}
