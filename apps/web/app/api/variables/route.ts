import {
  createWorkspaceVariable,
  deleteWorkspaceVariable,
  listWorkspaceVariables
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireAdmin, requireWrite } from "../../../lib/server";

function toClient(row: {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  value: string | null;
  description: string;
  enabled: boolean;
}) {
  const secret = row.kind === "secret_ref";
  const envKey = secret && typeof row.value === "string" ? row.value : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    value: secret ? null : row.value,
    envKey,
    configured: secret ? Boolean(envKey && process.env[envKey]) : true,
    description: row.description,
    enabled: row.enabled
  };
}

export async function GET() {
  try {
    const org = await getOrg();
    const variables = await listWorkspaceVariables(org.sql, org.orgId);
    return Response.json({ variables: variables.map(toClient) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = (await request.json()) as {
      name: string;
      kind?: "variable" | "secret_ref";
      value?: string | null;
      envKey?: string | null;
      description?: string;
      enabled?: boolean;
    };
    if (!body.name) throw new HttpError(400, "name is required");
    const value = body.kind === "secret_ref" ? body.envKey ?? null : body.value ?? null;
    const row = await createWorkspaceVariable(org.sql, org.orgId, {
      name: body.name,
      kind: body.kind ?? "variable",
      value,
      description: body.description ?? "",
      enabled: body.enabled ?? true
    });
    return Response.json({ variable: toClient(row) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireAdmin(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "id is required");
    const ok = await deleteWorkspaceVariable(org.sql, org.orgId, id);
    if (!ok) throw new HttpError(404, "Variable not found");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
