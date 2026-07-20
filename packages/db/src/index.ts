import postgres from "postgres";
import { randomUUID } from "node:crypto";

type PostgresParameter = postgres.SerializableParameter<never>;
type SqlLike = Pick<postgres.Sql<{}>, "json">;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// ── Connection profile — single authority for all database access ──

export type ConnectionProfileMode = "direct" | "session" | "transaction" | "pooler-session";

export type ConnectionProfile = {
  connectionString: string;
  mode: ConnectionProfileMode;
  prepareStatements: boolean;
  ssl: Record<string, unknown>;
  statementTimeout: string;
  poolMax: number;
  poolMin: number;
  connectTimeoutSeconds: number;
  diagnostic: ConnectionDiagnostics;
};

export type ConnectionDiagnostics = {
  host: string;
  port: string;
  mode: ConnectionProfileMode;
  prepareStatements: boolean;
  poolMax: number;
  poolMin: number;
};

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function classifySupabaseHost(host: string): "direct" | "pooler" | "generic" {
  const lower = host.toLowerCase();
  if (/^db\.[a-z0-9-]+\.supabase\.co$/i.test(lower)) return "direct";
  if (/pooler\.supabase\.com/i.test(lower) || /supavisor/i.test(lower)) return "pooler";
  return "generic";
}

// Re-export for use by auth.ts and other consumers
export { classifySupabaseHost as _classifySupabaseHost, positiveIntegerEnv as _positiveIntegerEnv };

export function resolveConnectionProfile(connectionString: string): ConnectionProfile {
  const explicitDirectEnv = process.env.DATABASE_URL_DIRECT?.trim();
  const effective = explicitDirectEnv || connectionString;

  const url = new URL(effective);
  const host = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");

  let mode: ConnectionProfileMode;

  if (process.env.DATABASE_CONNECTION_MODE) {
    const raw = process.env.DATABASE_CONNECTION_MODE.trim().toLowerCase();
    if (raw === "direct") mode = "direct";
    else if (raw === "session") mode = "session";
    else if (raw === "transaction") mode = "transaction";
    else if (raw === "pooler-session") mode = "pooler-session";
    else throw new Error(
      `Invalid DATABASE_CONNECTION_MODE="${raw}". Must be one of: direct, session, transaction, pooler-session.`
    );
    // Validate mode agrees with URL for Supabase hosts to catch misconfiguration early.
    const hostClass = classifySupabaseHost(host);
    if (hostClass === "direct" && mode !== "direct") {
      console.warn(
        `[db] DATABASE_CONNECTION_MODE=${mode} but host looks like a Supabase direct endpoint ` +
        `(${host}). This may cause prepared-statement or TLS issues.`
      );
    }
    if (hostClass === "pooler" && mode === "direct") {
      throw new Error(
        `DATABASE_CONNECTION_MODE=direct but ${host} is a Supabase pooler host. ` +
        `Set DATABASE_URL_DIRECT to the direct endpoint, or use mode=transaction/pooler-session.`
      );
    }
  } else {
    // Infer from URL when no explicit mode
    if (port === "6543") mode = "transaction";
    else if (classifySupabaseHost(host) === "direct") mode = "direct";
    else if (classifySupabaseHost(host) === "pooler") mode = "pooler-session";
    else mode = "session";
  }

  const prepareStatements = mode === "direct" || mode === "session";

  const ssl: Record<string, unknown> = { rejectUnauthorized: false };
  if (classifySupabaseHost(host) !== "generic") {
    // Supabase requires SSL and uses SNI
    ssl.servername = host;
  }

  // Statement timeout: pooler modes need aggressive timeouts because
  // pgBouncer can wedge connections in idle-in-transaction state.
  const statementTimeout = mode === "transaction" || mode === "pooler-session"
    ? "statement_timeout=10000,idle_in_transaction_session_timeout=10000"
    : "statement_timeout=30000";

  const poolMax = positiveIntegerEnv("DB_POOL_MAX", 10);
  const poolMin = positiveIntegerEnv("DB_POOL_MIN", 1);
  const connectTimeoutSeconds = positiveIntegerEnv("DB_CONNECT_TIMEOUT_SECONDS", 10);

  const diagnostic: ConnectionDiagnostics = {
    host,
    port,
    mode,
    prepareStatements,
    poolMax,
    poolMin,
  };

  return {
    connectionString: effective,
    mode,
    prepareStatements,
    ssl,
    statementTimeout,
    poolMax,
    poolMin,
    connectTimeoutSeconds,
    diagnostic,
  };
}

/**
 * Normalize an application value at the database JSON boundary. JavaScript
 * strings can contain lone UTF-16 surrogates, while PostgreSQL JSON text is
 * UTF-8 and rejects them. Round-tripping through JSON also preserves the
 * serialization semantics used by the postgres driver.
 */
export function json<T>(value: T): T {
  const serialized = JSON.stringify(value, (_key, candidate: unknown) =>
    typeof candidate === "string" ? candidate.replace(LONE_SURROGATE, "\uFFFD") : candidate
  );
  return serialized === undefined ? value : JSON.parse(serialized) as T;
}

// Wrapper around `sql.json` that accepts the loose `Record<string, unknown>`
// shapes the repositories use. `sql.json` itself takes `JSONValue` which
// requires a tighter index signature; we cast through `unknown` to bridge
// the two without sprinkling `as any` across every call site. The
// `SqlLike` shape lets this work for both top-level `Sql` and inside
// `sql.begin` transactions, which expose the same `json` helper.
function toJsonb(sql: SqlLike, value: unknown): ReturnType<postgres.Sql<{}>["json"]> {
  // The cast is necessary because `JSONValue` requires a more precise
  // index signature than the `Record<string, unknown>` shapes the
  // repositories pass in. The runtime serialization is identical.
  return sql.json(json(value) as never);
}

export type Sql = ReturnType<typeof postgres>;

export function createSql(connectionString: string): Sql {
  const profile = resolveConnectionProfile(connectionString);
  const url = new URL(profile.connectionString);
  const connection: Record<string, string> = {};
  const ssl = { ...profile.ssl };
  // postgres.js uses searchParams "host" for SNI if present
  const projectRef = url.searchParams.get("host");
  if (projectRef) {
    ssl.servername = projectRef;
    connection.host = projectRef;
  } else if (ssl.servername) {
    connection.host = ssl.servername as string;
  }
  const opts: Record<string, unknown> = {
    max: profile.poolMax,
    min: profile.poolMin,
    idle_timeout: 60,
    connect_timeout: profile.connectTimeoutSeconds,
    prepare: profile.prepareStatements,
    ssl,
    connection,
    keep_alive: 15,
    max_lifetime: 300,
    onnotice: () => undefined,
    transform: { undefined: null },
  };
  const sql = postgres(profile.connectionString, opts as any);
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[db] mode=${profile.mode} prepare=${profile.prepareStatements} ` +
      `poolMax=${profile.poolMax} poolMin=${profile.poolMin} ` +
      `host=${profile.diagnostic.host} port=${profile.diagnostic.port}`
    );
  }
  return sql;
}

export type SqlCounter = {
  count: number;
  totalMs: number;
};

export type InstrumentedSql = Sql & {
  __counter: SqlCounter;
};

/**
 * Wrap a postgres.js Sql instance so every query increments
 * `__counter.count` and contributes its wall time to `__counter.totalMs`.
 *
 * Implementation: postgres.js offers no after-query callback natively, so
 * we Proxy the result promise's `.then`/`.catch`.  This correctly captures
 * the completion time (including wire/network) rather than the dispatch
 * time that the `debug` callback would give us.
 */
export function instrumentSql(sql: Sql): InstrumentedSql {
  const counter: SqlCounter = { count: 0, totalMs: 0 };
  // Wrap the tagged-template function's thenable to measure actual query completion.
  // postgres.js queries are thenables, so we can wrap the resolved value.
  const originalThen = (sql as unknown as PromiseLike<unknown>).then?.bind(sql);
  if (typeof originalThen === "function") {
    (sql as unknown as InstrumentedSql).__counter = counter;
    // We use a Proxy on the sql function itself to intercept tagged-template calls.
    // The proxy replaces `then` so every query pipeline gets instrumented.
    const instrumented = new Proxy(sql, {
      apply(target, thisArg, args) {
        const start = performance.now();
        counter.count += 1;
        const result = Reflect.apply(target, thisArg, args) as Promise<unknown>;
        const track = (value: unknown) => {
          counter.totalMs += performance.now() - start;
          return value;
        };
        return result.then(track, (err: unknown) => {
          counter.totalMs += performance.now() - start;
          throw err;
        });
      },
    });
    (instrumented as unknown as InstrumentedSql).__counter = counter;
    return instrumented as unknown as InstrumentedSql;
  }
  (sql as unknown as InstrumentedSql).__counter = counter;
  return sql as unknown as InstrumentedSql;
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
  lifecycle: string;
  enabled: boolean;
  validation_diagnostics: Record<string, unknown>[];
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
    select id, org_id, folder_id, file_type, status,
           lifecycle, enabled, validation_diagnostics,
           title, body, content_format, metadata,
           current_version, created_at, updated_at
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

export async function getOrchestratorPrompt(sql: Sql, orgId: string): Promise<FileRow | null> {
  const rows = await sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status,
           lifecycle, enabled, validation_diagnostics,
           title, body, content_format, metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId}
      and deleted_at is null
      and file_type = 'prompt'
      and status = 'active'
      and metadata ->> 'systemRole' = 'orchestrator'
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getFile(sql: Sql, orgId: string, id: string): Promise<FileRow | null> {
  const rows = await sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status,
           lifecycle, enabled, validation_diagnostics,
           title, body, content_format, metadata, current_version, created_at, updated_at
    from files
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getFilesByIds(sql: Sql, orgId: string, ids: string[]): Promise<FileRow[]> {
  if (ids.length === 0) return [];
  return sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status,
           lifecycle, enabled, validation_diagnostics,
           title, body, content_format, metadata, current_version, created_at, updated_at
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
    select id, org_id, folder_id, file_type, status,
           lifecycle, enabled, validation_diagnostics,
           title, body, content_format, metadata, current_version, created_at, updated_at
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
      ${toJsonb(sql, input.metadata ?? {})}
    )
    on conflict (id) do nothing
    returning id, org_id, folder_id, file_type, status,
              lifecycle, enabled, validation_diagnostics,
              title, body, content_format, metadata,
              current_version, created_at, updated_at
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
        metadata = ${patch.metadata === undefined ? sql`metadata` : toJsonb(sql, patch.metadata)}
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    returning id, org_id, folder_id, file_type, status,
              lifecycle, enabled, validation_diagnostics,
              title, body, content_format, metadata,
              current_version, created_at, updated_at
  `;
  if (rows.length === 0) throw new Error("File not found or already deleted");
  return rows[0];
}

export async function updateFileIfVersion(
  sql: Sql,
  orgId: string,
  id: string,
  expectedVersion: number,
  patch: UpdateFileInput
): Promise<FileRow | null> {
  const rows = await sql<FileRow[]>`
    update files
    set title = coalesce(${patch.title ?? null}, title),
        body = coalesce(${patch.body ?? null}, body),
        file_type = coalesce(${patch.fileType ?? null}, file_type),
        status = coalesce(${patch.status ?? null}, status),
        folder_id = ${patch.folderId === undefined ? sql`folder_id` : patch.folderId},
        metadata = ${patch.metadata === undefined ? sql`metadata` : toJsonb(sql, patch.metadata)}
    where org_id = ${orgId}
      and id = ${id}
      and current_version = ${expectedVersion}
      and deleted_at is null
    returning id, org_id, folder_id, file_type, status,
              lifecycle, enabled, validation_diagnostics,
              title, body, content_format, metadata,
              current_version, created_at, updated_at
  `;
  return rows[0] ?? null;
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

export async function deleteEmptyPlaceholderFiles(sql: Sql, orgId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update files as file
    set status = 'deleted', deleted_at = now()
    where file.org_id = ${orgId}
      and file.deleted_at is null
      and file.status = 'draft'
      and file.file_type in ('knowledge', 'strategy', 'prompt', 'draft')
      and file.title ~* '^untitled(?:\.[a-z0-9]+)?$'
      and btrim(file.body) = ''
      and coalesce(file.metadata ->> 'seed', 'false') <> 'true'
      and not exists (
        select 1 from file_relations relation
        where relation.org_id = ${orgId}
          and (relation.source_file_id = file.id or relation.target_file_id = file.id)
      )
      and not exists (
        select 1 from run_input_files input
        where input.org_id = ${orgId} and input.file_id = file.id
      )
      and not exists (
        select 1 from run_output_files output
        where output.org_id = ${orgId} and output.file_id = file.id
      )
    returning file.id
  `;
  return rows.length;
}

export async function deleteLegacySeedDuplicates(sql: Sql, orgId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    with ranked_seed_paths as (
      select id,
             row_number() over (
               partition by org_id, metadata ->> 'seedPath'
               order by updated_at desc, id desc
             ) as duplicate_rank
      from files
      where org_id = ${orgId}
        and deleted_at is null
        and coalesce(metadata ->> 'seed', 'false') = 'true'
        and metadata ->> 'seedPath' is not null
    ), duplicate_ids as (
      select id from ranked_seed_paths where duplicate_rank > 1
      union
      select legacy.id
      from files legacy
      where legacy.org_id = ${orgId}
        and legacy.deleted_at is null
        and legacy.metadata ->> 'seedPath' is null
        and legacy.file_type in ('harness_role', 'harness_skill', 'harness_workflow', 'harness_workstream', 'harness_eval', 'harness_template')
        and (
          coalesce(legacy.metadata ->> 'seed', 'false') = 'true'
          or jsonb_typeof(legacy.metadata) <> 'object'
          or legacy.metadata ? 'role'
          or legacy.metadata ? 'skill'
          or legacy.metadata ? 'workstream'
          or legacy.metadata ? 'eval'
          or legacy.metadata ? 'template'
        )
        and exists (
          select 1 from files canonical
          where canonical.org_id = legacy.org_id
            and canonical.deleted_at is null
            and canonical.id <> legacy.id
            and canonical.file_type = legacy.file_type
            and lower(canonical.title) = lower(legacy.title)
            and canonical.body = legacy.body
            and canonical.metadata ->> 'seedPath' is not null
        )
    )
    update files as legacy
    set status = 'deleted', deleted_at = now()
    where legacy.org_id = ${orgId}
      and legacy.deleted_at is null
      and legacy.id in (select id from duplicate_ids)
    returning legacy.id
  `;
  return rows.length;
}

export async function organizeUnfolderedGeneratedFiles(sql: Sql, orgId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update files as file
    set metadata = jsonb_set(
      coalesce(file.metadata, '{}'::jsonb),
      '{seedFolder}',
      to_jsonb('Outputs'::text),
      true
    )
    where file.org_id = ${orgId}
      and file.deleted_at is null
      and file.file_type in ('artifact', 'draft', 'evidence', 'asset', 'eval_report', 'publish_package')
      and nullif(btrim(file.metadata ->> 'seedFolder'), '') is null
    returning file.id
  `;
  return rows.length;
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
  parent_run_id: string | null;
  project_id: string | null;
  turn_id: string | null;
  execution_kind: string | null;
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
  graph_version: string | null;
  next_event_sequence: number;
  checkpoint_version: number;
  cancel_requested_at: string | null;
  pause_requested_at: string | null;
  resumed_at: string | null;
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
    select id, org_id, chat_id, workflow_id, parent_run_id, project_id, turn_id, execution_kind, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           graph_version, next_event_sequence, checkpoint_version,
           cancel_requested_at, pause_requested_at, resumed_at,
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
    parentRunId?: string | null;
    projectId?: string | null;
    turnId?: string | null;
    executionKind?: string | null;
    type: string;
    prompt: string;
    inputs: Record<string, unknown>;
    definitionSnapshot: Record<string, unknown>;
    idempotencyKey?: string | null;
    requestedBy?: string | null;
    graphVersion?: string | null;
  }
): Promise<RunRow> {
  const rows = await sql<RunRow[]>`
    insert into runs (id, org_id, chat_id, workflow_id, parent_run_id, project_id, turn_id, execution_kind, type, prompt, status, inputs,
                      definition_snapshot, idempotency_key, requested_by, graph_version)
    values (
      ${data.id ?? sql`DEFAULT`}, ${orgId}, ${data.chatId ?? null}, ${data.workflowId ?? null},
      ${data.parentRunId ?? null}, ${data.projectId ?? null}, ${data.turnId ?? null}, ${data.executionKind ?? null},
      ${data.type}, ${data.prompt}, 'running',
      ${toJsonb(sql, data.inputs)}, ${toJsonb(sql, data.definitionSnapshot)},
      ${data.idempotencyKey ?? null}, ${data.requestedBy ?? null}, ${data.graphVersion ?? null}
    )
    returning id, org_id, chat_id, workflow_id, parent_run_id, project_id, turn_id, execution_kind, type,
              prompt, status, inputs, outputs, human_inputs, state,
              definition_snapshot, idempotency_key, error, requested_by,
              graph_version, next_event_sequence, checkpoint_version,
              cancel_requested_at, pause_requested_at, resumed_at,
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
        inputs = ${patch.inputs === undefined ? sql`inputs` : toJsonb(sql, patch.inputs)},
        outputs = ${patch.outputs === undefined ? sql`outputs` : toJsonb(sql, patch.outputs)},
        human_inputs = ${patch.humanInputs === undefined ? sql`human_inputs` : toJsonb(sql, patch.humanInputs)},
        state = ${patch.state === undefined ? sql`state` : toJsonb(sql, patch.state)},
        error = ${patch.error === undefined ? sql`error` : patch.error},
        completed_at = ${patch.completedAt === undefined ? sql`completed_at` : patch.completedAt}
    where org_id = ${orgId} and id = ${runId}
  `;
}

export async function getRun(sql: Sql, orgId: string, runId: string): Promise<RunRow | null> {
  const rows = await sql<RunRow[]>`
    select id, org_id, chat_id, workflow_id, parent_run_id, project_id, turn_id, execution_kind, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           graph_version, next_event_sequence, checkpoint_version,
           cancel_requested_at, pause_requested_at, resumed_at,
           created_at, updated_at, completed_at
    from runs
    where org_id = ${orgId} and id = ${runId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function listRuns(sql: Sql, orgId: string, limit = 50): Promise<RunRow[]> {
  return sql<RunRow[]>`
    select id, org_id, chat_id, workflow_id, parent_run_id, project_id, turn_id, execution_kind, type,
           prompt, status, inputs, outputs, human_inputs, state,
           definition_snapshot, idempotency_key, error, requested_by,
           graph_version, next_event_sequence, checkpoint_version,
           cancel_requested_at, pause_requested_at, resumed_at,
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
  event_key: string | null;
  created_at: string;
};

export async function listRunEvents(
  sql: Sql,
  orgId: string,
  runId: string,
  afterId?: string
): Promise<RunEventRow[]> {
  if (afterId) {
    return sql<RunEventRow[]>`
      select * from run_events
      where org_id = ${orgId} and run_id = ${runId}
        and id > ${afterId}::uuid
      order by sequence asc, created_at asc
    `;
  }
  return sql<RunEventRow[]>`
    select * from run_events
    where org_id = ${orgId} and run_id = ${runId}
    order by sequence asc, created_at asc
  `;
}

export async function nextRunEventSequence(
  sql: Sql,
  orgId: string,
  runId: string
): Promise<number> {
  const rows = await sql<{ next_event_sequence: number }[]>`
    select next_event_sequence
    from runs
    where org_id = ${orgId} and id = ${runId}
  `;
  return Number(rows[0]?.next_event_sequence ?? 0);
}

/**
 * Atomically reserve a contiguous sequence range on the run and insert the
 * batch. The counter on `runs.next_event_sequence` is incremented by exactly
 * `events.length` and the previous value is returned, so each event in the
 * batch is assigned `base + row_number`. Two concurrent appends on the same
 * run can never produce overlapping sequences.
 */
async function reserveEventSequenceRange(
  sql: Sql,
  orgId: string,
  runId: string,
  count: number
): Promise<number> {
  if (count <= 0) return 0;
  const rows = await sql<{ base: number }[]>`
    update runs
    set next_event_sequence = next_event_sequence + ${count}::bigint
    where org_id = ${orgId} and id = ${runId}
    returning (next_event_sequence - ${count}::bigint) as base
  `;
  if (rows.length === 0) {
    throw new Error(`Run ${runId} not found in org ${orgId}; cannot reserve event sequence range.`);
  }
  return Number(rows[0].base);
}

export type RunEventInput = {
  event_type: string;
  node_id: string | null;
  node_title: string | null;
  skill_id: string | null;
  skill_name: string | null;
  message: string;
  payload: Record<string, unknown>;
  event_key?: string;
};

export async function appendRunEvents(
  sql: Sql,
  orgId: string,
  runId: string,
  events: RunEventInput[]
): Promise<RunEventRow[]> {
  if (events.length === 0) return [];
  // Reserve the sequence range in its own statement so the counter
  // advances atomically. If the insert below fails, the counter is ahead
  // of the materialized events by at most one batch; the next append for
  // this run continues from the new range. This is a strict improvement
  // over `coalesce(max(sequence) + 1, 1)` which races under concurrent
  // writers and can produce overlapping sequence numbers.
  const base = await reserveEventSequenceRange(sql, orgId, runId, events.length);
  const values = events.map((event) => ({
    org_id: orgId,
    run_id: runId,
    event_type: event.event_type,
    node_id: event.node_id,
    node_title: event.node_title,
    skill_id: event.skill_id,
    skill_name: event.skill_name,
    message: event.message,
    payload: event.payload,
    event_key: event.event_key ?? null,
    sequence: base + 0
  }));
  const rows = await sql<RunEventRow[]>`
    with batch as (
      select row_number() over () as rn, record.*
      from jsonb_to_recordset(${toJsonb(sql, values as unknown as never)}) as record(
        org_id text, run_id text, event_type text,
        node_id text, node_title text, skill_id text, skill_name text,
        message text, payload jsonb, event_key text, sequence bigint
      )
    )
    insert into run_events (org_id, run_id, event_type, sequence, node_id, node_title, skill_id, skill_name, message, payload, event_key)
    select
      batch.org_id::uuid,
      batch.run_id::uuid,
      batch.event_type::event_type,
      batch.sequence + batch.rn - 1,
      batch.node_id,
      batch.node_title,
      batch.skill_id,
      batch.skill_name,
      batch.message,
      batch.payload,
      batch.event_key
    from batch
    returning *
  `;
  return rows;
}

export class CheckpointVersionMismatch extends Error {
  expected: number;
  actual: number;
  constructor(expected: number, actual: number) {
    super(`Checkpoint version mismatch for run: expected ${expected}, found ${actual}.`);
    this.name = "CheckpointVersionMismatch";
    this.expected = expected;
    this.actual = actual;
  }
}

export type AtomicCheckpointInput = {
  events?: RunEventInput[];
  state?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  humanInputs?: Record<string, unknown>;
  status?: string;
  error?: string | null;
  completedAt?: string | null;
  cancelRequestedAt?: string | null;
  pauseRequestedAt?: string | null;
  resumedAt?: string | null;
  expectedCheckpointVersion?: number;
};

export type AtomicCheckpointResult = {
  checkpointVersion: number;
  nextEventSequence: number;
  insertedEvents: RunEventRow[];
};

/**
 * Phase 2.5: atomically persist a run's durable checkpoint.
 *
 * Bundles event flush, state/outputs/status update, and a
 * `checkpoint_version` increment into a single Postgres transaction.
 * If any statement fails, the whole checkpoint rolls back — a crash
 * between event flush and state update can no longer leave the run in
 * an inconsistent state.
 *
 * The transaction takes a row-level lock on the run, so two concurrent
 * atomic checkpoints on the same run serialize. Optional optimistic
 * locking: pass `expectedCheckpointVersion` and the function throws
 * `CheckpointVersionMismatch` if the run has been advanced by another
 * writer in the meantime.
 */
export async function atomicCheckpoint(
  sql: Sql,
  orgId: string,
  runId: string,
  input: AtomicCheckpointInput
): Promise<AtomicCheckpointResult> {
  const events = input.events ?? [];
  return sql.begin(async (tx) => {
    // 1. Lock the run row and read the current version + counter.
    const lockRows = await tx<{ next_event_sequence: number; checkpoint_version: number }[]>`
      select next_event_sequence, checkpoint_version
      from runs
      where org_id = ${orgId} and id = ${runId}
      for update
    `;
    if (lockRows.length === 0) {
      throw new Error(`Run ${runId} not found in org ${orgId}; cannot checkpoint.`);
    }
    const currentVersion = Number(lockRows[0].checkpoint_version);
    if (input.expectedCheckpointVersion !== undefined
        && currentVersion !== input.expectedCheckpointVersion) {
      throw new CheckpointVersionMismatch(input.expectedCheckpointVersion, currentVersion);
    }

    // 2. Reserve a contiguous sequence range and insert the events.
    let insertedEvents: RunEventRow[] = [];
    let nextEventSequence = Number(lockRows[0].next_event_sequence);
    if (events.length > 0) {
      const reserveRows = await tx<{ base: number; next: number }[]>`
        update runs
        set next_event_sequence = next_event_sequence + ${events.length}::bigint
        where org_id = ${orgId} and id = ${runId}
        returning (next_event_sequence - ${events.length}::bigint) as base,
                  next_event_sequence as next
      `;
      const base = Number(reserveRows[0]?.base ?? 0);
      nextEventSequence = Number(reserveRows[0]?.next ?? base);
      const values = events.map((event) => ({
        org_id: orgId,
        run_id: runId,
        event_type: event.event_type,
        node_id: event.node_id,
        node_title: event.node_title,
        skill_id: event.skill_id,
        skill_name: event.skill_name,
        message: event.message,
        payload: event.payload,
        event_key: event.event_key ?? null,
        sequence: base
      }));
      insertedEvents = await tx<RunEventRow[]>`
        with batch as (
          select row_number() over () as rn, record.*
          from jsonb_to_recordset(${toJsonb(tx, values as unknown as never)}) as record(
            org_id text, run_id text, event_type text,
            node_id text, node_title text, skill_id text, skill_name text,
            message text, payload jsonb, event_key text, sequence bigint
          )
        )
        insert into run_events (org_id, run_id, event_type, sequence, node_id, node_title, skill_id, skill_name, message, payload, event_key)
        select
          batch.org_id::uuid,
          batch.run_id::uuid,
          batch.event_type::event_type,
          batch.sequence + batch.rn - 1,
          batch.node_id,
          batch.node_title,
          batch.skill_id,
          batch.skill_name,
          batch.message,
          batch.payload,
          batch.event_key
        from batch
        returning *
      `;
    }

    // 3. Update the run row with the new state and bumped version.
    const newVersion = currentVersion + 1;
    await tx`
      update runs
      set checkpoint_version = ${newVersion},
          state = ${input.state === undefined ? sql`state` : toJsonb(sql, input.state)},
          outputs = ${input.outputs === undefined ? sql`outputs` : toJsonb(sql, input.outputs)},
          human_inputs = ${input.humanInputs === undefined ? sql`human_inputs` : toJsonb(sql, input.humanInputs)},
          status = coalesce(${input.status ?? null}, status),
          error = ${input.error === undefined ? sql`error` : input.error},
          completed_at = ${input.completedAt === undefined ? sql`completed_at` : input.completedAt},
          cancel_requested_at = ${input.cancelRequestedAt === undefined ? sql`cancel_requested_at` : input.cancelRequestedAt},
          pause_requested_at = ${input.pauseRequestedAt === undefined ? sql`pause_requested_at` : input.pauseRequestedAt},
          resumed_at = ${input.resumedAt === undefined ? sql`resumed_at` : input.resumedAt}
      where org_id = ${orgId} and id = ${runId}
    `;

    return {
      checkpointVersion: newVersion,
      nextEventSequence,
      insertedEvents
    };
  });
}

export type ChatRow = {
  id: string;
  org_id: string;
  title: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export async function getChat(sql: Sql, orgId: string, chatId: string): Promise<ChatRow | null> {
  const rows = await sql<ChatRow[]>`
    select * from chats where org_id = ${orgId} and id = ${chatId} limit 1
  `;
  return rows[0] ?? null;
}

export async function updateChatMetadata(
  sql: Sql,
  orgId: string,
  chatId: string,
  patch: Record<string, unknown>
): Promise<ChatRow | null> {
  const rows = await sql<ChatRow[]>`
    update chats
    set metadata = coalesce(metadata, '{}'::jsonb) || ${toJsonb(sql, patch)}
    where org_id = ${orgId} and id = ${chatId}
    returning *
  `;
  return rows[0] ?? null;
}

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
  chatId: string,
  opts?: { after?: string; limit?: number }
): Promise<ChatMessageRow[]> {
  const limit = opts?.limit ?? 200;
  if (opts?.after) {
    // Cursor-based pagination: fetch messages after the given sequence_number
    return sql<ChatMessageRow[]>`
      select * from chat_messages
      where org_id = ${orgId} and chat_id = ${chatId}
        and sequence_number > (select sequence_number from chat_messages where id = ${opts.after} and org_id = ${orgId})
      order by sequence_number asc
      limit ${limit}
    `;
  }
  return sql<ChatMessageRow[]>`
    select * from chat_messages
    where org_id = ${orgId} and chat_id = ${chatId}
    order by sequence_number asc
    limit ${limit}
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
  // Phase 3: atomic sequence number from chats.next_message_sequence
  const [seq] = await sql<{ sequence: number }[]>`
    update chats
    set next_message_sequence = next_message_sequence + 1,
        updated_at = now()
    where org_id = ${orgId} and id = ${chatId}
    returning (next_message_sequence - 1) as sequence
  `;
  const sequence = seq?.sequence ?? 0;
  const rows = await sql<ChatMessageRow[]>`
    insert into chat_messages (org_id, chat_id, role, body, metadata, sequence_number)
    values (${orgId}, ${chatId}, ${role}, ${body}, ${toJsonb(sql, metadata)}, ${sequence})
    returning *
  `;
  return rows[0];
}

export async function appendChatMessages(
  sql: Sql,
  orgId: string,
  chatId: string,
  messages: Array<{ role: string; body: string; metadata?: Record<string, unknown> }>
): Promise<ChatMessageRow[]> {
  if (messages.length === 0) return [];
  // Reserve the entire batch of sequences atomically
  const [seq] = await sql<{ base: number }[]>`
    update chats
    set next_message_sequence = next_message_sequence + ${messages.length},
        updated_at = now()
    where org_id = ${orgId} and id = ${chatId}
    returning (next_message_sequence - ${messages.length}) as base
  `;
  const base = seq?.base ?? 0;
  const out: ChatMessageRow[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const rows = await sql<ChatMessageRow[]>`
      insert into chat_messages (org_id, chat_id, role, body, metadata, sequence_number)
      values (${orgId}, ${chatId}, ${m.role}, ${m.body}, ${toJsonb(sql, m.metadata ?? {})}, ${base + i})
      returning *
    `;
    if (rows[0]) out.push(rows[0]);
  }
  return out;
}

// ── Persistent project sessions ────────────────────────────────
//
// The harness remains file-backed. These tables deliberately own only the
// mutable project/session layer that must survive reload, retries, and worker
// boundaries. All helpers scope every lookup to the organization.

export type ProjectSessionRow = {
  id: string;
  org_id: string;
  chat_id: string;
  title: string;
  status: "active" | "awaiting_input" | "review" | "completed" | "archived";
  workflow_id: string | null;
  active_revision_id: string | null;
  active_artifact_id: string | null;
  working_state: Record<string, unknown>;
  summary: string;
  summary_version: number;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProjectRevisionRow = {
  id: string;
  org_id: string;
  project_id: string;
  parent_revision_id: string | null;
  run_id: string | null;
  turn_id: string | null;
  sequence: number;
  instruction: string;
  change_set: Record<string, unknown>;
  artifact_ids: string[];
  source_hashes: Record<string, string>;
  evaluation: Record<string, unknown>;
  receipts: Array<Record<string, unknown>>;
  author: "user" | "orchestrator" | "role" | "workflow" | "system";
  created_at: string;
};

const projectSessionColumns = `
  id, org_id, chat_id, title, status, workflow_id, active_revision_id,
  active_artifact_id, working_state, summary, summary_version, version,
  created_at, updated_at, archived_at
`;

export async function getProjectSession(
  sql: Sql,
  orgId: string,
  projectId: string
): Promise<ProjectSessionRow | null> {
  const rows = await sql<ProjectSessionRow[]>`
    select ${sql.unsafe(projectSessionColumns)}
    from project_sessions
    where org_id = ${orgId} and id = ${projectId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getActiveProjectSessionForChat(
  sql: Sql,
  orgId: string,
  chatId: string
): Promise<ProjectSessionRow | null> {
  const rows = await sql<ProjectSessionRow[]>`
    select ${sql.unsafe(projectSessionColumns)}
    from project_sessions
    where org_id = ${orgId}
      and chat_id = ${chatId}
      and archived_at is null
    order by updated_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createProjectSession(
  sql: Sql,
  orgId: string,
  input: {
    id?: string;
    chatId: string;
    title: string;
    workflowId?: string | null;
    workingState?: Record<string, unknown>;
  }
): Promise<ProjectSessionRow> {
  const rows = await sql<ProjectSessionRow[]>`
    insert into project_sessions (id, org_id, chat_id, title, workflow_id, working_state)
    values (
      ${input.id ?? sql`DEFAULT`}, ${orgId}, ${input.chatId}, ${input.title},
      ${input.workflowId ?? null}, ${toJsonb(sql, input.workingState ?? {})}
    )
    returning ${sql.unsafe(projectSessionColumns)}
  `;
  return rows[0];
}

export async function updateProjectSession(
  sql: Sql,
  orgId: string,
  projectId: string,
  input: {
    expectedVersion: number;
    title?: string;
    status?: ProjectSessionRow["status"];
    workflowId?: string | null;
    activeArtifactId?: string | null;
    workingState?: Record<string, unknown>;
    summary?: string;
    summaryVersion?: number;
    archivedAt?: string | null;
  }
): Promise<ProjectSessionRow | null> {
  const rows = await sql<ProjectSessionRow[]>`
    update project_sessions
    set title = coalesce(${input.title ?? null}, title),
        status = coalesce(${input.status ?? null}, status),
        workflow_id = ${input.workflowId === undefined ? sql`workflow_id` : input.workflowId},
        active_artifact_id = ${input.activeArtifactId === undefined ? sql`active_artifact_id` : input.activeArtifactId},
        working_state = ${input.workingState === undefined ? sql`working_state` : toJsonb(sql, input.workingState)},
        summary = coalesce(${input.summary ?? null}, summary),
        summary_version = coalesce(${input.summaryVersion ?? null}, summary_version),
        archived_at = ${input.archivedAt === undefined ? sql`archived_at` : input.archivedAt},
        version = version + 1
    where org_id = ${orgId}
      and id = ${projectId}
      and version = ${input.expectedVersion}
    returning ${sql.unsafe(projectSessionColumns)}
  `;
  return rows[0] ?? null;
}

export async function listProjectRevisions(
  sql: Sql,
  orgId: string,
  projectId: string
): Promise<ProjectRevisionRow[]> {
  return sql<ProjectRevisionRow[]>`
    select id, org_id, project_id, parent_revision_id, run_id, turn_id, sequence,
           instruction, change_set, artifact_ids, source_hashes, evaluation,
           receipts, author, created_at
    from project_revisions
    where org_id = ${orgId} and project_id = ${projectId}
    order by sequence asc
  `;
}

export async function appendProjectRevision(
  sql: Sql,
  orgId: string,
  input: {
    projectId: string;
    expectedProjectVersion: number;
    parentRevisionId?: string | null;
    runId?: string | null;
    turnId?: string | null;
    instruction?: string;
    changeSet?: Record<string, unknown>;
    artifactIds?: string[];
    sourceHashes?: Record<string, string>;
    evaluation?: Record<string, unknown>;
    receipts?: Array<Record<string, unknown>>;
    author: ProjectRevisionRow["author"];
    projectStatus?: ProjectSessionRow["status"];
    workingState?: Record<string, unknown>;
  }
): Promise<{ project: ProjectSessionRow; revision: ProjectRevisionRow } | null> {
  return sql.begin(async (tx) => {
    const projects = await tx<ProjectSessionRow[]>`
      select ${tx.unsafe(projectSessionColumns)}
      from project_sessions
      where org_id = ${orgId} and id = ${input.projectId}
      for update
    `;
    const project = projects[0];
    if (!project || project.version !== input.expectedProjectVersion) return null;

    const sequences = await tx<{ sequence: number }[]>`
      select coalesce(max(sequence), 0)::bigint + 1 as sequence
      from project_revisions
      where project_id = ${input.projectId}
    `;
    const sequence = Number(sequences[0]?.sequence ?? 1);
    const revisions = await tx<ProjectRevisionRow[]>`
      insert into project_revisions (
        org_id, project_id, parent_revision_id, run_id, turn_id, sequence,
        instruction, change_set, artifact_ids, source_hashes, evaluation,
        receipts, author
      ) values (
        ${orgId}, ${input.projectId}, ${input.parentRevisionId ?? project.active_revision_id},
        ${input.runId ?? null}, ${input.turnId ?? null}, ${sequence},
        ${input.instruction ?? ""}, ${toJsonb(tx, input.changeSet ?? {})},
        ${toJsonb(tx, input.artifactIds ?? [])}, ${toJsonb(tx, input.sourceHashes ?? {})},
        ${toJsonb(tx, input.evaluation ?? {})}, ${toJsonb(tx, input.receipts ?? [])},
        ${input.author}
      )
      returning id, org_id, project_id, parent_revision_id, run_id, turn_id, sequence,
                instruction, change_set, artifact_ids, source_hashes, evaluation,
                receipts, author, created_at
    `;
    const revision = revisions[0];
    const artifactId = input.artifactIds?.[0] ?? project.active_artifact_id;
    const updated = await tx<ProjectSessionRow[]>`
      update project_sessions
      set active_revision_id = ${revision.id},
          active_artifact_id = ${artifactId},
          status = coalesce(${input.projectStatus ?? null}, status),
          working_state = ${input.workingState === undefined ? tx`working_state` : toJsonb(tx, input.workingState)},
          version = version + 1
      where org_id = ${orgId} and id = ${input.projectId}
      returning ${tx.unsafe(projectSessionColumns)}
    `;
    return updated[0] ? { project: updated[0], revision } : null;
  });
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

export async function getModel(sql: Sql, orgId: string, id: string): Promise<ModelRow | null> {
  const [row] = await sql<ModelRow[]>`
    select id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
    from models
    where org_id = ${orgId} and id = ${id}
  `;
  return row ?? null;
}

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
            ${toJsonb(sql, data.config ?? {})}, ${data.enabled ?? true})
    on conflict (org_id, provider, model) do update set
      name = excluded.name,
      base_url = excluded.base_url,
      secret_env_key = excluded.secret_env_key,
      config = excluded.config,
      enabled = excluded.enabled,
      updated_at = now()
    returning id, org_id, name, provider, model, base_url, secret_env_key, config, enabled
  `;
  return rows[0];
}

export type EnsureEnvironmentModelInput = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string | null;
  secretEnvKey?: string | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
};

export async function ensureEnvironmentModels(
  sql: Sql,
  orgId: string,
  models: EnsureEnvironmentModelInput[]
): Promise<void> {
  if (models.length === 0) return;
  const values = models.map((model) => ({
    id: model.id,
    org_id: orgId,
    name: model.name,
    provider: model.provider,
    model: model.model,
    base_url: model.baseUrl ?? null,
    secret_env_key: model.secretEnvKey ?? null,
    config: model.config ?? {},
    enabled: model.enabled ?? true
  }));
  await sql`
    insert into models (id, org_id, name, provider, model, base_url, secret_env_key, config, enabled)
    select record.id::uuid, record.org_id::uuid, record.name, record.provider, record.model,
           record.base_url, record.secret_env_key, record.config::jsonb, record.enabled
    from jsonb_to_recordset(${toJsonb(sql, values as unknown as never)}) as record(
      id text, org_id text, name text, provider text, model text,
      base_url text, secret_env_key text, config jsonb, enabled boolean
    )
    on conflict (org_id, provider, model) do nothing
  `;
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
        config = ${patch.config === undefined ? sql`config` : toJsonb(sql, patch.config)}
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
      ${toJsonb(sql, data.config ?? {})}, ${toJsonb(sql, data.operations ?? [])}, ${data.enabled ?? true}
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
    status?: string;
    baseUrl?: string | null;
    secretEnvKey?: string | null;
    config?: Record<string, unknown>;
    operations?: Array<Record<string, unknown>>;
    enabled?: boolean;
  }
): Promise<ConnectionRow | null> {
  const rows = await sql<ConnectionRow[]>`
    update connections
    set name = coalesce(${patch.name ?? null}, name),
        kind = coalesce(${patch.kind ?? null}, kind),
        status = coalesce(${patch.status ?? null}, status),
        base_url = ${patch.baseUrl === undefined ? sql`base_url` : patch.baseUrl},
        secret_env_key = ${patch.secretEnvKey === undefined ? sql`secret_env_key` : patch.secretEnvKey},
        config = ${patch.config === undefined ? sql`config` : toJsonb(sql, patch.config)},
        operations = ${patch.operations === undefined ? sql`operations` : toJsonb(sql, patch.operations)},
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

export async function upsertBillingProvider(
  sql: Sql,
  data: {
    id: string;
    name: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }
): Promise<void> {
  await sql`
    insert into billing_providers (id, name, enabled, config)
    values (${data.id}, ${data.name}, ${data.enabled ?? false}, ${toJsonb(sql, data.config ?? {})})
    on conflict (id) do update set
      name = excluded.name,
      enabled = excluded.enabled,
      config = excluded.config
  `;
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

export async function deleteEmptyFolders(sql: Sql, orgId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update folders as folder
    set deleted_at = now()
    where folder.org_id = ${orgId}
      and folder.deleted_at is null
      and not exists (
        select 1
        from files
        where files.org_id = ${orgId}
          and files.folder_id = folder.id
          and files.status <> 'deleted'
      )
    returning folder.id
  `;
  return rows.length;
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
    actualInputTokens?: number;
    actualOutputTokens?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await sql`
    insert into usage_ledger (org_id, run_id, provider, model, input_tokens, output_tokens, cost_micros, actual_input_tokens, actual_output_tokens, metadata)
    values (
      ${orgId}, ${data.runId},
      ${data.provider}, ${data.model},
      ${data.inputTokens}, ${data.outputTokens}, ${data.costMicros},
      ${data.actualInputTokens ?? null}, ${data.actualOutputTokens ?? null},
      ${toJsonb(sql, data.metadata ?? {})}
    )
  `;
}

export type RunUsageTotals = {
  input_tokens: number;
  output_tokens: number;
};

/**
 * The usage ledger is the billing authority.  Checkpoints are a convenience
 * for live resume, so a failed checkpoint must never make historical usage
 * disappear from a hydrated run.
 */
export async function getRunUsageTotals(
  sql: Sql,
  orgId: string,
  runId: string
): Promise<RunUsageTotals> {
  const rows = await sql<RunUsageTotals[]>`
    select
      coalesce(sum(coalesce(actual_input_tokens, input_tokens)), 0)::bigint as input_tokens,
      coalesce(sum(coalesce(actual_output_tokens, output_tokens)), 0)::bigint as output_tokens
    from usage_ledger
    where org_id = ${orgId} and run_id = ${runId}
  `;
  return {
    input_tokens: Number(rows[0]?.input_tokens ?? 0),
    output_tokens: Number(rows[0]?.output_tokens ?? 0)
  };
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
      ${data.before ? toJsonb(sql, data.before) : null},
      ${data.after ? toJsonb(sql, data.after) : null}
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

/**
 * Build a pg.Pool config from a connection profile. Used by Better Auth
 * (pg driver) and the Director checkpointer (pg-based PostgresSaver).
 */
export type PgPoolOptions = {
  poolMaxOverride?: number;
  poolMinOverride?: number;
  connectionTimeoutMsOverride?: number;
};

export function createPgPoolConfig(
  connectionString: string,
  poolOptions?: PgPoolOptions
): {
  connectionString: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl: Record<string, unknown>;
  query_timeout: number;
  keepAlive: boolean;
  keepAliveInitialDelayMillis: number;
  options?: string;
} {
  const profile = resolveConnectionProfile(connectionString);
  const url = new URL(profile.connectionString);
  const isPooler = profile.mode === "transaction" || profile.mode === "pooler-session";

  // Inject statement timeouts as connection options for pooler modes to
  // prevent pgBouncer from wedging connections in idle-in-transaction state.
  let options: string | undefined;
  if (isPooler) {
    options = "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=10000";
  }

  const sslConfig: Record<string, unknown> = { rejectUnauthorized: false };
  // For Supabase hosts, set the TLS SNI servername explicitly.
  const hostClass = classifySupabaseHost(url.hostname);
  if (hostClass !== "generic") {
    sslConfig.servername = url.hostname;
  }

  const poolMax = poolOptions?.poolMaxOverride ?? positiveIntegerEnv("DB_POOL_MAX", 10);
  const poolMin = poolOptions?.poolMinOverride ?? positiveIntegerEnv("DB_POOL_MIN", 1);
  const connectTimeoutMs = poolOptions?.connectionTimeoutMsOverride ?? positiveIntegerEnv("PG_CONNECT_TIMEOUT_MS", 10_000);

  return {
    connectionString: profile.connectionString,
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: connectTimeoutMs,
    ssl: sslConfig,
    query_timeout: positiveIntegerEnv("PG_QUERY_TIMEOUT_MS", 60_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    options,
  };
}

// ── Auth & Multi-Org ─────────────────────────────────────────────

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getProfile(sql: Sql, userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileRow[]>`
    select id, email, display_name, avatar_url, metadata, created_at, updated_at
    from profiles
    where id = ${userId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function upsertProfile(
  sql: Sql,
  userId: string,
  data: { email: string; displayName?: string | null; avatarUrl?: string | null }
): Promise<ProfileRow> {
  const rows = await sql<ProfileRow[]>`
    insert into profiles (id, email, display_name, avatar_url)
    values (${userId}, ${data.email}, ${data.displayName ?? null}, ${data.avatarUrl ?? null})
    on conflict (id) do update set
      email = excluded.email,
      display_name = coalesce(excluded.display_name, profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
      updated_at = now()
    returning id, email, display_name, avatar_url, metadata, created_at, updated_at
  `;
  return rows[0];
}

export type MembershipRow = {
  org_id: string;
  profile_id: string;
  role: string;
  created_at: string;
};

export type OrgWithMembership = {
  org_id: string;
  org_name: string;
  org_slug: string;
  role: string;
};

export async function getUserOrgs(sql: Sql, userId: string): Promise<OrgWithMembership[]> {
  return sql<OrgWithMembership[]>`
    select
      o.id as org_id,
      o.name as org_name,
      o.slug as org_slug,
      m.role::text as role
    from org_memberships m
    join orgs o on o.id = m.org_id
    where m.profile_id = ${userId}
      and o.deleted_at is null
    order by o.name asc
  `;
}

export async function getMembership(
  sql: Sql,
  userId: string,
  orgId: string
): Promise<MembershipRow | null> {
  const rows = await sql<MembershipRow[]>`
    select org_id, profile_id, role::text as role, created_at
    from org_memberships
    where profile_id = ${userId} and org_id = ${orgId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function createOrg(
  sql: Sql,
  name: string,
  slug: string,
  ownerId: string
): Promise<{ id: string; name: string; slug: string }> {
  const orgRows = await sql<{ id: string; name: string; slug: string }[]>`
    insert into orgs (name, slug)
    values (${name}, ${slug})
    returning id, name, slug
  `;
  const org = orgRows[0];
  if (!org) throw new Error("Failed to create org");

  await sql`
    insert into org_memberships (org_id, profile_id, role)
    values (${org.id}, ${ownerId}, 'owner')
    on conflict (org_id, profile_id) do nothing
  `;

  return org;
}

export async function addMember(
  sql: Sql,
  orgId: string,
  profileId: string,
  role: "admin" = "admin"
): Promise<MembershipRow> {
  const rows = await sql<MembershipRow[]>`
    insert into org_memberships (org_id, profile_id, role)
    values (${orgId}, ${profileId}, ${role})
    on conflict (org_id, profile_id) do update set role = excluded.role
    returning org_id, profile_id, role::text as role, created_at
  `;
  return rows[0];
}

export async function updateMemberRole(
  sql: Sql,
  orgId: string,
  profileId: string,
  role: "owner" | "admin"
): Promise<boolean> {
  const rows = await sql`
    update org_memberships
    set role = ${role}
    where org_id = ${orgId} and profile_id = ${profileId}
    returning org_id
  `;
  return rows.length > 0;
}

export async function removeMember(
  sql: Sql,
  orgId: string,
  profileId: string
): Promise<boolean> {
  const rows = await sql`
    delete from org_memberships
    where org_id = ${orgId} and profile_id = ${profileId}
    returning org_id
  `;
  return rows.length > 0;
}

export async function findProfileByEmail(
  sql: Sql,
  email: string
): Promise<ProfileRow | null> {
  const rows = await sql<ProfileRow[]>`
    select id, email, display_name, avatar_url, metadata, created_at, updated_at
    from profiles
    where email = ${email}
    limit 1
  `;
  return rows[0] ?? null;
}

// ── Invitations ────────────────────────────────────────────────────

export type InvitationRow = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
};

export type InvitationWithOrg = InvitationRow & {
  org_name: string;
};

export async function createInvitation(
  sql: Sql,
  orgId: string,
  email: string,
  role: string,
  invitedBy: string
): Promise<InvitationRow> {
  const rows = await sql<InvitationRow[]>`
    insert into invitations (org_id, email, role, invited_by)
    values (${orgId}, ${email}, ${role}, ${invitedBy})
    returning id, org_id, email, role::text as role, token, status, invited_by, created_at, expires_at
  `;
  return rows[0];
}

export async function findInvitationByToken(
  sql: Sql,
  token: string
): Promise<InvitationWithOrg | null> {
  const rows = await sql<InvitationWithOrg[]>`
    select i.id, i.org_id, i.email, i.role::text as role, i.token, i.status, i.invited_by, i.created_at, i.expires_at, o.name as org_name
    from invitations i
    join orgs o on o.id = i.org_id
    where i.token = ${token}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function findPendingInvitationsByEmail(
  sql: Sql,
  email: string
): Promise<InvitationWithOrg[]> {
  return sql<InvitationWithOrg[]>`
    select i.id, i.org_id, i.email, i.role::text as role, i.token, i.status, i.invited_by, i.created_at, i.expires_at, o.name as org_name
    from invitations i
    join orgs o on o.id = i.org_id
    where i.email = ${email} and i.status = 'pending' and i.expires_at > now()
  `;
}

export async function getOrgInvitations(
  sql: Sql,
  orgId: string
): Promise<InvitationRow[]> {
  return sql<InvitationRow[]>`
    select id, org_id, email, role::text as role, token, status, invited_by, created_at, expires_at
    from invitations
    where org_id = ${orgId}
    order by created_at desc
  `;
}

export async function acceptInvitation(
  sql: Sql,
  invitationId: string
): Promise<void> {
  await sql`
    update invitations set status = 'accepted'
    where id = ${invitationId}
  `;
}

export async function cancelInvitation(
  sql: Sql,
  invitationId: string
): Promise<boolean> {
  const rows = await sql`
    delete from invitations
    where id = ${invitationId}
    returning id
  `;
  return rows.length > 0;
}

// ── Credits ───────────────────────────────────────────────────────

export type CreditRow = {
  org_id: string;
  balance: number;
  lifetime_used: number;
  created_at: string;
  updated_at: string;
};

export async function getOrgCredits(sql: Sql, orgId: string): Promise<CreditRow | null> {
  const rows = await sql<CreditRow[]>`
    select org_id, balance, lifetime_used, created_at, updated_at
    from org_credits
    where org_id = ${orgId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function ensureOrgCredits(sql: Sql, orgId: string): Promise<CreditRow> {
  const rows = await sql<CreditRow[]>`
    insert into org_credits (org_id)
    values (${orgId})
    on conflict (org_id) do nothing
    returning org_id, balance, lifetime_used, created_at, updated_at
  `;
  if (rows[0]) return rows[0];

  const existing = await getOrgCredits(sql, orgId);
  if (existing) return existing;
  throw new Error("Failed to ensure org credits");
}

export async function debitOrgCredits(
  sql: Sql,
  orgId: string,
  amount: number,
  reason: string,
  runId?: string
): Promise<CreditRow> {
  const rows = await sql<CreditRow[]>`
    update org_credits
    set balance = balance - ${amount},
        lifetime_used = lifetime_used + ${amount},
        updated_at = now()
    where org_id = ${orgId} and balance >= ${amount}
    returning org_id, balance, lifetime_used, created_at, updated_at
  `;
  if (!rows[0]) throw new Error("Insufficient credits");

  await sql`
    insert into credit_transactions (org_id, amount, reason, run_id)
    values (${orgId}, -${amount}, ${reason}, ${runId ?? null})
  `;

  return rows[0];
}

export async function creditOrgBalance(
  sql: Sql,
  orgId: string,
  amount: number,
  reason: string,
  provider?: string,
  providerEventId?: string
): Promise<CreditRow> {
  const rows = await sql<CreditRow[]>`
    update org_credits
    set balance = balance + ${amount},
        updated_at = now()
    where org_id = ${orgId}
    returning org_id, balance, lifetime_used, created_at, updated_at
  `;
  if (!rows[0]) throw new Error("Org credits not found");

  await sql`
    insert into credit_transactions (org_id, amount, reason, provider, provider_event_id)
    values (${orgId}, ${amount}, ${reason}, ${provider ?? null}, ${providerEventId ?? null})
  `;

  return rows[0];
}

// ── Run metrics (Phase 0 instrumentation) ────────────────────────

export type RunMetricsRow = {
  run_id: string;
  org_id: string;
  type: string;
  status: string;
  auth_ms: number;
  harness_resolution_ms: number;
  run_creation_ms: number;
  file_load_ms: number;
  file_parse_ms: number;
  compaction_ms: number;
  provider_ttft_ms: number;
  first_byte_to_client_ms: number;
  event_persist_ms: number;
  run_finalize_ms: number;
  total_ms: number;
  db_query_count: number;
  db_total_ms: number;
  hidden_pre_stream_calls: number;
  input_tokens_estimate: number;
  system_prompt_tokens_estimate: number;
  provider_name: string | null;
  model_name: string | null;
  created_at: string;
};

export type RunMetricsInput = Omit<RunMetricsRow, "created_at">;

export async function upsertRunMetrics(sql: Sql, metrics: RunMetricsInput): Promise<void> {
  await sql`
    insert into run_metrics (
      run_id, org_id, type, status,
      auth_ms, harness_resolution_ms, run_creation_ms, file_load_ms, file_parse_ms,
      compaction_ms, provider_ttft_ms, first_byte_to_client_ms, event_persist_ms, run_finalize_ms,
      total_ms, db_query_count, db_total_ms, hidden_pre_stream_calls,
      input_tokens_estimate, system_prompt_tokens_estimate,
      provider_name, model_name
    )
    values (
      ${metrics.run_id}, ${metrics.org_id}, ${metrics.type}, ${metrics.status},
      ${metrics.auth_ms}, ${metrics.harness_resolution_ms}, ${metrics.run_creation_ms},
      ${metrics.file_load_ms}, ${metrics.file_parse_ms}, ${metrics.compaction_ms},
      ${metrics.provider_ttft_ms}, ${metrics.first_byte_to_client_ms},
      ${metrics.event_persist_ms}, ${metrics.run_finalize_ms},
      ${metrics.total_ms}, ${metrics.db_query_count}, ${metrics.db_total_ms},
      ${metrics.hidden_pre_stream_calls},
      ${metrics.input_tokens_estimate}, ${metrics.system_prompt_tokens_estimate},
      ${metrics.provider_name ?? null}, ${metrics.model_name ?? null}
    )
    on conflict (run_id) do update set
      status = excluded.status,
      auth_ms = excluded.auth_ms,
      harness_resolution_ms = excluded.harness_resolution_ms,
      run_creation_ms = excluded.run_creation_ms,
      file_load_ms = excluded.file_load_ms,
      file_parse_ms = excluded.file_parse_ms,
      compaction_ms = excluded.compaction_ms,
      provider_ttft_ms = excluded.provider_ttft_ms,
      first_byte_to_client_ms = excluded.first_byte_to_client_ms,
      event_persist_ms = excluded.event_persist_ms,
      run_finalize_ms = excluded.run_finalize_ms,
      total_ms = excluded.total_ms,
      db_query_count = excluded.db_query_count,
      db_total_ms = excluded.db_total_ms,
      hidden_pre_stream_calls = excluded.hidden_pre_stream_calls,
      input_tokens_estimate = excluded.input_tokens_estimate,
      system_prompt_tokens_estimate = excluded.system_prompt_tokens_estimate,
      provider_name = excluded.provider_name,
      model_name = excluded.model_name,
      created_at = now()
  `;
}

export async function getRunMetrics(sql: Sql, orgId: string, runId: string): Promise<RunMetricsRow | null> {
  const rows = await sql<RunMetricsRow[]>`
    select * from run_metrics where org_id = ${orgId} and run_id = ${runId} limit 1
  `;
  return rows[0] ?? null;
}

export async function listRecentRunMetrics(sql: Sql, orgId: string, limit = 50): Promise<RunMetricsRow[]> {
  return sql<RunMetricsRow[]>`
    select * from run_metrics
    where org_id = ${orgId}
    order by created_at desc
    limit ${limit}
  `;
}

export interface FinalizeTurnOptions {
  outputText: string;
  events: import("@spielos/core").RunEvent[];
  state: Record<string, unknown>;
  status: string;
  error: string | null;
  completedAt: string | null;
  isDirectorChat: boolean;
  longHorizon?: { pinnedState: unknown; milestones: unknown } | null;
  resumedFrom?: string;
}

export interface FinalizeTurnResult {
  run: RunRow;
  messages: ChatMessageRow[];
  chat: ChatRow | null;
}

export async function finalizeRunTurn(
  sql: Sql,
  orgId: string,
  runId: string,
  chatId: string,
  turnId: string | null,
  currentCheckpointVersion: number,
  opts: FinalizeTurnOptions
): Promise<FinalizeTurnResult> {
  return sql.begin(async (tx) => {
    const [run] = await tx<RunRow[]>`
      select * from runs
      where org_id = ${orgId} and id = ${runId}
      for update
    `;
    if (!run) throw new Error(`Run ${runId} not found`);

    let terminalStatus = opts.status;
    let errorMessage = opts.error;
    let finalCompletedAt = opts.completedAt;
    if (run.cancel_requested_at || run.status === "cancelled") {
      terminalStatus = "cancelled";
      errorMessage = null;
      finalCompletedAt = new Date().toISOString();
    } else if (run.pause_requested_at || run.status === "waiting_human") {
      terminalStatus = "waiting_human";
      errorMessage = null;
      finalCompletedAt = null;
    }

    const storedVersion = Number(run.checkpoint_version ?? 0);
    if (currentCheckpointVersion > 0 && storedVersion !== currentCheckpointVersion) {
      throw new Error(`Checkpoint version mismatch: stored=${storedVersion} expected=${currentCheckpointVersion}`);
    }

    const finalCheckpointVersion = storedVersion + 1;
    const stateJson = JSON.stringify(opts.state);

    // Insert events into run_events (not runs — no events column exists)
    if (opts.events.length > 0) {
      const [reserve] = await tx<{ base: number }[]>`
        update runs
        set next_event_sequence = next_event_sequence + ${opts.events.length}::bigint
        where org_id = ${orgId} and id = ${runId}
        returning (next_event_sequence - ${opts.events.length}::bigint) as base
      `;
      const base = Number(reserve?.base ?? 0);
      const values = opts.events.map((event) => ({
        org_id: orgId,
        run_id: runId,
        event_type: event.type,
        node_id: event.nodeId ?? null,
        node_title: event.nodeTitle ?? null,
        skill_id: event.skillId ?? null,
        skill_name: event.skillName ?? null,
        message: event.message,
        payload: event.payload,
        event_key: null,
        sequence: base
      }));
      await tx<RunEventRow[]>`
        with batch as (
          select row_number() over () as rn, record.*
          from jsonb_to_recordset(${toJsonb(tx, values as unknown as never)}) as record(
            org_id text, run_id text, event_type text,
            node_id text, node_title text, skill_id text, skill_name text,
            message text, payload jsonb, event_key text, sequence bigint
          )
        )
        insert into run_events (org_id, run_id, event_type, sequence, node_id, node_title, skill_id, skill_name, message, payload, event_key)
        select
          batch.org_id::uuid,
          batch.run_id::uuid,
          batch.event_type::event_type,
          batch.sequence + batch.rn - 1,
          batch.node_id,
          batch.node_title,
          batch.skill_id,
          batch.skill_name,
          batch.message,
          batch.payload,
          batch.event_key
        from batch
      `;
    }

    await tx`
      update runs set
        state = ${stateJson}::jsonb,
        outputs = ${tx.json({ text: opts.outputText })},
        status = ${terminalStatus},
        error = ${errorMessage},
        checkpoint_version = ${finalCheckpointVersion},
        completed_at = ${finalCompletedAt}
      where org_id = ${orgId} and id = ${runId}
    `;

    const idempotencyKey = turnId
      ? `run:${runId}:turn:${turnId}:final`
      : opts.resumedFrom
        ? `run:${runId}:resume:${opts.resumedFrom}`
        : null;

    let messages: ChatMessageRow[] = [];
    if (opts.outputText && idempotencyKey) {
      const existing = await tx<ChatMessageRow[]>`
        select * from chat_messages
        where org_id = ${orgId} and chat_id = ${chatId}
          and metadata->>'idempotencyKey' = ${idempotencyKey}
        limit 1
      `;
      if (existing.length === 0) {
        const insertMeta: Record<string, unknown> = {
          runId,
          turnId: turnId ?? undefined,
          kind: "assistant_reply",
          idempotencyKey,
          ...(opts.isDirectorChat ? { executionMode: "director" } : {}),
          ...(opts.resumedFrom ? { resumedFrom: opts.resumedFrom } : {})
        };
        const [seqRes] = await tx<{ sequence: number }[]>`
          update chats
          set next_message_sequence = next_message_sequence + 1
          where org_id = ${orgId} and id = ${chatId}
          returning (next_message_sequence - 1) as sequence
        `;
        const seq = seqRes?.sequence ?? 0;
        messages = await tx<ChatMessageRow[]>`
          insert into chat_messages (org_id, chat_id, role, body, metadata, created_at, sequence_number)
          values (
            ${orgId}, ${chatId}, 'assistant', ${opts.outputText},
            ${tx.json(insertMeta as any)}, ${new Date().toISOString()}, ${seq}
          )
          returning *
        `;
      } else {
        messages = existing;
      }
    }

    const chatMetaUpdate: Record<string, unknown> = {
      activeRunId: terminalStatus === "waiting_human" ? runId : null,
      lastRunId: runId
    };
    if (opts.longHorizon) {
      chatMetaUpdate.pinnedState = opts.longHorizon.pinnedState;
      chatMetaUpdate.milestones = opts.longHorizon.milestones;
    }

    const [chat] = await tx<ChatRow[]>`
      update chats set
        metadata = metadata || ${tx.json(chatMetaUpdate as any)},
        updated_at = ${new Date().toISOString()}
      where org_id = ${orgId} and id = ${chatId}
      returning *
    `;

    const [finalRun] = await tx<RunRow[]>`
      select * from runs where org_id = ${orgId} and id = ${runId}
    `;

    return { run: finalRun!, messages, chat: chat ?? null };
  });
}

// ── Relation queries ─────────────────────────────────────────────
export {
  listRoleSkills,
  listWorkflowNodeRoles,
  listWorkflowNodeSkills,
  listWorkflowNodeFiles,
  listSkillConnectionOps,
} from "./relations.ts";
export type { SkillConnectionOp, FileRelationRow } from "./relations.ts";

// ── Workspace settings ────────────────────────────────────────────

export type WorkspaceSettingsRow = {
  org_id: string;
  default_execution_mode: string;
  default_model_id: string | null;
  context_limits: Record<string, unknown>;
  retrieval_policy: Record<string, unknown>;
  director_runtime_policy: Record<string, unknown>;
  approval_policy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getWorkspaceSettings(sql: Sql, orgId: string): Promise<WorkspaceSettingsRow | null> {
  const rows = await sql<WorkspaceSettingsRow[]>`
    select * from workspace_settings where org_id = ${orgId} limit 1
  `;
  return rows[0] ?? null;
}

export async function upsertWorkspaceSettings(
  sql: Sql,
  orgId: string,
  patch: Record<string, unknown>
): Promise<WorkspaceSettingsRow> {
  const exists = await getWorkspaceSettings(sql, orgId);
  if (exists) {
    const result = await sql<WorkspaceSettingsRow[]>`
      update workspace_settings set
        default_execution_mode = coalesce(${patch.defaultExecutionMode as string ?? null}, default_execution_mode),
        default_model_id = ${patch.defaultModelId !== undefined ? (patch.defaultModelId as string | null) : sql`default_model_id`},
        context_limits = ${patch.contextLimits !== undefined ? toJsonb(sql, patch.contextLimits as Record<string, unknown>) : sql`context_limits`},
        retrieval_policy = ${patch.retrievalPolicy !== undefined ? toJsonb(sql, patch.retrievalPolicy as Record<string, unknown>) : sql`retrieval_policy`},
        director_runtime_policy = ${patch.directorRuntimePolicy !== undefined ? toJsonb(sql, patch.directorRuntimePolicy as Record<string, unknown>) : sql`director_runtime_policy`},
        approval_policy = ${patch.approvalPolicy !== undefined ? toJsonb(sql, patch.approvalPolicy as Record<string, unknown>) : sql`approval_policy`},
        updated_at = now()
      where org_id = ${orgId}
      returning *
    `;
    return result[0];
  }
  const created = await sql<WorkspaceSettingsRow[]>`
    insert into workspace_settings (org_id, default_execution_mode, default_model_id, context_limits, retrieval_policy, director_runtime_policy, approval_policy)
    values (
      ${orgId},
      ${(patch.defaultExecutionMode as string) ?? "director"},
      ${patch.defaultModelId as string ?? null},
      ${toJsonb(sql, (patch.contextLimits as Record<string, unknown>) ?? {})},
      ${toJsonb(sql, (patch.retrievalPolicy as Record<string, unknown>) ?? {})},
      ${toJsonb(sql, (patch.directorRuntimePolicy as Record<string, unknown>) ?? {})},
      ${toJsonb(sql, (patch.approvalPolicy as Record<string, unknown>) ?? {})}
    )
    on conflict (org_id) do update set updated_at = now()
    returning *
  `;
  return created[0];
}

// ── Child run budgets (Phase I) ──────────────────────────────────

export type ChildRunBudgetRow = {
  parent_run_id: string;
  capability_call_count: number;
  child_run_count: number;
  active_child_runs: number;
  child_input_tokens: number;
  tool_calls_count: number;
};

export async function ensureChildRunBudget(sql: Sql, parentRunId: string): Promise<void> {
  await sql`
    insert into child_run_budgets (parent_run_id)
    values (${parentRunId})
    on conflict (parent_run_id) do nothing
  `;
}

export async function reserveChildRunSlot(
  sql: Sql,
  parentRunId: string,
  maxChildRuns: number,
  maxParallelChildRuns: number
): Promise<boolean> {
  const rows = await sql<ChildRunBudgetRow[]>`
    update child_run_budgets
    set child_run_count = child_run_count + 1,
        active_child_runs = active_child_runs + 1
    where parent_run_id = ${parentRunId}
      and child_run_count < ${maxChildRuns}
      and active_child_runs < ${maxParallelChildRuns}
    returning *
  `;
  return rows.length > 0;
}

export async function releaseChildRunSlot(
  sql: Sql,
  parentRunId: string,
  inputTokens?: number
): Promise<void> {
  await sql`
    update child_run_budgets
    set active_child_runs = greatest(0, active_child_runs - 1),
        child_input_tokens = child_input_tokens + ${inputTokens ?? 0}
    where parent_run_id = ${parentRunId}
  `;
}

export async function incrementCapabilityCall(
  sql: Sql,
  parentRunId: string,
  capability: string,
  maxCalls: number
): Promise<boolean> {
  const rows = await sql<{ capability_call_count: number }[]>`
    update child_run_budgets
    set capability_call_count = capability_call_count + 1
    where parent_run_id = ${parentRunId}
      and capability_call_count < ${maxCalls}
    returning capability_call_count
  `;
  return rows.length > 0;
}

export async function getChildRunBudget(
  sql: Sql,
  parentRunId: string
): Promise<ChildRunBudgetRow | null> {
  const rows = await sql<ChildRunBudgetRow[]>`
    select * from child_run_budgets where parent_run_id = ${parentRunId} limit 1
  `;
  return rows[0] ?? null;
}

// ── Tool invocations (Phase J) ──────────────────────────────────

export type ToolInvocationRow = {
  id: string;
  org_id: string;
  parent_run_id: string;
  logical_key: string;
  capability_id: string;
  input_hash: string;
  attempt: number;
  status: string;
  result_ref: string | null;
  external_receipt: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function tryClaimToolInvocation(
  sql: Sql,
  orgId: string,
  parentRunId: string,
  logicalKey: string,
  capabilityId: string,
  inputHash: string
): Promise<ToolInvocationRow | null> {
  // Check for existing completed invocation first (dedup)
  const existing = await sql<ToolInvocationRow[]>`
    select * from tool_invocations
    where org_id = ${orgId}
      and logical_key = ${logicalKey}
      and input_hash = ${inputHash}
    limit 1
  `;
  if (existing.length > 0) {
    if (existing[0].status === "completed" || existing[0].status === "failed") {
      return existing[0];
    }
    return null; // concurrent claim — already in progress
  }

  // Create a new running invocation
  try {
    const rows = await sql<ToolInvocationRow[]>`
      insert into tool_invocations (org_id, parent_run_id, logical_key, capability_id, input_hash, status)
      values (${orgId}, ${parentRunId}, ${logicalKey}, ${capabilityId}, ${inputHash}, 'running')
      returning *
    `;
    return rows[0] ?? null;
  } catch {
    // Unique constraint violation — concurrent claim
    return null;
  }
}

export async function completeToolInvocation(
  sql: Sql,
  id: string,
  status: "completed" | "failed",
  result?: string,
  receipt?: string
): Promise<void> {
  await sql`
    update tool_invocations
    set status = ${status},
        result_ref = ${result ?? null},
        external_receipt = ${receipt ?? null},
        completed_at = now()
    where id = ${id}
  `;
}

// ── Child run budgets (Phase I) ──────────────────────────────────
