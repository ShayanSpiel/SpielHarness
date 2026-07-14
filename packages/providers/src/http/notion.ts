import { decryptConnectionSecret } from "./auth.ts";
import type { HttpAdapter } from "./types.ts";

function resolveNotionToken(
  connectionId: string,
  config: Record<string, unknown>
): string {
  const encrypted = config.oauthCredential;
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error(`Connection "${connectionId}" has no OAuth credential.`);
  }
  const credential = decryptConnectionSecret(encrypted) as {
    accessToken?: string;
  };
  if (!credential.accessToken) {
    throw new Error(
      `Connection "${connectionId}" is missing an access token. Reconnect the account.`
    );
  }
  return credential.accessToken;
}

async function notionRequest(
  path: string,
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Notion returned HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }
  return text;
}

export const notionAdapter: HttpAdapter = {
  async execute(req) {
    const token = resolveNotionToken(req.connection.id, req.connection.config);

    switch (req.operation.id) {
      case "notion.search": {
        const body = { query: req.input.slice(0, 2000) };
        const raw = await notionRequest("/search", "POST", token, body);
        return { output: raw };
      }
      case "notion.read": {
        const pageId = req.input.trim();
        if (!pageId) throw new Error("Notion page ID is required.");
        const raw = await notionRequest(`/pages/${pageId}`, "GET", token);
        return { output: raw };
      }
      case "notion.create": {
        const body = JSON.parse(req.input) as Record<string, unknown>;
        const raw = await notionRequest("/pages", "POST", token, body);
        return { output: raw };
      }
      case "notion.update": {
        const body = JSON.parse(req.input) as Record<string, unknown>;
        const pageId = body.page_id as string;
        if (!pageId) throw new Error("Notion update requires a page_id.");
        const { page_id, ...properties } = body;
        const raw = await notionRequest(
          `/pages/${pageId}`,
          "PATCH",
          token,
          properties
        );
        return { output: raw };
      }
      default:
        throw new Error(`Unknown Notion operation: "${req.operation.id}".`);
    }
  },
};
