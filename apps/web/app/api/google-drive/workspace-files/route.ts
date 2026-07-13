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
    } catch {
      return null;
    }
  }

  return null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
}

function mapToWorkspaceFile(file: DriveFile): {
  id: string;
  orgId: string;
  folderId: null;
  fileType: string;
  status: string;
  title: string;
  body: string;
  contentFormat: string;
  metadata: Record<string, unknown>;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: `gdrive-${file.id}`,
    orgId: "00000000-0000-0000-0000-000000000001",
    folderId: null,
    fileType: "knowledge",
    status: "active",
    title: file.name,
    body: "",
    contentFormat: "text",
    metadata: {
      source: "google-drive",
      driveId: file.id,
      mimeType: file.mimeType,
      size: file.size,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      iconLink: file.iconLink
    },
    currentVersion: 1,
    createdAt: file.modifiedTime ?? new Date().toISOString(),
    updatedAt: file.modifiedTime ?? new Date().toISOString()
  };
}

export async function GET(request: Request) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json({ files: [] });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const pageToken = url.searchParams.get("pageToken") || "";
  const pageSize = url.searchParams.get("pageSize") || "50";

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
      return NextResponse.json({ files: [], nextPageToken: null });
    }

    const data = await response.json() as {
      files?: DriveFile[];
      nextPageToken?: string;
    };

    const files = (data.files || []).map(mapToWorkspaceFile);

    return NextResponse.json({
      files,
      nextPageToken: data.nextPageToken || null
    });
  } catch {
    return NextResponse.json({ files: [], nextPageToken: null });
  }
}
