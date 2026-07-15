import {
  createModel,
  deleteModel,
  updateModel
} from "@spielos/db";
import type { Model, ModelProvider } from "@spielos/core";
import { errorResponse, getOrg, HttpError, requireAdmin } from "../../../lib/server";
import { listModelsWithEnvironmentDefaults } from "../../../lib/default-models";

const ALLOWED_PROVIDERS = ["mistral", "openai", "anthropic", "openai-compatible"];

function safeEnvironmentKey(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Z_][A-Z0-9_]*$/.test(value) ? value : null;
}

function toClient(row: {
  id: string;
  org_id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string | null;
  secret_env_key: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
}): Model {
  const allowed = ["mistral", "openai", "anthropic", "openai-compatible"] as const;
  const provider = (allowed.find((k) => k === row.provider) ?? "openai-compatible") as ModelProvider["provider"];
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    provider,
    model: row.model,
    baseUrl: row.base_url,
    // Never echo a legacy row that accidentally stored a credential value.
    secretEnvKey: safeEnvironmentKey(row.secret_env_key),
    config: row.config ?? {},
    enabled: row.enabled
  };
}

export async function GET() {
  try {
    const org = await getOrg();
    const models = await listModelsWithEnvironmentDefaults(org.sql, org.orgId);
    return Response.json({ models: models.map(toClient) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireAdmin(org);
    const body = (await request.json()) as {
      id?: string;
      name: string;
      provider: string;
      model: string;
      baseUrl?: string | null;
      secretEnvKey?: string | null;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };
    if (!body.name || !body.provider || !body.model) {
      throw new HttpError(400, "name, provider, and model are required");
    }
    if (!ALLOWED_PROVIDERS.includes(body.provider)) {
      throw new HttpError(400, "unsupported provider");
    }
    if (body.secretEnvKey && !safeEnvironmentKey(body.secretEnvKey)) {
      throw new HttpError(400, "secretEnvKey must be an environment variable name, not a credential value");
    }
    const row = await createModel(org.sql, org.orgId, {
      id: body.id,
      name: body.name,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl ?? null,
      secretEnvKey: body.secretEnvKey ?? null,
      config: body.config ?? {},
      enabled: body.enabled ?? true
    });
    return Response.json({ model: toClient(row) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const org = await getOrg();
    requireAdmin(org);
    const body = (await request.json()) as {
      id: string;
      name?: string;
      provider?: string;
      model?: string;
      baseUrl?: string | null;
      secretEnvKey?: string | null;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };
    if (!body.id) throw new HttpError(400, "id is required");
    if (body.provider !== undefined && !ALLOWED_PROVIDERS.includes(body.provider)) {
      throw new HttpError(400, "unsupported provider");
    }
    if (body.secretEnvKey && !safeEnvironmentKey(body.secretEnvKey)) {
      throw new HttpError(400, "secretEnvKey must be an environment variable name, not a credential value");
    }
    const row = await updateModel(org.sql, org.orgId, body.id, {
      name: body.name,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      secretEnvKey: body.secretEnvKey,
      config: body.config,
      enabled: body.enabled
    });
    if (!row) throw new HttpError(404, "Model not found");
    return Response.json({ model: toClient(row) });
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
    const ok = await deleteModel(org.sql, org.orgId, id);
    if (!ok) throw new HttpError(404, "Model not found");
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
