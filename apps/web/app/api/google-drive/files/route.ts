import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google_access_token")?.value;
  const refreshToken = cookieStore.get("google_refresh_token")?.value;

  if (accessToken) return accessToken;

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
        const tokens = await tokenResponse.json() as { access_token: string; expires_in?: number };
        const response = NextResponse.next();
        response.cookies.set("google_access_token", tokens.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: tokens.expires_in || 3600,
          path: "/"
        });
        return tokens.access_token;
      }
    } catch (err) {
      console.error("Token refresh error", err);
    }
  }

  return null;
}

export async function GET(request: Request) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const pageToken = url.searchParams.get("pageToken") || "";
  const pageSize = url.searchParams.get("pageSize") || "20";

  const driveUrl = new URL("https://www.googleapis.com/drive/v3/files");
  driveUrl.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink)");
  driveUrl.searchParams.set("pageSize", pageSize);
  driveUrl.searchParams.set("orderBy", "modifiedTime desc");

  if (query) {
    driveUrl.searchParams.set("q", `name contains '${query.replace(/'/g, "\\'")}' or fullText contains '${query.replace(/'/g, "\\'")}'`);
  }
  if (pageToken) {
    driveUrl.searchParams.set("pageToken", pageToken);
  }

  try {
    const response = await fetch(driveUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Drive API error:", error);
      return NextResponse.json({ error: "Failed to fetch files" }, { status: response.status });
    }

    const data = await response.json() as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
        webViewLink?: string;
        iconLink?: string;
      }>;
      nextPageToken?: string;
    };

    return NextResponse.json({
      files: data.files || [],
      nextPageToken: data.nextPageToken || null
    });
  } catch (err) {
    console.error("Drive fetch error", err);
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }
}
