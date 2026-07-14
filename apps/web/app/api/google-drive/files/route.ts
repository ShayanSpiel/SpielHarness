import { NextResponse } from "next/server";
import { resolveGoogleDriveAccess } from "../../../../lib/google-drive";

export async function GET(request: Request) {
  const access = await resolveGoogleDriveAccess();
  if (!access) {
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
      headers: { Authorization: `Bearer ${access.accessToken}` }
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
