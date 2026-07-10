import { errorResponse } from "../../../lib/server";

function configured(name: string) {
  return Boolean(process.env[name]);
}

export async function GET() {
  try {
    return Response.json({
      integrations: [
        {
          id: "mistral",
          name: "Mistral",
          kind: "model_provider",
          status: configured("MISTRAL_API_KEY") ? "configured" : "missing_secret",
          secret: configured("MISTRAL_API_KEY") ? "redacted" : null,
          operations: ["chat.completions"],
          baseUrl: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1"
        },
        {
          id: "google-drive-mcp",
          name: "Google Drive MCP",
          kind: "mcp_server",
          status: configured("GOOGLE_CLIENT_ID") && configured("GOOGLE_CLIENT_SECRET") ? "configured" : "missing_secret",
          secret: configured("GOOGLE_CLIENT_SECRET") ? "redacted" : null,
          operations: ["drive.search", "drive.read"],
          baseUrl: null
        }
      ]
    });
  } catch (err) {
    return errorResponse(err);
  }
}
