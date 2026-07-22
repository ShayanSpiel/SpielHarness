# SpielHarness — Architecture Audit & Implementation Plan

## Session Context

- **Prompt 1**: SSE protocol and streaming reliability fixes — committed and verified.
- **Prompt 2**: Database and pipeline repairs (connection profiles, pool ownership, checkpoint setup, error classification, fast path, snapshots, migration tooling, tenant integrity) — committed and verified.
- **This document**: Architecture audit for Prompt 3 (SpielHarness) and phased implementation plan.

---

## 1. Current Architecture

### Repository Structure

```
spielos/
├── apps/web/                    Next.js application
│   ├── app/                     Routes (pages + API)
│   ├── components/              React components
│   └── lib/                     Server/client libraries
├── packages/
│   ├── core/                    Zod schemas, types, pure functions
│   ├── db/                      PostgreSQL client, queries, migrations
│   ├── graph/                   LangGraph runtime (workflow, chat, Director)
│   ├── providers/               Model provider adapters (OpenAI, Mistral, Anthropic)
│   ├── evals/                   Rubric evaluation engine
│   └── design-system/           UI primitives, tokens, icons
├── supabase/seed/               Seed files (roles, skills, migrations)
├── tests/                       34 unit test files (~186 tests)
├── tests/e2e/                   3 Playwright test files (~26 tests)
├── scripts/                     db-migrate, db-verify, db-reset
└── docs/                        12 documentation files
```

### Data Model

**File-backed harness**: Every entity (role, skill, workflow, eval, prompt, strategy, knowledge, template) lives in the `files` table with a `file_type` discriminator and a `metadata` JSONB column. There is no typed spec table — runtime parsing relies on `metadata as X` casts.

Key tables:
- `files` — universal entity storage (`file_type` enum + `status` + `metadata` JSONB)
- `file_relations` — cross-entity references (used for `contextSlugs` but not consistently populated)
- `models` — LLM provider configs (per-org)
- `connections` — integration configs (per-org)
- `runs` — execution records with `definition_snapshot` JSONB (immutable at run time)
- `run_events` — ordered event log per run
- `chats` / `chat_messages` — conversation storage
- `langgraph_checkpoints*` — Director checkpoint tables
- `_migration_ledger` — migration tracking

### Execution Flow

```
Client → POST /api/runs/execute
  → server.ts: getOrg() [auth + org resolution]
  → execution-service.ts: resolveExecution()
    [parses harness files, resolves target, loads models, builds RunRequest]
  → execute/route.ts: streamRun | streamChatRun | streamDirectorRun
    [LangGraph executor, yields SSE frames]
  → atomicCheckpoint() [durable state at each milestone]
  → finalizeRunTurn() [persist output, events, chat messages]
```

### Director Flow

```
resolveExecution()
  → compileDirector()
    → buildDirectorSystemPrompt()
    → buildRoleSubagents()    [one SubAgent per non-orchestrator active role]
    → buildDirectorTools()    [execute_workflow, execute_skill_*, execute_eval_*]
    → createDeepAgent()       [deepagents runtime with summarization]
  → streamDirectorRun()
    → agent.stream()          [deepagents iterator]
    → mapDirectorValues()     [v3 stream → RunYield events]
  → buildDirectorToolContext()
    → runChildWorkflow/Skill/Eval [child run creation + streaming]
```

---

## 2. Confirmed Issues

### 2.1 Duplicated Code

| Code | File 1 | File 2 |
|------|--------|--------|
| `stableUuid()` | `execution-service.ts:42` | `default-models.ts:19` |
| `evalFileToSkill()` | `execution-service.ts:774` | `director-tools.ts:15` |
| `resolveDirectExecutorRole()` | `execution-service.ts:848` | `director-tools.ts:457` |
| Connection-param casting pattern | Applied in 3 separate route files | Different `as` casts for same shapes |

### 2.2 Unsafe `as` Casts

All in `execution-service.ts`:
- `file_type as FileRecord["fileType"]` (lines 55-56) — DB enum to TS type, no validation
- `kind as Connection["kind"]` (line 450)
- `status as Connection["status"]` (line 451)
- `o.effect as "read" | "write" | "send" | "destructive" | undefined` (line 458)
- `o.method as string | undefined` (line 459)
- `o.path as string | undefined` (line 460)
- `o.inputParam as string | undefined` (line 461)
- `params.metadata as Record<string, unknown>` (lines 483, 516)

In `default-models.ts`:
- `configured as ModelCapabilities["reasoningEffort"]` (line 30)

### 2.3 Architecture Gaps

#### Gap 1: No Canonical Harness Hierarchy
- Roles, skills, workflows, evals, knowledge, prompts, templates all live in `files` table
- `metadata` JSONB is the "type system" — no Zod validation on read
- No separation between content (knowledge/strategy/prompts) and harness (roles/skills/workflows/evals)
- `file_relations` table exists but is not the authoritative relationship store at runtime

#### Gap 2: Unvalidated Metadata
- `parseRoleFile()` reads `row.metadata.skillIds || row.metadata.skills || []` — fallback chain
- `parseSkillFile()` reads `row.metadata.bindings || []` — no validation
- `parseWorkflowFile()` reads `row.metadata.nodes as WorkflowNode[]` — direct cast
- `parseEvalFile()` reads `row.metadata.rules || []` — no rule validation
- Entity parsing does not validate against Zod schemas before returning

#### Gap 3: Implicit Workflow Topology
- `normalizeWorkflow()` in `execution-service.ts` auto-generates sequential edges when `edges` array is empty (line ~598)
- This means a workflow with 3 nodes and 0 edges runs as A→B→C, which may not match the author's intent
- No validation that the auto-generated topology makes sense
- No explicit "sequential" mode marker — runtime infers from empty edges

#### Gap 4: Non-Deterministic Executor Selection
- `resolveDirectExecutorRole()` iterates `Object.values(roles)` looking for the first role whose `skillIds` includes the target skill
- Falls back to the orchestrator role if no role owns the skill
- Order of iteration over `Object.values(roles)` is insertion-order, not semantic
- A skill could be owned by multiple roles — silently picks first

#### Gap 5: Lifecycle Mixed with Enablement
- `fileStatusSchema = z.enum(["draft", "active", "archived", "deleted"])`
- `status === "active"` means both "published" AND "available for execution"
- `status === "draft"` means "not published" AND "not available for execution"
- No way to mark a published role as "disabled without unpublishing"
- No `enabled` boolean separate from lifecycle
- No `validation_status` — invalid entities are silently excluded from search results

#### Gap 6: No Workspace Settings Authority
- Default model selection: `body.modelId` → orchestrator role's `modelId` → workflow role's modelId → first enabled model
- Director runtime policy: found via `files.file_type === "runtime_policy"` — file-based, not workspace-settings-based
- Context limits, memory policy, approval policy: scattered across env vars, file metadata, and code defaults
- No single typed `workspace_settings` source

#### Gap 7: No Compiled Capability Snapshot
- Every `resolveExecution()` call re-parses all harness files from scratch
- No cache key / workspace revision
- Director and Direct modes run separate `resolveExecution` logic (even though they use the same files)
- `definitionSnapshot` in the run record is created AFTER parsing, not from a shared compilation

#### Gap 8: Weak Director Verification
- `streamDirectorRun` yields `done` with `"completed"` if the deepagents loop finishes without error
- Verification only checks that node outputs are non-empty and `verification.status !== "failed"`
- No evidence-based completion — no check for required artifacts, tool calls, child runs, or eval thresholds
- `mapDirectorValues` does not compile a completion verdict from success criteria — it yields `done` when the deepagents stream is exhausted

#### Gap 9: In-Memory Child Budgets
- `guarded()` in `director-tools.ts` tracks `callsPerCapability`, `childRunCount`, `activeChildRuns` in closures
- These counters are lost on process restart
- Concurrent child runs from two requests to the same parent run could both pass the budget check
- No transaction around budget allocation

#### Gap 10: No Idempotent Tool Invocation
- `runChildStream` in `director-tools.ts` creates a new child run on each call
- There is no invocation journal — retrying a failed tool call creates a duplicate
- Side-effect tools (write_file, send email, publish) are not idempotent
- No logical invocation key or dedup mechanism

#### Gap 11: Dead Code / Dead Paths

Confirmed:
- `ProjectSession` / `ProjectRevision` — tables exist, schemas exist in core, but no UI or API routes consume them after the project-session refactor
- `orchestrationPlanSchema`, `orchestrationStepSchema` — legacy Phase 1 schemas, not used by current Director
- `ExecutionKind` enum — `"orchestrator" | "workflow" | "tool" | "delegation" | "revision"` — used in migration but not verified
- `chatTurnEnvelopeSchema` — defined in core, not used at runtime (replaced by SSE frames)
- Several adapters in `@spielos/providers` may be dead (gmail, calendar, duckduckgo — check)

---

## 3. Phased Implementation Plan

### Phase A — Schema Validation & Safe Parsing (Rules 1, 2)

**Objective**: Replace all `as` casts with validated Zod parsing. Invalid entities produce structured diagnostics instead of crashing or being silently excluded.

**Changes**:

1. **Create `packages/core/src/validate.ts`**
   ```typescript
   export type EntityDiagnostic = {
     entityId: string;
     entityType: "role" | "skill" | "workflow" | "eval";
     field: string;
     message: string;
     value?: unknown;
   };
   export type EntityResult<T> = { ok: true; value: T } | { ok: false; diagnostics: EntityDiagnostic[] };
   export function safeParseRole(data: unknown): EntityResult<Role>
   export function safeParseSkill(data: unknown): EntityResult<Skill>
   export function safeParseWorkflow(data: unknown): EntityResult<WorkflowFile>
   export function safeParseEval(data: unknown): EntityResult<EvalFile>
   export function validateHarnessEntities(files: FileRecord[]): {
     roles: Record<string, Role>;
     skills: Record<string, Skill>;
     workflows: Record<string, WorkflowFile>;
     evals: Record<string, EvalFile>;
     diagnostics: EntityDiagnostic[];
   }
   ```

2. **Fix `parseRoleFile` in `packages/core/src/index.ts`**
   - Replace `metadata.skillIds || metadata.skills || []` with `roleSchema.shape.skillIds.parse(...)` after constructing the Role object
   - Parse `modelId` through Zod instead of `as string | null`
   - Wrap in try/catch producing `EntityDiagnostic`

3. **Fix `parseSkillFile`**
   - Parse `bindings` through `skillBindingSchema` instead of `metadata.bindings as SkillBinding[]`
   - Parse `humanQuestions` through `humanInputQuestionSchema`
   - Parse `evalRules` through `evalRuleSchema`

4. **Fix `parseWorkflowFile`**
   - Parse `nodes` through `z.array(workflowNodeSchema)` instead of `as WorkflowNode[]`
   - Parse `edges` through `z.array(workflowEdgeSchema)` instead of `as WorkflowEdge[]`

5. **Fix `parseEvalFile`**
   - Parse `rules` through `z.array(evalRuleSchema)` instead of `as EvalRule[]`
   - Parse `loopConfig` through `loopConfigWithDelaySchema`

6. **Fix `fileRowToRecord` in `execution-service.ts`**
   - Replace `file_type as FileRecord["fileType"]` with `fileTypeSchema.parse(row.file_type)`
   - Replace `status as FileRecord["status"]` with `fileStatusSchema.parse(row.status)`

7. **Fix connection casting in `execution-service.ts`**
   - Replace `kind as Connection["kind"]` with `connectionKindSchema.parse(c.kind)`
   - Replace `status as Connection["status"]` with `connectionStatusSchema.parse(c.status)`
   - Replace `effect as ...` with `z.enum(["read","write","send","destructive"]).parse(o.effect)`

8. **Consume `validateHarnessEntities` in `resolveExecution`**
   - Replace the `indexBy`/`parseRoleFile` chain with `validateHarnessEntities`
   - Store diagnostics in execution context
   - Invalid entities: log diagnostics, exclude from execution, remain in UI

**Files affected**: `packages/core/src/index.ts`, `packages/core/src/validate.ts` (new), `apps/web/lib/execution-service.ts`
**Tests**: 5 new unit tests for safeParse + validateHarnessEntities
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase B — Normalize Relationships (Rule 3)

**Objective**: One authoritative relationship model. Stable IDs everywhere. No slug-based fallback in runtime paths.

**Changes**:

1. **Create `0023_file_relations_migration.sql`**
   - Add `relation_type` enum: `role_skill | workflow_node_role | workflow_node_skill | workflow_node_file | skill_connection_operation | role_model`
   - Add `ordering` column (integer, nullable — meaningful for topological order)
   - Add unique constraint on `(org_id, source_id, relation_type, target_id)`
   - Add FK constraints enforcing same-workspace ownership
   - Backfill from existing `metadata` arrays

2. **Create `relationRepositories` in `packages/db/src/relations.ts`**
   ```typescript
   export function listRoleSkills(sql: Sql, orgId: string, roleId: string): Promise<string[]>
   export function listWorkflowNodeRoles(sql: Sql, orgId: string, workflowId: string): Promise<Map<string, string>>
   export function listWorkflowNodeSkills(sql: Sql, orgId: string, workflowId: string): Promise<Map<string, string[]>>
   export function listWorkflowNodeFiles(sql: Sql, orgId: string, workflowId: string): Promise<Map<string, string[]>>
   export function listSkillConnectionOps(sql: Sql, orgId: string, skillId: string): Promise<Array<{connectionId: string; operation: string}>>
   ```

3. **Update `parseRoleFile` to use relation table**
   - Replace `metadata.skillIds` fallback chain with DB query from `file_relations`

4. **Update `parseWorkflowFile` to use relation table**
   - Replace `node.skillIds` from metadata with DB query
   - Replace `node.fileIds` from metadata with DB query

5. **Migrate legacy slug references**
   - Find all file_relations with slug-based target_id
   - Resolve to stable IDs
   - Report unresolvable references as diagnostics
   - Fail execution if active entities have unresolvable references

**Files affected**: `packages/db/migrations/0023_*.sql`, `packages/db/src/relations.ts` (new), `packages/core/src/index.ts`
**Tests**: 3 new tests for relation resolution, slug migration, cross-workspace rejection
**Verification**: `npm run typecheck && npm run lint && npm run test && npm run db:migrate && npm run db:verify`

---

### Phase C — Make Workflow Topology Explicit (Rule 3)

**Objective**: No auto-generated edges. Every workflow must explicitly define topology.

**Changes**:

1. **Add topology mode to `workflowFileSchema`**
   ```typescript
   export const workflowTopologySchema = z.enum(["dag", "sequential"]);
   ```
   - Add to `workflowFileSchema` as optional field, defaults to `"dag"` for existing workflows with edges, `null` for edges-only workflows that need explicit setting

2. **Create migration converter**
   - For workflows with 0 edges and `nodes.length > 0`: detect if they were implicitly sequential
   - Set `topology: "sequential"` and auto-generate edges as a one-time migration
   - Report ambiguous cases (single node → always explicit; zero nodes → invalid)

3. **Remove auto-edge generation from `normalizeWorkflow`**
   - Delete the `if (edges.length === 0 && nodes.length > 1)` block
   - Replace with rejection: workflow with no edges and non-sequential mode → invalid

4. **Add DAG validation**
   - Unique node IDs (already partially checked)
   - Unique edge IDs
   - All source/target nodes exist
   - At least one entry node (no incoming edges)
   - At least one terminal node (no outgoing edges)
   - No cycles (DFS, `hasCycle` already exists)
   - All nodes reachable from entry
   - All nodes can reach a terminal
   - Validate `evalInput.nodeId` references exist
   - Validate `loopConfig.evalId` references exist

**Files affected**: `packages/core/src/index.ts`, `apps/web/lib/execution-service.ts`, `packages/db/migrations/0024_*.sql`
**Tests**: 6 new tests for topology validation (valid DAG, missing edge target, cycle, orphan, sequential, duplicate IDs)
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase D — Deterministic Executor Resolution (Rule 4)

**Objective**: Skill execution has one explicit executor. No first-role fallback.

**Changes**:

1. **Define explicit executor model**
   ```typescript
   export type ExecutorBinding = {
     skillId: string;
     roleId: string;  // explicit — REQUIRED
   };
   ```

2. **Add executor to skill binding**
   - Extend `skillBindingSchema` or add parallel `executorBindingSchema`
   - A skill is "ambiguous" if multiple roles claim it without an explicit binding
   - A skill is "unbound" if no active role claims it and no executor is specified

3. **Update `resolveSingleNodeSkill` in `resolveExecution`**
   - Remove `resolveDirectExecutorRole` call
   - Require explicit `roleId` in the request when executing a skill directly
   - If no role specified and skill is ambiguous → return 400 with diagnostics
   - If no role specified and skill is unbound → return 400 with diagnostics

4. **Update `resolveDirectExecutorRole` → `resolveExplicitExecutor`**
   - New function reads from `file_relations` or explicit binding
   - No fallback to orchestrator unless orchestrator is explicitly bound

5. **Remove duplicated `resolveExecutionRole` in `director-tools.ts`**
   - Director tool context receives explicit role bindings from `resolveExecution`
   - No need to re-resolve in child run context

**Files affected**: `packages/core/src/index.ts`, `apps/web/lib/execution-service.ts`, `apps/web/lib/director-tools.ts`
**Tests**: 3 new tests for ambiguous/unbound/bound skill execution
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase E — Separate Lifecycle from Enablement (Rule 6)

**Objective**: `draft | published | archived` for lifecycle, `enabled` boolean for execution availability, `valid | invalid` for validation status.

**Changes**:

1. **Migration `0025_lifecycle_enablement.sql`**
   ```sql
   alter table files add column lifecycle varchar not null default 'published';
   alter table files add column enabled boolean not null default true;
   alter table files add column validation_diagnostics jsonb not null default '[]'::jsonb;
   -- Backfill: status='active' → lifecycle='published', enabled=true
   -- Backfill: status='draft' → lifecycle='draft', enabled=false
   -- Backfill: status='archived' → lifecycle='archived', enabled=false
   -- Backfill: status='deleted' → lifecycle='archived', enabled=false
   ```

2. **Update `fileStatusSchema` → split into `lifecycleSchema` + `enabledSchema`**
   ```typescript
   export const lifecycleSchema = z.enum(["draft", "published", "archived"]);
   export type Lifecycle = z.infer<typeof lifecycleSchema>;
   // FileRecord gets lifecycle + enabled instead of status
   ```

3. **Update `execution-service.ts` filters**
   - Replace all `f.status === "active"` checks with `f.enabled === true && f.lifecycle === "published"`
   - Active execution check: `entity.enabled && entity.lifecycle !== "archived"`
   - Deleted check: separate `deleted_at` column or `lifecycle === "archived"` + flag

4. **Update UI components**
   - Roles page: "Active/Draft/Archived" toggle → separate "Published/Draft/Archived" lifecycle + "Enabled" switch
   - Skills page: same
   - Workflows page: same
   - Evals page: same

5. **Add validation status display**
   - Invalid entities show warning icon + diagnostic tooltip
   - Cannot be enabled until valid
   - Cannot execute with diagnostics

**Files affected**: `packages/db/migrations/0025_*.sql`, `packages/core/src/index.ts`, `apps/web/lib/execution-service.ts`, all 4 entity page components
**Tests**: 3 new tests for lifecycle/enabled independence, invalid entity visibility, disabled entity non-executability
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase F — One Workspace Settings Authority (Rule 7)

**Objective**: One typed `workspace_settings` source for all default workspace behavior.

**Changes**:

1. **Migration `0026_workspace_settings.sql`**
   ```sql
   create table workspace_settings (
     org_id uuid primary key references orgs(id) on delete cascade,
     default_execution_mode text not null default 'director',
     default_model_id uuid references models(id) on delete set null,
     context_limits jsonb not null default '{"maxInputTokens": 100000, "maxOutputTokens": 100000}',
     retrieval_policy jsonb not null default '{"knowledgeSearchLimit": 10, "memoryRetrievalLimit": 8}',
     director_runtime_policy jsonb not null default '{}',
     approval_policy jsonb not null default '{}',
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   ```

2. **Create settings schema in `@spielos/core`**
   ```typescript
   export const workspaceSettingsSchema = z.object({
     defaultExecutionMode: executionModeSchema.default("director"),
     defaultModelId: z.string().uuid().nullable().default(null),
     context_limits: z.object({
       maxInputTokens: z.number().positive().default(100000),
       maxOutputTokens: z.number().positive().default(100000),
     }).default({}),
     retrieval_policy: z.object({
       knowledgeSearchLimit: z.number().positive().default(10),
       memoryRetrievalLimit: z.number().positive().default(8),
     }).default({}),
     directorRuntimePolicy: directorRuntimePolicySchema.optional(),
     approval_policy: z.object({
       requireApprovalForSideEffects: z.boolean().default(true),
     }).default({}),
   });
   export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
   ```

3. **Create settings resolver in `@spielos/db`**
   ```typescript
   export async function getWorkspaceSettings(sql: Sql, orgId: string): Promise<WorkspaceSettings>
   export async function upsertWorkspaceSettings(sql: Sql, orgId: string, patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>
   ```

4. **Update `resolveExecution` to use settings**
   - Read `defaultExecutionMode` from settings if not provided in body
   - Read `defaultModelId` from settings if no model specified
   - Read `directorRuntimePolicy` from settings instead of file search
   - Apply settings to budget/context defaults

5. **Migrate existing runtime policy files into workspace_settings**
   - Runtime policy files are read and stored in settings
   - Legacy file still exists for editing, but runtime reads from settings

**Files affected**: `packages/db/migrations/0026_*.sql`, `packages/core/src/index.ts`, `packages/db/src/index.ts`, `apps/web/lib/execution-service.ts`, `apps/web/lib/default-models.ts`, settings page
**Tests**: 3 new tests for settings resolution, fallback chain, migration from file-based policy
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase G — One Validated Capability Snapshot (Rule 8)

**Objective**: `compileSnapshot()` produces a validated, cacheable workspace compilation used by Direct, Director, and run snapshots.

**Changes**:

1. **Create `compileSnapshot()` in `packages/graph/src/compile.ts`**
   ```typescript
   export type WorkspaceSnapshot = {
     version: number;
     revision: string;     // content hash for caching
     settings: WorkspaceSettings;
     roles: Record<string, Role>;
     skills: Record<string, Skill>;
     workflows: Record<string, WorkflowFile>;
     evals: Record<string, EvalFile>;
     relations: ResolvedRelations;
     diagnostics: EntityDiagnostic[];
     modelRoster: ModelProvider[];
     contentHashes: Record<string, string>;
     compiledAt: string;
   };
   
   export async function compileSnapshot(
     sql: Sql,
     orgId: string,
     options?: { skipCache?: boolean }
   ): Promise<WorkspaceSnapshot>
   ```

2. **Integrate into `resolveExecution`**
   - Call `compileSnapshot()` at the start instead of manual file parsing
   - Extract the relevant subset for the run target (reachable entities only)
   - Use `snapshot.diagnostics` to reject invalid targets
   - Cache snapshot by revision hash (in-memory, TTL 30s)

3. **Update `definitionSnapshot` construction**
   - Store `snapshot.version` + `snapshot.revision` in run record
   - Use snapshot's reachable subset instead of re-filtering

4. **Update Director compilation**
   - `compileDirector` receives the snapshot instead of separate role/skill/workflow/eval records
   - Director and Direct mode share the same validation results

5. **Cache invalidation**
   - Bump revision when: file created/updated/deleted, workspace settings changed, model/connection changed
   - Invalidated on any `POST/PUT/DELETE` to `/api/harness/files`, `/api/models`, `/api/settings`

**Files affected**: `packages/graph/src/compile.ts` (new), `apps/web/lib/execution-service.ts`, `apps/web/app/api/runs/execute/route.ts`
**Tests**: 4 new tests for snapshot compilation, cache hit, cache invalidation, Direct/Director agreement
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase H — Director Verification (Rule 9)

**Objective**: Director completion is evidence-based: required artifacts, tool calls, child runs, and eval thresholds must be satisfied.

**Changes**:

1. **Define completion criteria schema**
   ```typescript
   export const completionCriteriaSchema = z.object({
     requiredArtifacts: z.array(z.string()).default([]),
     requiredWorkflows: z.array(z.string()).default([]),
     requiredToolCalls: z.array(z.object({
       capability: z.string(),
       minCount: z.number().int().positive().default(1),
     })).default([]),
     requiredEvalThresholds: z.array(z.object({
       evalId: z.string(),
       minScore: z.number().min(0).max(100).default(75),
     })).default([]),
   });
   ```

2. **Create evidence collector**
   ```typescript
   export type CompletionEvidence = {
     artifacts: string[];          // artifact IDs created
     completedWorkflows: string[]; // child workflow run IDs
     toolCalls: Record<string, number>; // capability → count
     evalResults: Record<string, { score: number; passed: boolean }>;
     todosCompleted: number;
     todosTotal: number;
   };
   ```

3. **Update `streamDirectorRun`**
   - Compile completion criteria from `runVerificationSchema` + director runtime policy
   - After deepagents stream ends, evaluate evidence against criteria
   - Yield verification status: `passed` | `failed` with evidence list
   - Do not yield `done: "completed"` if criteria are unmet
   - Yield `done: "failed"` with error message listing unmet criteria

4. **Update `mapDirectorValues`**
   - Track tool calls per capability (already partially tracks events)
   - Track child run completion from tool results
   - Track artifact creation

**Files affected**: `packages/core/src/index.ts`, `packages/graph/src/index.ts`, `packages/graph/src/director/values.ts`
**Tests**: 4 new tests for evidence collection, criteria evaluation, failure with unmet criteria, success with evidence
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase I — Durable Child Budgets (Rule 10)

**Objective**: Child-run counters persist in the database and survive process restart, retry, and concurrent execution.

**Changes**:

1. **Migration `0027_child_run_budgets.sql`**
   ```sql
   create table child_run_budgets (
     parent_run_id uuid not null references runs(id) on delete cascade,
     capability_call_count int not null default 0,
     child_run_count int not null default 0,
     active_child_runs int not null default 0,
     child_input_tokens int not null default 0,
     tool_calls_count int not null default 0,
     primary key (parent_run_id)
   );
   ```

2. **Create budget repository**
   ```typescript
   export async function reserveChildRunSlot(sql: Sql, parentRunId: string, policy: DirectorRuntimePolicy): Promise<boolean>
   export async function releaseChildRunSlot(sql: Sql, parentRunId: string, inputTokens?: number): Promise<void>
   export async function incrementCapabilityCall(sql: Sql, parentRunId: string, capability: string, maxCalls: number): Promise<boolean>
   export async function getChildRunBudget(sql: Sql, parentRunId: string): Promise<ChildRunBudget>
   ```

3. **Update `guarded()` in `director-tools.ts`**
   - Replace closure counters with DB queries (batched, transactional)
   - `reserveChildRunSlot` uses `UPDATE ... SET child_run_count = child_run_count + 1 WHERE child_run_count < max AND active_child_runs < max_parallel RETURNING *`
   - If false, return budget-exceeded error string
   - Release on completion or error

4. **Remove in-memory counters from `buildDirectorToolContext`**
   - `callsPerCapability`, `childRunCount`, `activeChildRuns` move to DB
   - Keep `activeChildRuns` as a lightweight local cache for quick rejection, with DB as authority

**Files affected**: `packages/db/migrations/0027_*.sql`, `packages/db/src/index.ts`, `apps/web/lib/director-tools.ts`
**Tests**: 3 new tests for transactional reservation, concurrent budget enforcement, resume persistence
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase J — Idempotent Tool Invocation (Rule 11)

**Objective**: Tool invocations are journaled. Repeating a completed invocation returns the prior result. Concurrent duplicates cannot both perform side effects.

**Changes**:

1. **Migration `0028_tool_invocations.sql`**
   ```sql
   create type invocation_status as enum ('running', 'completed', 'failed', 'rejected');
   create table tool_invocations (
     id uuid primary key default gen_random_uuid(),
     org_id uuid not null references orgs(id) on delete cascade,
     parent_run_id uuid not null references runs(id) on delete cascade,
     logical_key text not null,
     capability_id text not null,
     input_hash text not null,
     attempt int not null default 1,
     status invocation_status not null default 'running',
     result_ref text,
     external_receipt text,
     error text,
     created_at timestamptz not null default now(),
     completed_at timestamptz,
     unique(org_id, logical_key, input_hash)
   );
   ```

2. **Create invocation repository**
   ```typescript
   export async function tryClaimToolInvocation(
     sql: Sql, orgId: string, parentRunId: string,
     logicalKey: string, input: unknown
   ): Promise<ToolInvocation | null>
   // Returns existing completed invocation (dedup), or creates new 'running' (first claim)
   // Returns null if concurrent claim (unique constraint violation)
   
   export async function completeToolInvocation(
     sql: Sql, id: string, status: 'completed' | 'failed', result?: string, receipt?: string
   ): Promise<void>
   ```

3. **Update `runChildStream` in `director-tools.ts`**
   - Before creating a child run, call `tryClaimToolInvocation`
   - If existing completed result returned, return it without creating a child run
   - If null (concurrent claim), throw "already in progress"
   - On completion, call `completeToolInvocation`

4. **Update `runChildSkill` for knowledge_search fast path**
   - Same dedup logic for synchronous searches

5. **Do NOT persist secrets in invocation input**
   - Hash the invocation input, not the raw input
   - `input_hash = sha256(canonicalJson(excludeSecrets(input)))`

**Files affected**: `packages/db/migrations/0028_*.sql`, `packages/db/src/index.ts`, `apps/web/lib/director-tools.ts`
**Tests**: 4 new tests for first-claim dedup, concurrent-duplicate reject, retry-result return, secret exclusion
**Verification**: `npm run typecheck && npm run lint && npm run test`

---

### Phase K — Dead Code & Duplication Removal (Rule 13)

**Objective**: Remove confirmed dead code and duplicated functions. No speculative removals.

**Changes**:

1. **Move `stableUuid` to `@spielos/core`**
   - Export from `packages/core/src/index.ts`
   - Delete from `execution-service.ts` and `default-models.ts`
   - Update imports

2. **Move `evalFileToSkill` to `@spielos/core`**
   - Export from `packages/core/src/index.ts`
   - Delete from `execution-service.ts` and `director-tools.ts`
   - Update imports

3. **Move `resolveDirectExecutorRole` logic to shared function**
   - Export from `packages/core/src/index.ts` or `@spielos/db`
   - Delete from `execution-service.ts` and `director-tools.ts`

4. **Remove `ProjectSession` / `ProjectRevision` dead code** (verify first)
   - Check if any API routes, UI pages, or tests use these
   - If unused: remove schemas from core, remove exports from db
   - Keep migration tables for backward compatibility

5. **Remove `orchestrationPlanSchema` dead code**
   - Superseded by Director deepagents — not used
   - Remove from `packages/core/src/index.ts`

6. **Remove `chatTurnEnvelopeSchema` dead code**
   - Not used anywhere — SSE frames superseded it
   - Remove from `packages/core/src/index.ts`

7. **Audit adapter dead code in `@spielos/providers`**
   - Search for imports of each adapter across the repo
   - Remove adapters with no consumers (with safety net: archive to `_archive/` not delete)

**Files affected**: Multiple
**Tests**: None needed — pure removal shouldn't change behavior
**Verification**: `npm run typecheck && npm run lint && npm run test && npm run build`

---

### Phase L — Full Test Coverage (Rules A-K test requirements)

**Objective**: Implement the complete automated test plan from the task specification.

**Prioritization**:
- Core schema tests (1-20): Cover in Phase A-B-C-D-E
- Database integrity tests (21-35): Cover in Phase B-E-F-I-J
- Direct runtime tests (36-50): Cover in Phase C-D-G
- Director runtime tests (51-70): Cover in Phase G-H-I-J
- Chat and persistence tests (71-84): Already partially covered; add remaining

**New test files needed**:
- `tests/schema-validation.test.ts` — Phases A (15 tests)
- `tests/relations.test.ts` — Phase B (5 tests)
- `tests/workflow-topology.test.ts` — Phase C (5 tests)
- `tests/executor-resolution.test.ts` — Phase D (4 tests)
- `tests/lifecycle.test.ts` — Phase E (4 tests)
- `tests/workspace-settings.test.ts` — Phase F (4 tests)
- `tests/snapshot.test.ts` — Phase G (4 tests)
- `tests/director-verification.test.ts` — Phase H (4 tests)
- `tests/child-budgets.test.ts` — Phase I (3 tests)
- `tests/tool-invocations.test.ts` — Phase J (4 tests)

**E2E test fixes**:
- Fix `networkidle` → `load` or `domcontentloaded` wait strategy
- Add auth fixture: create session cookie with proper HMAC signing
- Fix 3 existing test files to pass reliably

**Files affected**: `tests/*.test.ts` (10 new), `tests/e2e/*.spec.ts` (3 updated)
**Verification**: `npm run test` (all pass), `npm run test:e2e` (reliable)

---

### Phase M — Documentation Update (Rule 14)

**Objective**: Update architecture docs to match the new validated compilation pipeline.

**Changes**:
- Update `docs/architecture.md` with new compile/snapshot flow
- Update `docs/harness-model.md` with validated entities, explicit topology, lifecycle separation
- Update `docs/runs.md` with durable budgets and idempotent tools
- Add concise ADRs in `docs/adr/` for key decisions (why file-backed, why explicit topology, why lifecycle separation)
- Archive stale plans from `docs/plans/` that describe superseded architecture

**Files affected**: `docs/*.md`, `README.md`
**Verification**: Read-through

---

## 4. Verification Checklist (per phase)

```bash
npm run typecheck     # Must pass with 0 errors
npm run lint          # Must pass with 0 warnings  
npm run test          # All tests pass
npm run build         # Production build succeeds
npm run check:ui      # Design system compliance (when UI changes)
```

Complete verification:
```bash
npm run typecheck && npm run lint && npm run check:ui && npm run test && npm run build && npm run db:migrate && npm run db:verify
```

## 5. Deferred Production Work

From `docs/production-readiness-audit.md`:
- **P0**: Durable worker process (not a Next.js serverless function)
- **P1**: Transactional credits metering
- **P1**: Server-owned integration credentials (no env vars)
- Multi-tenant isolation hardening
- Rate limiting at scale

These are not addressed by SpielHarness — they belong in a separate Prompt 4.

---

## 6. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Migration misalignment with Supabase hosted DB | All migrations append-only; `manual_harness_merge.sql` updated each time |
| Backfill of file_relations misses edge cases | Test on demo org data before production; dry-run mode |
| Workflow topology migration breaks existing workflows | Populate explicit topology before removing auto-edge generation |
| Removing dead code removes something still needed | Grep for all imports; keep in `_archive/` for one release cycle |
| E2E tests remain flaky | Separate auth fixture from test logic; use deterministic wait strategies |
