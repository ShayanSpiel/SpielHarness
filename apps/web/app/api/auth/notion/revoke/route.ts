import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true });

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("notion_access_token")?.value;

  if (accessToken) {
    response.cookies.set("notion_access_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/"
    });
  }

  return response;
}
