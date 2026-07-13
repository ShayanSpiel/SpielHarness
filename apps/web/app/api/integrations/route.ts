import {
  listConnections,
  softDeleteConnection,
  updateConnection,
  upsertConnection
} from "@spielos/db";
import type { Connection } from "@spielos/core";
import { errorResponse, getOrg, HttpError, requireAdmin, requireWrite } from "../../../lib/server";
import { loadIntegrationCatalog, type IntegrationPreset } from "../../../lib/integration-catalog";

function parseOperations(
  raw: unknown
): Connection["operations"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o: Record<string, unknown>) => ({
    id: String(o.id ?? ""),
    label: o.label as string | undefined,
    effect: (o.effect as Connection["operations"][number]["effect"]) ?? "read",
    method: o.method as string | undefined,
    path: o.path as string | undefined,
    inputParam: o.inputParam as string | undefined
  }));
}

function toClient(row: {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  status: string;
  base_url: string | null;
  secret_env_key: string | null;
  config: Record<string, unknown>;
  operations: unknown;
  enabled: boolean;
}, catalog: IntegrationPreset[] = []) {
  const secretEnvKey = typeof row.secret_env_key === "string" ? row.secret_env_key : null;
  const secretReady = !secretEnvKey || Boolean(process.env[secretEnvKey]);
  const config = (row.config ?? {}) as Record<string, unknown>;
  const preset = typeof config.presetId === "string"
    ? catalog.find((item) => item.id === config.presetId)
    : undefined;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.enabled === false ? "disabled" : secretReady ? row.status : "needs_secret",
    baseUrl: row.base_url,
    secretEnvKey,
    secretConfigured: secretEnvKey ? secretReady : null,
    operations: parseOperations(row.operations),
    logo: typeof config.logo === "string" ? config.logo : preset?.logo ?? null,
    account: typeof config.account === "string" ? config.account : null,
    enabled: row.enabled !== false
  };
}

export async function GET() {
  const rawCatalog = await loadIntegrationCatalog().catch(() => [] as IntegrationPreset[]);
  const presets = rawCatalog.map((preset) => ({
    ...preset,
    oauthReady: preset.kind !== "oauth" || (preset.id === "notion"
      ? Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET)
      : Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET))
  }));
  try {
    const org = await getOrg();
    const connections = await listConnections(org.sql, org.orgId);
    return Response.json({ integrations: connections.map((row) => toClient(row, rawCatalog)), presets });
  } catch {
    return Response.json({ integrations: [], presets, setupRequired: true });
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = (await request.json()) as {
      presetId?: string;
      name: string;
      kind: string;
      status?: string;
      baseUrl?: string | null;
      secretEnvKey?: string | null;
      config?: Record<string, unknown>;
      operations?: Array<Record<string, unknown>>;
      enabled?: boolean;
    };
    const catalog = body.presetId ? await loadIntegrationCatalog() : [];
    const preset = body.presetId
      ? catalog.find((item) => item.id === body.presetId)
      : undefined;
    if (body.presetId && !preset) throw new HttpError(400, "Unknown integration preset");
    if (!preset && !body.name) throw new HttpError(400, "name is required");
    const row = await upsertConnection(org.sql, org.orgId, {
      name: preset?.name ?? body.name,
      kind: preset?.kind ?? body.kind ?? "api",
      status: body.status,
      baseUrl: preset?.baseUrl ?? body.baseUrl ?? null,
      secretEnvKey: preset?.secretEnvKey ?? body.secretEnvKey ?? null,
      config: preset
        ? {
            presetId: preset.id,
            icon: preset.icon,
            logo: preset.logo,
            description: preset.description,
          }
        : body.config ?? {},
      operations: preset?.operations ?? body.operations ?? [],
      enabled: body.enabled ?? true
    });
    return Response.json({ integration: toClient(row) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = (await request.json()) as {
      id: string;
      name?: string;
      kind?: string;
      baseUrl?: string | null;
      secretEnvKey?: string | null;
      operations?: Array<Record<string, unknown>>;
      enabled?: boolean;
    };
    if (!body.id) throw new HttpError(400, "id is required");
    const row = await updateConnection(org.sql, org.orgId, body.id, {
      name: body.name,
      kind: body.kind,
      baseUrl: body.baseUrl,
      secretEnvKey: body.secretEnvKey,
      operations: body.operations,
      enabled: body.enabled
    });
    if (!row) throw new HttpError(404, "Connection not found");
    return Response.json({ integration: toClient(row) });
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
    const ok = await softDeleteConnection(org.sql, org.orgId, id);
    if (!ok) throw new HttpError(404, "Connection not found");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
