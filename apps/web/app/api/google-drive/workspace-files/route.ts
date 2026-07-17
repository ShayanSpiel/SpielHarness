import { NextResponse } from "next/server";
import { resolveGoogleDriveAccess } from "../../../../lib/google-drive";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
}

function mapToWorkspaceFile(file: DriveFile, orgId: string): {
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
    orgId,
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
  const access = await resolveGoogleDriveAccess();
  if (!access) {
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
      headers: { Authorization: `Bearer ${access.accessToken}` }
    });

    if (!response.ok) {
      return NextResponse.json({ files: [], nextPageToken: null });
    }

    const data = await response.json() as {
      files?: DriveFile[];
      nextPageToken?: string;
    };

    const files = (data.files || []).map((file) => mapToWorkspaceFile(file, access.orgId));

    return NextResponse.json({
      files,
      nextPageToken: data.nextPageToken || null
    });
  } catch {
    return NextResponse.json({ files: [], nextPageToken: null });
  }
}
