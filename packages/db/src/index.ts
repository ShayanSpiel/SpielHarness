import postgres from "postgres";
import { randomUUID } from "node:crypto";

type PostgresParameter = postgres.SerializableParameter<never>;
type SqlLike = Pick<postgres.Sql<{}>, "json">;

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
  return sql.json(value as never);
}

export type Sql = ReturnType<typeof postgres>;

export type DatabaseConnectionMode = "direct" | "session" | "transaction" | "pooler-session";

const VALID_MODES: DatabaseConnectionMode[] = ["direct", "session", "transaction", "pooler-session"];

function isSupabasePoolerHost(host: string): boolean {
  return /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(host) || /supavisor/i.test(host);
}

function isSupabaseDirectHost(host: string): boolean {
  return /^db\.[a-z0-9-]+\.supabase\.co$/i.test(host);
}

function extractSupabaseProjectRef(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const poolerMatch = host.match(/^aws-[\w-]+\.pooler\.supabase\.com$/i);
    if (poolerMatch) {
      const userMatch = url.username.match(/^postgres\.([a-z0-9]+)$/i);
      if (userMatch) return userMatch[1];
    }
    const directMatch = host.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i);
    if (directMatch) return directMatch[1];
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the connection string the runtime should actually use. Order:
 *   1. `DATABASE_URL` if it is a `DATABASE_URL` that is *not* a Supabase
 *      session-pooler URL (transaction pooler on 6543, direct on 5432 to
 *      `db.<ref>.supabase.co`, or a non-Supabase URL).
 *   2. If the URL is a Supabase **session** pooler (port 5432 to
 *      `pooler.supabase.com`) and `DATABASE_DIRECT_FROM_POOLER` is not
 *      "0", rewrite it to the direct equivalent. The session pooler is
 *      the wrong architecture for `pg.Pool` because pgBouncer in session
 *      mode is hostile to client-side connection rotation.
 *   3. `DATABASE_URL_DIRECT` if set wins over the auto-rewrite.
 *   4. The original `connectionString` unchanged.
 *
 * The transaction pooler (port 6543) is left alone — it is the
 * recommended Supabase target for this kind of app and has 60+ slots on
 * the free tier, vs 4 on the direct endpoint.
 */
export function resolveConnectionString(connectionString: string): string {
  const explicitDirect = process.env.DATABASE_URL_DIRECT?.trim();
  if (explicitDirect) {
    return explicitDirect;
  }
  const autoDirect = process.env.DATABASE_DIRECT_FROM_POOLER !== "0";
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    if (!isSupabasePoolerHost(host)) return connectionString;
    // Only rewrite the SESSION pooler (port 5432). The transaction pooler
    // (port 6543) is already the right architecture for a persistent
    // Node app and bypassing it would break the connection when the
    // direct endpoint DNS is not yet propagated.
    const port = url.port || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");
    if (port === "6543") return connectionString;
    if (!autoDirect) return connectionString;
    const projectRef = extractSupabaseProjectRef(connectionString);
    if (!projectRef) return connectionString;
    const direct = new URL(connectionString);
    direct.username = "postgres";
    direct.host = `db.${projectRef}.supabase.co`;
    direct.port = "5432";
    return direct.toString();
  } catch {
    return connectionString;
  }
}

export function resolveConnectionMode(connectionString: string): DatabaseConnectionMode {
  // `direct`, `transaction`, and `pooler-session` are explicit overrides.
  // `session` (or unset) is the "infer from URL" mode — same default the
  // original code used, but it now also recognizes Supabase pooler hosts
  // and disables prepared statements for them, which is the difference
  // between 22 s `write CONNECT_TIMEOUT` and sub-second queries.
  const raw = process.env.DATABASE_CONNECTION_MODE?.trim().toLowerCase();
  if (raw === "direct" || raw === "transaction" || raw === "pooler-session") {
    return raw as DatabaseConnectionMode;
  }
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const port = url.port
      || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");
    // Port takes precedence: the same pooler host can be either session
    // (5432) or transaction (6543) mode, and the port is the cheapest,
    // most reliable signal.
    if (port === "6543") return "transaction";
    if (isSupabaseDirectHost(host)) return "direct";
    if (isSupabasePoolerHost(host)) return "pooler-session";
    if (port === "5432") return "session";
  } catch {
    // fall through
  }
  return "session";
}

export function shouldUsePreparedStatements(mode: DatabaseConnectionMode): boolean {
  // Pooler-session (pgBouncer in front) and transaction mode poolers do not
  // allow session-level prepared statements — the prepared statement lives on
  // a physical connection that may not be the one the next statement lands on.
  return mode === "direct" || mode === "session";
}

export function createSql(connectionString: string): Sql {
  const effective = resolveConnectionString(connectionString);
  const parsed = new URL(effective);
  const projectRef = parsed.searchParams.get("host");
  const ssl: Record<string, unknown> = { rejectUnauthorized: false };
  const connection: Record<string, string> = {};
  if (projectRef) {
    ssl.servername = projectRef;
    connection.host = projectRef;
  }
  const mode = resolveConnectionMode(effective);
  const prepare = shouldUsePreparedStatements(mode);
  const opts: Record<string, unknown> = {
    max: Math.max(1, Number(process.env.DB_POOL_MAX) || 1),
    min: 0,
    idle_timeout: 30,
    connect_timeout: 5,
    prepare,
    ssl,
    connection,
    // TCP keep-alive prevents Supabase's server-side idle reaper from
    // silently closing connections that the postgres-js client still
    // believes are healthy.
    keep_alive: 30,
    onnotice: () => undefined,
    transform: { undefined: null },
  };
  const sql = postgres(effective, opts as any);
  if (process.env.NODE_ENV !== "production") {
    const original = effective === connectionString ? "default" : "rewritten-from-pooler";
    console.info(`[db] mode=${mode} prepare=${prepare} source=${original}`);
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
 * Wrap a postgres.js Sql instance so every wire-bound query increments
 * `__counter.count` and contributes its wall time to `__counter.totalMs`.
 *
 * Implementation note: a naive Proxy on the tagged-template function
 * breaks postgres.js sub-templates (`sql\`DEFAULT\`` embedded inside a
 * parent query) because every `Query` instance is a thenable and
 * calling `.then()` on it triggers `handle()` -> actual wire execution.
 * We instead wire the existing `debug` callback, which fires only on
 * queries that are about to be sent to the server. This naturally
 * excludes Builder/Identifier fragments that never reach the wire.
 */
export function instrumentSql(sql: Sql): InstrumentedSql {
  const counter: SqlCounter = { count: 0, totalMs: 0 };
  type PostgresDebug = (connection: number, query: string, parameters: unknown[], paramTypes: unknown[]) => void;
  const optionsWithDebug = sql.options as Sql["options"] & {
    debug?: PostgresDebug | false;
  };
  const previousDebug = optionsWithDebug.debug;
  const wireDebug: PostgresDebug = (connection, query, parameters, paramTypes) => {
    const start = performance.now();
    counter.count += 1;
    const finalize = () => {
      counter.totalMs += performance.now() - start;
      if (typeof previousDebug === "function") previousDebug(connection, query, parameters, paramTypes);
    };
    if (typeof process !== "undefined" && typeof process.nextTick === "function") {
      process.nextTick(finalize);
    } else {
      setTimeout(finalize, 0);
    }
  };
  optionsWithDebug.debug = wireDebug;
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

export async function getOrchestratorPrompt(sql: Sql, orgId: string): Promise<FileRow | null> {
  const rows = await sql<FileRow[]>`
    select id, org_id, folder_id, file_type, status, title, body, content_format,
           metadata, current_version, created_at, updated_at
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
      ${toJsonb(sql, input.metadata ?? {})}
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
        metadata = ${patch.metadata === undefined ? sql`metadata` : toJsonb(sql, patch.metadata)}
    where org_id = ${orgId} and id = ${id} and deleted_at is null
    returning id, org_id, folder_id, file_type, status, title, body, content_format,
              metadata, current_version, created_at, updated_at
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
    returning id, org_id, folder_id, file_type, status, title, body, content_format,
              metadata, current_version, created_at, updated_at
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
    select id, org_id, chat_id, workflow_id, type,
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
    insert into runs (id, org_id, chat_id, workflow_id, type, prompt, status, inputs,
                      definition_snapshot, idempotency_key, requested_by, graph_version)
    values (
      ${data.id ?? sql`DEFAULT`}, ${orgId}, ${data.chatId ?? null}, ${data.workflowId ?? null},
      ${data.type}, ${data.prompt}, 'running',
      ${toJsonb(sql, data.inputs)}, ${toJsonb(sql, data.definitionSnapshot)},
      ${data.idempotencyKey ?? null}, ${data.requestedBy ?? null}, ${data.graphVersion ?? null}
    )
    returning id, org_id, chat_id, workflow_id, type,
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
    select id, org_id, chat_id, workflow_id, type,
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
    select id, org_id, chat_id, workflow_id, type,
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
          completed_at = ${input.completedAt === undefined ? sql`completed_at` : input.completedAt}
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
    values (${orgId}, ${chatId}, ${role}, ${body}, ${toJsonb(sql, metadata)})
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
      values (${orgId}, ${chatId}, ${m.role}, ${m.body}, ${toJsonb(sql, m.metadata ?? {})})
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
