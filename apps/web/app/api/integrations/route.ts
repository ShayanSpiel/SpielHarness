import { getOrg, errorResponse, requireWrite } from "../../../lib/server";
import {
  listConnections,
  upsertConnection,
  softDeleteConnection,
} from "@spielos/db";
import { loadIntegrationCatalog } from "../../../lib/integration-catalog";
import { decryptConnectionSecret } from "../../../lib/connection-secrets";

type CredentialHealth = "ready" | "missing" | "corrupted" | null;

function credentialHealth(kind: string, config: Record<string, unknown>): CredentialHealth {
  if (kind !== "oauth") return null;
  const encrypted = config.oauthCredential;
  if (typeof encrypted !== "string" || encrypted.length === 0) return "missing";
  try {
    const credential = decryptConnectionSecret(encrypted);
    return typeof credential.accessToken === "string" && credential.accessToken.length > 0 ? "ready" : "missing";
  } catch {
    return "corrupted";
  }
}

function publicConnection(connection: Awaited<ReturnType<typeof listConnections>>[number]) {
  const { oauthCredential: _secret, ...safeConfig } = connection.config;
  void _secret;
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    status: connection.status,
    baseUrl: connection.base_url,
    secretEnvKey: connection.secret_env_key,
    config: safeConfig,
    operations: connection.operations,
    enabled: connection.enabled,
    account: typeof safeConfig.account === "string" ? safeConfig.account : null,
    credentialHealth: credentialHealth(connection.kind, connection.config),
    secretConfigured: computeSecretConfigured(connection.secret_env_key),
  };
}

function computeSecretConfigured(secretEnvKey: string | null): boolean | null {
  return secretEnvKey ? Boolean(process.env[secretEnvKey]) : null;
}

function computeOAuthReady(preset: { id: string; kind: string }): boolean | undefined {
  if (preset.kind !== "oauth") return undefined;
  if (preset.id === "notion") return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET);
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function GET() {
  try {
    const org = await getOrg();
    const connections = await listConnections(org.sql, org.orgId);
    const presets = await loadIntegrationCatalog();
    return Response.json({
      integrations: connections.map(publicConnection),
      presets: presets.map((p) => ({
        ...p,
        oauthReady: computeOAuthReady(p),
      })),
      setupRequired: false,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const body = await request.json();

    if (body.presetId) {
      const presets = await loadIntegrationCatalog();
      const preset = presets.find((p) => p.id === body.presetId);
      if (!preset) return Response.json({ error: "Unknown preset" }, { status: 400 });
      if (preset.availability === "unavailable") {
        return Response.json({ error: preset.unavailableReason ?? `${preset.name} is not available in this runtime.` }, { status: 409 });
      }
      const status = preset.secretEnvKey && !process.env[preset.secretEnvKey]
        ? "needs_secret"
        : "configured";
      const conn = await upsertConnection(org.sql, org.orgId, {
        name: preset.name,
        kind: preset.kind,
        status,
        baseUrl: preset.baseUrl ?? null,
        secretEnvKey: preset.secretEnvKey ?? null,
        config: { presetId: preset.id, icon: preset.icon, logo: preset.logo, description: preset.description },
        operations: preset.operations as unknown as Array<Record<string, unknown>>,
        enabled: true,
      });
      return Response.json({
        integration: {
          ...publicConnection(conn),
        },
      }, { status: 201 });
    }

    if (!body.name) return Response.json({ error: "Name is required" }, { status: 400 });
    const secretEnvKey = body.secretEnvKey ?? null;
    const status = secretEnvKey && !process.env[secretEnvKey] ? "needs_secret" : "configured";
    const conn = await upsertConnection(org.sql, org.orgId, {
      name: body.name,
      kind: body.kind ?? "api",
      status,
      baseUrl: body.baseUrl ?? null,
      secretEnvKey,
      config: {},
      operations: body.operations ?? [],
      enabled: true,
    });
    return Response.json({
      integration: {
        ...publicConnection(conn),
      },
    }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    await softDeleteConnection(org.sql, org.orgId, id);
    return Response.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
