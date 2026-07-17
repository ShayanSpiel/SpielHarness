import { resolveGoogleAccessToken } from "./auth.ts";
import { readToolInput, readToolNumber } from "./input.ts";
import type { HttpAdapter } from "./types.ts";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FIELDS = "id,name,mimeType,modifiedTime,webViewLink,parents";

type DriveFileInput = {
  name: string;
  mimeType: string;
  content: string;
  encoding: "utf8" | "base64";
  parentId?: string;
};

type DriveProjectFile = {
  path: string;
  mimeType: string;
  content?: string;
  encoding?: "utf8" | "base64";
};

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

function parseObject(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new Error("Google Drive write operations require structured JSON input.");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeRelativePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Google Drive project contains an unsafe path: "${value}".`);
  }
  return path;
}

async function driveJson(
  url: string,
  method: "POST" | "PATCH",
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Drive returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function createFolder(token: string, name: string, parentId?: string, signal?: AbortSignal) {
  return driveJson(`${DRIVE_BASE}?fields=${encodeURIComponent(DRIVE_FIELDS)}`, "POST", token, {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {})
  }, signal);
}

function fileBytes(input: DriveFileInput): string | ArrayBuffer {
  if (input.encoding === "utf8") return input.content;
  const decoded = Buffer.from(input.content, "base64");
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
}

async function uploadFile(
  token: string,
  input: DriveFileInput,
  fileId?: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const estimatedBytes = input.encoding === "base64" ? Math.ceil(input.content.length * 0.75) : Buffer.byteLength(input.content, "utf8");
  if (estimatedBytes > 5_000_000) throw new Error(`Google Drive file "${input.name}" exceeds the 5 MB adapter limit.`);
  const boundary = `spielos_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = {
    name: input.name,
    mimeType: input.mimeType,
    ...(input.parentId ? { parents: [input.parentId] } : {})
  };
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = new Blob([prefix, fileBytes(input), suffix], { type: `multipart/related; boundary=${boundary}` });
  const endpoint = fileId ? `${DRIVE_UPLOAD_BASE}/${encodeURIComponent(fileId)}` : DRIVE_UPLOAD_BASE;
  const url = new URL(endpoint);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", DRIVE_FIELDS);
  const response = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
    signal
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Drive returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function parseFileInput(body: Record<string, unknown>): DriveFileInput {
  const name = optionalString(body.name ?? body.fileName ?? body.path);
  if (!name) throw new Error("Google Drive file creation requires a name.");
  const content = typeof body.content === "string" ? body.content : "";
  const encoding = body.encoding === "base64" ? "base64" : "utf8";
  return {
    name: name.split("/").at(-1)!,
    mimeType: optionalString(body.mimeType ?? body.mime_type) ?? "text/plain",
    content,
    encoding,
    parentId: optionalString(body.parentId ?? body.parent_id)
  };
}

async function publishProject(token: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const rawProject = body.project && typeof body.project === "object" && !Array.isArray(body.project)
    ? body.project as Record<string, unknown>
    : body;
  const name = optionalString(rawProject.name);
  const rawFiles = rawProject.files;
  if (!name || !Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("Google Drive project publishing requires a project name and files array.");
  }
  if (rawFiles.length > 60) throw new Error("Google Drive project publishing is limited to 60 files.");
  const files: DriveProjectFile[] = rawFiles.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Google Drive project files must be objects.");
    const file = entry as Record<string, unknown>;
    const path = optionalString(file.path);
    const mimeType = optionalString(file.mimeType ?? file.mime_type);
    if (!path || !mimeType) throw new Error("Each Google Drive project file requires path and mimeType.");
    return {
      path: safeRelativePath(path),
      mimeType,
      content: typeof file.content === "string" ? file.content : "",
      encoding: file.encoding === "base64" ? "base64" : "utf8"
    };
  });

  const root = await createFolder(token, name, optionalString(body.parentFolderId ?? body.parent_folder_id), signal);
  const rootId = String(root.id ?? "");
  if (!rootId) throw new Error("Google Drive did not return an ID for the project folder.");
  const folderIds = new Map<string, string>([["", rootId]]);
  const directories = [...new Set(files.flatMap((file) => {
    const parts = file.path.split("/").slice(0, -1);
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }))].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const directory of directories) {
    const parts = directory.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    const created = await createFolder(token, parts.at(-1)!, folderIds.get(parentPath) ?? rootId, signal);
    const id = String(created.id ?? "");
    if (!id) throw new Error(`Google Drive did not return an ID for folder "${directory}".`);
    folderIds.set(directory, id);
  }

  const published: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const parts = file.path.split("/");
    const directory = parts.slice(0, -1).join("/");
    const uploaded = await uploadFile(token, {
      name: parts.at(-1)!,
      mimeType: file.mimeType,
      content: file.content ?? "",
      encoding: file.encoding ?? "utf8",
      parentId: folderIds.get(directory) ?? rootId
    }, undefined, signal);
    published.push({ path: file.path, id: uploaded.id, mimeType: uploaded.mimeType, webViewLink: uploaded.webViewLink });
  }
  return {
    kind: "drive_publish_receipt",
    project: name,
    root: { id: rootId, name: root.name, webViewLink: root.webViewLink },
    folders: [...folderIds.entries()].filter(([path]) => path).map(([path, id]) => ({ path, id })),
    files: published,
    createdCount: published.length + folderIds.size,
    completedAt: new Date().toISOString()
  };
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

    if (req.operation.id === "drive.createFolder") {
      const body = parseObject(req.input);
      const name = optionalString(body.name);
      if (!name) throw new Error("Google Drive folder creation requires a name.");
      const result = await createFolder(token, name, optionalString(body.parentId ?? body.parent_id), req.signal);
      return { output: JSON.stringify({ kind: "drive_write_receipt", action: "create_folder", file: result }, null, 2) };
    }

    if (req.operation.id === "drive.createFile") {
      const result = await uploadFile(token, parseFileInput(parseObject(req.input)), undefined, req.signal);
      return { output: JSON.stringify({ kind: "drive_write_receipt", action: "create_file", file: result }, null, 2) };
    }

    if (req.operation.id === "drive.updateFile") {
      const body = parseObject(req.input);
      const fileId = optionalString(body.fileId ?? body.file_id ?? body.id);
      if (!fileId) throw new Error("Google Drive file update requires a fileId.");
      const result = await uploadFile(token, parseFileInput(body), fileId, req.signal);
      return { output: JSON.stringify({ kind: "drive_write_receipt", action: "update_file", file: result }, null, 2) };
    }

    if (req.operation.id === "drive.publishProject") {
      const result = await publishProject(token, parseObject(req.input), req.signal);
      return { output: JSON.stringify(result, null, 2) };
    }

    throw new Error(`Unknown Google Drive operation: "${req.operation.id}".`);
  }
};
