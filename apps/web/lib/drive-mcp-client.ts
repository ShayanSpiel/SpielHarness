import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";

const DRIVE_MCP_URL = "https://drivemcp.googleapis.com/mcp/v1";

let clientInstance: Client | null = null;
let currentToken: string | null = null;

export async function getDriveMcpClient(accessToken: string) {
  if (clientInstance && currentToken === accessToken) {
    return clientInstance;
  }

  if (clientInstance) {
    try {
      await clientInstance.close();
    } catch {
      // ignore close errors
    }
    clientInstance = null;
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(DRIVE_MCP_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    }
  );

  const client = new Client(
    { name: "spielos-drive-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  clientInstance = client;
  currentToken = accessToken;

  return client;
}

export type DriveToolName =
  | "search_files"
  | "read_file_content"
  | "download_file_content"
  | "get_file_metadata"
  | "get_file_permissions"
  | "list_recent_files"
  | "create_file"
  | "copy_file";

export async function callDriveTool(
  accessToken: string,
  tool: DriveToolName,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = await getDriveMcpClient(accessToken);
  const result = await client.callTool({ name: tool, arguments: args });
  return result as Record<string, unknown>;
}
