import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callDriveTool, type DriveToolName } from "../../../../lib/drive-mcp-client";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("google_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { tool?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tool, args = {} } = body;

  if (!tool) {
    return NextResponse.json({ error: "Missing tool name" }, { status: 400 });
  }

  const allowedTools: DriveToolName[] = [
    "search_files",
    "read_file_content",
    "get_file_metadata",
    "list_recent_files"
  ];

  if (!allowedTools.includes(tool as DriveToolName)) {
    return NextResponse.json(
      { error: `Tool '${tool}' is not allowed. Allowed: ${allowedTools.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await callDriveTool(
      accessToken,
      tool as DriveToolName,
      args
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error(`MCP tool '${tool}' failed:`, err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "MCP tool call failed"
      },
      { status: 500 }
    );
  }
}
