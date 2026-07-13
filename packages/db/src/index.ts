import postgres from "postgres";
import { randomUUID } from "node:crypto";

type JsonInput = Record<string, unknown> | unknown[] | string | number | boolean | null;
type PostgresParameter = postgres.SerializableParameter<never>;
function toJson(value: JsonInput): PostgresParameter {
  return value as unknown as PostgresParameter;
}
export const json = toJson;

export type Sql = ReturnType<typeof postgres>;

export function createSql(connectionString: string): Sql {
  const parsed = new URL(connectionString);
  const projectRef = parsed.searchParams.get("host");
  const ssl: Record<string, unknown> = { rejectUnauthorized: false };
  const connection: Record<string, string> = {};
  if (projectRef) {
    ssl.servername = projectRef;
    connection.host = projectRef;
  }
  const opts: Record<string, unknown> = {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: true,
    ssl,
    connection,
    transform: { undefined: null }
  };
  return postgres(connectionString, opts as any);
}

export type OrgContext = {
  sql: Sql;
  orgId: string;
  isDemo: boolean;
};

export function createOrgSql(sql: Sql, orgId: string, isDemo = false): OrgContext {
  return { sql, orgId, isDemo };
}

export type FileRow = {
  id: string;
  org_id: string;
  folder_id: string | null;
  file_type: string;
  status: string;
  title: string;
  body: string;
  content_format: string;
  metadata: Record<string, unknown>;
  current_version: number;
  created_at: string;
  updated_at: string;
};

export async function listHarnessFiles(sql: Sql, orgId: string): Promise<FileRow[]> {
  return sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status, title, body, content_format,
           metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId}
      and deleted_at is null
      and file_type in (
        'knowledge','strategy','prompt','artifact','draft','evidence','asset',
        'eval_report','publish_package',
        'harness_role','harness_skill','harness_workflow','harness_workstream','harness_eval',
        'harness_template','harness_chat_message'
      )
    order by updated_at desc
  `;
}

export async function getFile(sql: Sql, orgId: string, id: string): Promise<FileRow | null> {
  const rows = await sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status, title, body, content_format,
           metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getFilesByIds(sql: Sql, orgId: string, ids: string[]): Promise<FileRow[]> {
  if (ids.length === 0) return [];
  return sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status, title, body, content_format,
           metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId} and id = any(${ids}) and deleted_at is null
  `;
}

export async function getFilesBySlugs(
  sql: Sql,
  orgId: string,
  refs: string[]
): Promise<Map<string, FileRow>> {
  const out = new Map<string, FileRow>();
  if (refs.length === 0) return out;
  const rows = await sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status, title, body, content_format,
           metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId}
      and deleted_at is null
      and (id::text = any(${refs}) or metadata ->> 'slug' = any(${refs}))
  `;
  for (const row of rows) {
    out.set(row.id, row);
    const slug = row.metadata?.slug;
    if (typeof slug === "string") out.set(slug, row);
  }
  return out;
}

export type CreateFileInput = {
  id?: string;
  title: string;
  body: string;
  fileType: string;
  status?: string;
  folderId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function createFile(
  sql: Sql,
  orgId: string,
  input: CreateFileInput
): Promise<FileRow> {
  const rows = await sql<FileRow[]>`
    insert into files (id, org_id, folder_id, file_type, status, title, body, content_format, metadata)
    values (
      ${input.id ?? sql`DEFAULT`},
      ${orgId},
      ${input.folderId ?? null},
      ${input.fileType},
      ${input.status ?? "draft"},
      ${input.title},
      ${input.body},
      'markdown',
      ${json(input.metadata ?? {})}
    )
    on conflict (id) do nothing
    returning id, org_id, folder_id, file_type, status, title, body, content_format,
              metadata, current_version, created_at, updated_at
  `;
  if (rows[0]) return rows[0];
  if (input.id) {
    const existing = await getFile(sql, orgId, input.id);
    if (existing) return existing;
    throw new Error("File id belongs to another workspace.");
  }
  throw new Error("File could not be created.");
}

export type UpdateFileInput = {
  title?: string;
  body?: string;
  fileType?: string;
  status?: string;
  folderId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function updateFile(
  sql: Sql,
  orgId: string,
  id: string,
  patch: UpdateFileInput
): Promise<FileRow> {
  const rows = await sql<FileRow[]>`
    update files
    set title = coalesce(${patch.title ?? null}, title),
        body = coalesce(${patch.body ?? null}, body),
        file_type = coalesce(${patch.fileType ?? null}, file_type),
        status = coalesce(${patch.status ?? null}, status),
        folder_id = ${patch.folderId === undefined ? sql`folder_id` : patch.folderId},
        metadata = ${patch.metadata === undefined ? sql`metadata` : json(patch.metadata)}
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    returning id, org_id, folder_id, file_type, status, title, body, content_format,
              metadata, current_version, created_at, updated_at
  `;
  if (rows.length === 0) throw new Error("File not found or already deleted");
  return rows[0];
}

export async function softDeleteFile(sql: Sql, orgId: string, id: string): Promise<boolean> {
  const rows = await sql`
    update files
    set status = 'deleted', deleted_at = now()
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function fileHasIncomingReferences(
  sql: Sql,
  orgId: string,
  fileId: string
): Promise<boolean> {
  const rows = await sql`
    select 1 from file_relations
    where org_id = ${orgId} and target_file_id = ${fileId}
    limit 1
  `;
  return rows.length > 0;
}

export type RunRow = {
  id: string;
  org_id: string;
  chat_id: string | null;
  workflow_id: string | null;
  type: string;
  prompt: string;
  status: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  human_inputs: Record<string, unknown>;
  state: Record<string, unknown>;
  definition_snapshot: Record<string, unknown>;
  idempotency_key: string | null;
  error: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function findRunByIdempotency(
  sql: Sql,
  orgId: string,
  key: string
): Promise<RunRow | null> {
  const rows = await sql<RunRow[]>`
    select id, org_id, chat_id, workflow_id, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           created_at, updated_at, completed_at
    from runs
    where org_id = ${orgId} and idempotency_key = ${key}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createRun(
  sql: Sql,
  orgId: string,
  data: {
    id?: string;
    chatId?: string | null;
    workflowId?: string | null;
    type: string;
    prompt: string;
    inputs: Record<string, unknown>;
    definitionSnapshot: Record<string, unknown>;
    idempotencyKey?: string | null;
    requestedBy?: string | null;
  }
): Promise<RunRow> {
  const rows = await sql<RunRow[]>`
    insert into runs (id, org_id, chat_id, workflow_id, type, prompt, status, inputs,
                      definition_snapshot, idempotency_key, requested_by)
    values (
      ${data.id ?? sql`DEFAULT`}, ${orgId}, ${data.chatId ?? null}, ${data.workflowId ?? null},
      ${data.type}, ${data.prompt}, 'running',
      ${json(data.inputs)}, ${json(data.definitionSnapshot)},
      ${data.idempotencyKey ?? null}, ${data.requestedBy ?? null}
    )
    returning id, org_id, chat_id, workflow_id, type,
              prompt, status, inputs, outputs, human_inputs, state,
              definition_snapshot, idempotency_key, error, requested_by,
              created_at, updated_at, completed_at
  `;
  return rows[0];
}

export async function updateRun(
  sql: Sql,
  orgId: string,
  runId: string,
  patch: {
    status?: string;
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    humanInputs?: Record<string, unknown>;
    state?: Record<string, unknown>;
    error?: string | null;
    completedAt?: string | null;
  }
): Promise<void> {
  await sql`
    update runs
    set status = coalesce(${patch.status ?? null}, status),
        inputs = ${patch.inputs === undefined ? sql`inputs` : json(patch.inputs)},
        outputs = ${patch.outputs === undefined ? sql`outputs` : json(patch.outputs)},
        human_inputs = ${patch.humanInputs === undefined ? sql`human_inputs` : json(patch.humanInputs)},
        state = ${patch.state === undefined ? sql`state` : json(patch.state)},
        error = ${patch.error === undefined ? sql`error` : patch.error},
        completed_at = ${patch.completedAt === undefined ? sql`completed_at` : patch.completedAt}
    where org_id = ${orgId} and id = ${runId}
  `;
}

export async function getRun(sql: Sql, orgId: string, runId: string): Promise<RunRow | null> {
  const rows = await sql<RunRow[]>`
    select id, org_id, chat_id, workflow_id, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           created_at, updated_at, completed_at
    from runs
    where org_id = ${orgId} and id = ${runId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listRuns(sql: Sql, orgId: string, limit = 50): Promise<RunRow[]> {
  return sql<RunRow[]>`
    select id, org_id, chat_id, workflow_id, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           created_at, updated_at, completed_at
    from runs
    where org_id = ${orgId}
    order by created_at desc
    limit ${limit}
  `;
}

export type RunEventRow = {
  id: string;
  org_id: string;
  run_id: string;
  event_type: string;
  sequence: number;
  node_id: string | null;
  node_title: string | null;
  skill_id: string | null;
  skill_name: string | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export async function listRunEvents(
  sql: Sql,
  orgId: string,
  runId: string
): Promise<RunEventRow[]> {
  return sql<RunEventRow[]>`
    select * from run_events
    where org_id = ${orgId} and run_id = ${runId}
    order by sequence asc
  `;
}

export async function nextRunEventSequence(
  sql: Sql,
  orgId: string,
  runId: string
): Promise<number> {
  const rows = await sql<{ next: number }[]>`
    select coalesce(max(sequence) + 1, 1)::bigint as next
    from run_events
    where org_id = ${orgId} and run_id = ${runId}
  `;
  return Number(rows[0]?.next ?? 1);
}

export type RunEventInput = {
  event_type: string;
  node_id: string | null;
  node_title: string | null;
  skill_id: string | null;
  skill_name: string | null;
  message: string;
  payload: Record<string, unknown>;
};

export async function appendRunEvents(
  sql: Sql,
  orgId: string,
  runId: string,
  events: RunEventInput[]
): Promise<RunEventRow[]> {
  if (events.length === 0) return [];
  const startSeq = await nextRunEventSequence(sql, orgId, runId);
  const out: RunEventRow[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const rows = await sql<RunEventRow[]>`
      insert into run_events (org_id, run_id, event_type, sequence, node_id, node_title, skill_id, skill_name, message, payload)
      values (${orgId}, ${runId}, ${e.event_type}, ${startSeq + i}, ${e.node_id}, ${e.node_title}, ${e.skill_id}, ${e.skill_name}, ${e.message}, ${json(e.payload)})
      returning *
    `;
    if (rows[0]) out.push(rows[0]);
  }
  return out;
}

export type ChatRow = {
  id: string;
  org_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ChatMessageRow = {
  id: string;
  org_id: string;
  chat_id: string;
  role: string;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function listChats(sql: Sql, orgId: string): Promise<ChatRow[]> {
  return sql<ChatRow[]>`
    select * from chats
    where org_id = ${orgId} and archived_at is null
    order by updated_at desc
    limit 100
  `;
}

export async function listChatMessages(
  sql: Sql,
  orgId: string,
  chatId: string
): Promise<ChatMessageRow[]> {
  return sql<ChatMessageRow[]>`
    select * from chat_messages
    where org_id = ${orgId} and chat_id = ${chatId}
    order by created_at asc
  `;
}

export async function createChat(
  sql: Sql,
  orgId: string,
  id: string,
  title: string
): Promise<ChatRow> {
  const inserted = await sql<ChatRow[]>`
    insert into chats (id, org_id, title)
    values (${id}, ${orgId}, ${title})
    on conflict (id) do nothing
    returning *
  `;
  if (inserted[0]) return inserted[0];
  const rows = await sql<ChatRow[]>`
    select * from chats
    where id = ${id} and org_id = ${orgId}
    limit 1
  `;
  if (!rows[0]) throw new Error("Chat id belongs to another workspace.");
  return rows[0];
}

export async function touchChat(sql: Sql, orgId: string, chatId: string): Promise<void> {
  await sql`update chats set updated_at = now() where org_id = ${orgId} and id = ${chatId}`;
}

export async function appendChatMessage(
  sql: Sql,
  orgId: string,
  chatId: string,
  role: string,
  body: string,
  metadata: Record<string, unknown> = {}
): Promise<ChatMessageRow> {
  const rows = await sql<ChatMessageRow[]>`
    insert into chat_messages (org_id, chat_id, role, body, metadata)
    values (${orgId}, ${chatId}, ${role}, ${body}, ${json(metadata)})
    returning *
  `;
  await sql`update chats set updated_at = now() where org_id = ${orgId} and id = ${chatId}`;
  return rows[0];
}

export async function appendChatMessages(
  sql: Sql,
  orgId: string,
  chatId: string,
  messages: Array<{ role: string; body: string; metadata?: Record<string, unknown> }>
): Promise<ChatMessageRow[]> {
  if (messages.length === 0) return [];
  const out: ChatMessageRow[] = [];
  for (const m of messages) {
    const rows = await sql<ChatMessageRow[]>`
      insert into chat_messages (org_id, chat_id, role, body, metadata)
      values (${orgId}, ${chatId}, ${m.role}, ${m.body}, ${json(m.metadata ?? {})})
      returning *
    `;
    if (rows[0]) out.push(rows[0]);
  }
  await sql`update chats set updated_at = now() where org_id = ${orgId} and id = ${chatId}`;
  return out;
}

export type ModelRow = {
  id: string;
  org_id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string | null;
  secret_env_key: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
};

export async function listModels(sql: Sql, orgId: string): Promise<ModelRow[]> {
  return sql<ModelRow[]>`
    select id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
    from models
    where org_id = ${orgId}
    order by name asc
  `;
}

export async function getFirstEnabledModel(
  sql: Sql,
  orgId: string,
  preferredModelId?: string | null
): Promise<ModelRow | null> {
  if (preferredModelId) {
    const rows = await sql<ModelRow[]>`
      select id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
      from models
      where org_id = ${orgId} and id = ${preferredModelId} and enabled = true
      limit 1
    `;
    if (rows[0]) return rows[0];
  }
  const rows = await sql<ModelRow[]>`
    select id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
    from models
    where org_id = ${orgId} and enabled = true
    order by created_at asc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createModel(
  sql: Sql,
  orgId: string,
  data: {
    id?: string;
    name: string;
    provider: string;
    model: string;
    baseUrl?: string | null;
    secretEnvKey?: string | null;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }
): Promise<ModelRow> {
  const rows = await sql<ModelRow[]>`
    insert into models (id, org_id, name, provider, model, base_url, secret_env_key, config, enabled)
    values (${data.id ?? sql`DEFAULT`}, ${orgId}, ${data.name}, ${data.provider}, ${data.model},
            ${data.baseUrl ?? null}, ${data.secretEnvKey ?? null},
            ${json(data.config ?? {})}, ${data.enabled ?? true})
    returning id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
  `;
  return rows[0];
}

export async function updateModel(
  sql: Sql,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    provider?: string;
    model?: string;
    enabled?: boolean;
    baseUrl?: string | null;
    secretEnvKey?: string | null;
    config?: Record<string, unknown>;
  }
): Promise<ModelRow | null> {
  const rows = await sql<ModelRow[]>`
    update models
    set name = coalesce(${patch.name ?? null}, name),
        provider = coalesce(${patch.provider ?? null}, provider),
        model = coalesce(${patch.model ?? null}, model),
        enabled = coalesce(${patch.enabled ?? null}, enabled),
        base_url = ${patch.baseUrl === undefined ? sql`base_url` : patch.baseUrl === null ? null : patch.baseUrl},
        secret_env_key = ${patch.secretEnvKey === undefined ? sql`secret_env_key` : patch.secretEnvKey === null ? null : patch.secretEnvKey},
        config = ${patch.config === undefined ? sql`config` : json(patch.config)}
    where org_id = ${orgId} and id = ${id}
    returning id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
  `;
  return rows[0] ?? null;
}

export async function deleteModel(sql: Sql, orgId: string, id: string): Promise<boolean> {
  const rows = await sql`delete from models where org_id = ${orgId} and id = ${id} returning id`;
  return rows.length > 0;
}

export type ConnectionRow = {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  status: string;
  base_url: string | null;
  secret_env_key: string | null;
  config: Record<string, unknown>;
  operations: Array<Record<string, unknown>>;
  enabled: boolean;
};

export async function listConnections(sql: Sql, orgId: string): Promise<ConnectionRow[]> {
  return sql<ConnectionRow[]>`
    select * from connections
    where org_id = ${orgId} and deleted_at is null
    order by name asc
  `;
}

export async function getConnectionsByIds(
  sql: Sql,
  orgId: string,
  ids: string[]
): Promise<Map<string, ConnectionRow>> {
  const out = new Map<string, ConnectionRow>();
  if (ids.length === 0) return out;
  const rows = await sql<ConnectionRow[]>`
    select * from connections
    where org_id = ${orgId} and id = any(${ids}) and deleted_at is null
  `;
  for (const row of rows) out.set(row.id, row);
  return out;
}

export async function upsertConnection(
  sql: Sql,
  orgId: string,
  data: {
    id?: string;
    name: string;
    kind: string;
    status?: string;
    baseUrl?: string | null;
    secretEnvKey?: string | null;
    config?: Record<string, unknown>;
    operations?: Array<Record<string, unknown>>;
    enabled?: boolean;
  }
): Promise<ConnectionRow> {
  const id = data.id ?? randomUUID();
  const rows = await sql<ConnectionRow[]>`
    insert into connections (id, org_id, name, kind, status, base_url, secret_env_key, config, operations, enabled)
    values (
      ${id}, ${orgId}, ${data.name}, ${data.kind},
      ${data.status ?? "configured"}, ${data.baseUrl ?? null}, ${data.secretEnvKey ?? null},
      ${json(data.config ?? {})}, ${json(data.operations ?? [])}, ${data.enabled ?? true}
    )
    on conflict (org_id, name) do update set
      kind = excluded.kind,
      status = excluded.status,
      base_url = excluded.base_url,
      secret_env_key = excluded.secret_env_key,
      config = excluded.config,
      operations = excluded.operations,
      enabled = excluded.enabled,
      deleted_at = null
    returning *
  `;
  return rows[0];
}

export async function updateConnection(
  sql: Sql,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    kind?: string;
    baseUrl?: string | null;
    secretEnvKey?: string | null;
    operations?: Array<Record<string, unknown>>;
    enabled?: boolean;
  }
): Promise<ConnectionRow | null> {
  const rows = await sql<ConnectionRow[]>`
    update connections
    set name = coalesce(${patch.name ?? null}, name),
        kind = coalesce(${patch.kind ?? null}, kind),
        base_url = ${patch.baseUrl === undefined ? sql`base_url` : patch.baseUrl},
        secret_env_key = ${patch.secretEnvKey === undefined ? sql`secret_env_key` : patch.secretEnvKey},
        operations = ${patch.operations === undefined ? sql`operations` : json(patch.operations)},
        enabled = coalesce(${patch.enabled ?? null}, enabled)
    where org_id = ${orgId} and id = ${id}
    returning *
  `;
  return rows[0] ?? null;
}

export async function softDeleteConnection(
  sql: Sql,
  orgId: string,
  id: string
): Promise<boolean> {
  const rows = await sql`
    update connections
    set deleted_at = now()
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    returning id
  `;
  return rows.length > 0;
}

export type WorkspaceVariableRow = {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  value: string | null;
  description: string;
  enabled: boolean;
};

export async function listWorkspaceVariables(
  sql: Sql,
  orgId: string
): Promise<WorkspaceVariableRow[]> {
  return sql<WorkspaceVariableRow[]>`
    select * from workspace_variables where org_id = ${orgId} order by name asc
  `;
}

export async function createWorkspaceVariable(
  sql: Sql,
  orgId: string,
  data: {
    name: string;
    kind?: string;
    value?: string | null;
    description?: string;
    enabled?: boolean;
  }
): Promise<WorkspaceVariableRow> {
  const rows = await sql<WorkspaceVariableRow[]>`
    insert into workspace_variables (org_id, name, kind, value, description, enabled)
    values (
      ${orgId}, ${data.name}, ${data.kind ?? "variable"}, ${data.value ?? null},
      ${data.description ?? ""}, ${data.enabled ?? true}
    )
    on conflict (org_id, name) do update set
      kind = excluded.kind,
      value = excluded.value,
      description = excluded.description,
      enabled = excluded.enabled
    returning *
  `;
  return rows[0];
}

export async function deleteWorkspaceVariable(
  sql: Sql,
  orgId: string,
  id: string
): Promise<boolean> {
  const rows = await sql`
    delete from workspace_variables where org_id = ${orgId} and id = ${id} returning id
  `;
  return rows.length > 0;
}

export type FolderRow = {
  id: string;
  org_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
};

export async function listFolders(sql: Sql, orgId: string): Promise<FolderRow[]> {
  return sql<FolderRow[]>`
    select * from folders
    where org_id = ${orgId} and deleted_at is null
    order by sort_order asc, name asc
  `;
}

export async function findFolderByName(
  sql: Sql,
  orgId: string,
  name: string
): Promise<FolderRow | null> {
  const rows = await sql<FolderRow[]>`
    select * from folders
    where org_id = ${orgId} and name = ${name} and deleted_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createFolder(
  sql: Sql,
  orgId: string,
  name: string,
  sortOrder = 100,
  parentId?: string | null
): Promise<FolderRow> {
  const rows = await sql<FolderRow[]>`
    insert into folders (org_id, name, sort_order, parent_id)
    values (${orgId}, ${name}, ${sortOrder}, ${parentId ?? null})
    returning *
  `;
  return rows[0];
}

export async function linkRunOutputFile(
  sql: Sql,
  orgId: string,
  runId: string,
  fileId: string,
  relationship = "output"
): Promise<void> {
  await sql`
    insert into run_output_files (org_id, run_id, file_id, relationship)
    values (${orgId}, ${runId}, ${fileId}, ${relationship})
    on conflict do nothing
  `;
}

export async function linkRunInputFiles(
  sql: Sql,
  orgId: string,
  runId: string,
  fileIds: string[],
  relationship = "context"
): Promise<void> {
  if (fileIds.length === 0) return;
  await sql`
    insert into run_input_files (org_id, run_id, file_id, relationship)
    select ${orgId}, ${runId}, id, ${relationship}
    from unnest(${fileIds}::uuid[]) as id
    on conflict do nothing
  `;
}

export async function listRunOutputFileIds(
  sql: Sql,
  orgId: string,
  runId: string
): Promise<string[]> {
  const rows = await sql<{ file_id: string }[]>`
    select file_id from run_output_files
    where org_id = ${orgId} and run_id = ${runId} and relationship = 'output'
  `;
  return rows.map((r) => r.file_id);
}

export async function recordUsage(
  sql: Sql,
  orgId: string,
  data: {
    runId: string;
    nodeId?: string | null;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await sql`
    insert into usage_ledger (org_id, run_id, provider, model, input_tokens, output_tokens, cost_micros, metadata)
    values (
      ${orgId}, ${data.runId},
      ${data.provider}, ${data.model},
      ${data.inputTokens}, ${data.outputTokens}, ${data.costMicros},
      ${json(data.metadata ?? {})}
    )
  `;
}

export async function audit(
  sql: Sql,
  orgId: string,
  data: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }
): Promise<void> {
  await sql`
    insert into audit_log (org_id, actor_id, action, entity_type, entity_id, before, after)
    values (
      ${orgId}, ${data.actorId ?? null}, ${data.action}, ${data.entityType}, ${data.entityId},
      ${data.before ? json(data.before) : null},
      ${data.after ? json(data.after) : null}
    )
  `;
}

export async function resetWorkspace(
  sql: Sql,
  orgId: string,
  mode: "files" | "all"
): Promise<void> {
  if (mode === "all") {
    await sql`delete from usage_ledger where org_id = ${orgId}`;
    await sql`delete from run_events where org_id = ${orgId}`;
    await sql`delete from run_input_files where org_id = ${orgId}`;
    await sql`delete from run_output_files where org_id = ${orgId}`;
    await sql`delete from runs where org_id = ${orgId}`;
    await sql`delete from chat_messages where org_id = ${orgId}`;
    await sql`delete from chats where org_id = ${orgId}`;
    await sql`delete from file_relations where org_id = ${orgId}`;
    await sql`delete from files where org_id = ${orgId}`;
    await sql`delete from workspace_variables where org_id = ${orgId}`;
    await sql`delete from connections where org_id = ${orgId}`;
    await sql`delete from models where org_id = ${orgId}`;
    await sql`delete from folders where org_id = ${orgId}`;
  } else {
    const fileIds = await sql<{ id: string }[]>`
      select id from files where org_id = ${orgId}
    `;
    const ids = fileIds.map((r) => r.id);
    if (ids.length === 0) return;
    await sql`delete from file_relations where org_id = ${orgId}`;
    await sql`delete from run_input_files where org_id = ${orgId} and file_id = any(${ids}::uuid[])`;
    await sql`delete from run_output_files where org_id = ${orgId} and file_id = any(${ids}::uuid[])`;
    await sql`delete from files where org_id = ${orgId}`;
  }
}
