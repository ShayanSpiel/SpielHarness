import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getOrg } from "../../../../../lib/server";

export async function POST() {
  try {
    await getOrg();
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google_access_token")?.value;

  if (accessToken) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken })
      });
    } catch {
      // best-effort revoke
    }
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set("google_access_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });

  response.cookies.set("google_refresh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });

  return response;
}
