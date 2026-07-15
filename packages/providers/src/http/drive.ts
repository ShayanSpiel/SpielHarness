import { resolveGoogleAccessToken } from "./auth.ts";
import { readToolInput, readToolNumber } from "./input.ts";
import type { HttpAdapter } from "./types.ts";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

async function driveGet(path: string, token: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  const url = new URL(`${DRIVE_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(`Google Drive returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export const driveAdapter: HttpAdapter = {
  async execute(req) {
    const token = await resolveGoogleAccessToken(req.connection.id, req.connection.config);
    if (req.operation.id === "drive.list" || req.operation.id === "drive.search") {
      const query = readToolInput(req.input, ["query", "q", "name"]);
      const params: Record<string, string> = {
        pageSize: String(readToolNumber(req.input, ["maxResults", "max_results", "limit", "pageSize"], 10, { max: 25 })),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))"
      };
      if (req.operation.id === "drive.search" && query) {
        const escaped = escapeDriveQuery(query);
        params.q = `trashed = false and (name contains '${escaped}' or fullText contains '${escaped}')`;
      } else {
        params.q = "trashed = false";
      }
      const response = await driveGet("", token, params, req.signal);
      return { output: await response.text() };
    }

    if (req.operation.id === "drive.read") {
      const fileId = readToolInput(req.input, ["fileId", "file_id", "id"]);
      if (!fileId) throw new Error("Google Drive read requires a file ID.");
      const metadataResponse = await driveGet(`/${encodeURIComponent(fileId)}`, token, {
        fields: "id,name,mimeType,modifiedTime,webViewLink"
      }, req.signal);
      const metadata = await metadataResponse.json() as { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string };
      const exportMime = metadata.mimeType === "application/vnd.google-apps.spreadsheet"
        ? "text/csv"
        : metadata.mimeType.startsWith("application/vnd.google-apps.")
          ? "text/plain"
          : null;
      const contentResponse = exportMime
        ? await driveGet(`/${encodeURIComponent(fileId)}/export`, token, { mimeType: exportMime }, req.signal)
        : await driveGet(`/${encodeURIComponent(fileId)}`, token, { alt: "media" }, req.signal);
      const content = (await contentResponse.text()).slice(0, 50_000);
      return { output: JSON.stringify({ ...metadata, content }, null, 2) };
    }

    throw new Error(`Unknown Google Drive operation: "${req.operation.id}".`);
  }
};
