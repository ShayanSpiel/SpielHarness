# Usage Architecture Redesign

## Initial Problem

The context meter in the inspector sidebar resets to 0 on every new chat or page refresh, even though the run's actual token usage was correctly tracked and stored during the live SSE stream.

**On page refresh or new chat**, the client calls `GET /api/runs/{id}`. The endpoint queries `usage_ledger` and returns `payload.usage = {inputTokens: 0, outputTokens: 0}`. The client prefers this over the correctly-persisted `runs.state.budget` because of a `??` operator that does not fall through for `0`. Result: context meter always shows 0.

**Switching chats** clears `liveUsage` and `durableState` entirely (`clearEvents` at `chat-thread.tsx:1406`), and the restore function may not find `restorableRunId` if the chat metadata lacks the run ID, leading to `reset()` with no data loaded at all.

Root cause: three competing delivery paths for the same data (SSE `usage` frames, SSE `run_state` frames, GET response) with no single source of truth, and `usage_ledger` queried as a display source.

---

## Current State

### Schema

`runs` table has a `state` JSONB column. Currently contains:

```json
{
  "budget": {
    "maxInputTokens": 200000,
    "maxOutputTokens": 8192,
    "inputTokens": 15000,
    "outputTokens": 3200,
    "toolCalls": 12,
    "startedAt": "...",
    "deadlineAt": null
  },
  "goal": { ... },
  "progress": { ... },
  "verification": { ... }
}
```

### Current data flow

```
DURING RUN:
  LLM call → AI message.usage_metadata
    → mapDirectorValues extracts it
    → DirectorUsageTracker accumulates
    → onUsage(per-call-delta) in route
        ├── SSE "usage" frame → client.liveUsage → Context Meter
        ├── domain event "run.usage.updated"
        └── usage.total accumulates in route closure
    → onToolUsage(callCount) in route
        └── SSE "usage" frame → client.liveUsage
    → Director builds checkpoint budget at pause/fail/terminal only

ON RELOAD:
  GET /api/runs/{id}
    ├── getRunUsageTotals() → usage_ledger SUM → payload.usage
    └── run.state.budget → payload.run.state.budget
  Client:
    setLiveUsage(payload.usage) → may be {0, 0} if ledger empty
    setDurableState({ budget }) → has correct values
```

### Problems

1. **Three concurrent delivery paths**: SSE `usage` frames, SSE `run_state` frames, GET response. No single source of truth.
2. **Wrong value displayed**: `budget.inputTokens` is **cumulative** (sum of all LLM calls ever), not the **current context window** (size of the last prompt).
3. **`LiveRunUsage` races with `durableState.budget`**: Two React state slots with inconsistent precedence.
4. **Budget only written at terminal/pause/fail**: Context meter frozen during run.
5. **`usage_ledger` queried for display**: Billing table used as display source.

---

## Contracts

### `ModelUsageUpdate` (per-call delta)

```typescript
export type ModelUsageUpdate = {
  /** Per-call input tokens consumed by this single LLM call (delta, not cumulative). */
  inputTokens: number;
  /** Per-call output tokens produced by this single LLM call (delta). */
  outputTokens: number;
  /** Model identifier for the call that produced this usage. */
  modelId: string;
  /** "root" = Director/chat/ReAct root, "subagent" = skill/subagent, "internal" = summarization/repair. */
  scope: "root" | "subagent" | "internal";
  /** When true, replaces contextInputTokens/contextOutputTokens/contextModelId. */
  updatesContext: boolean;
};
```

### Transport: callbacks, not `RunYield`

```typescript
// In RunRequest
onModelUsage?: (update: ModelUsageUpdate) => void;
onToolUsage?: (count: number) => void;
```

- No `{ kind: "budget_update" }` in `RunYield`. The current `RunYield` has no usage variant to remove.
- `onModelUsage` flows through the LangGraph state annotation (same path as `onUsage` currently).
- `onToolUsage` stays as-is.
- Add `onModelUsage` to the graph state annotation alongside the existing `onUsage`.

### `NormalizedBudget`

```typescript
export type NormalizedBudget = {
  contextInputTokens: number;
  contextOutputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCalls: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxToolCalls: number | null;
  maxDurationMs: number | null;
  startedAt: string;
  deadlineAt: string | null;
  contextModelId: string | null;
};
```

### `normalizeBudget()` — pure normalizer, no `new Date()`

```typescript
export function normalizeBudget(raw: unknown): NormalizedBudget {
  const b = (raw ?? {}) as Record<string, unknown>;
  const legacyInput = toInt(b.inputTokens);
  const legacyOutput = toInt(b.outputTokens);
  return {
    contextInputTokens: toInt(b.contextInputTokens) ?? legacyInput,
    contextOutputTokens: toInt(b.contextOutputTokens) ?? legacyOutput,
    totalInputTokens: toInt(b.totalInputTokens) ?? legacyInput,
    totalOutputTokens: toInt(b.totalOutputTokens) ?? legacyOutput,
    toolCalls: toInt(b.toolCalls) ?? 0,
    maxInputTokens: toInt(b.maxInputTokens) ?? null,
    maxOutputTokens: toInt(b.maxOutputTokens) ?? null,
    maxToolCalls: toInt(b.maxToolCalls) ?? null,
    maxDurationMs: toInt(b.maxDurationMs) ?? null,
    startedAt: str(b.startedAt) ?? "",  // caller sets startedAt at run creation
    deadlineAt: str(b.deadlineAt) ?? null,
    contextModelId: str(b.contextModelId) ?? null,
  };
}
```

Extensions to `runBudgetSchema`:

```typescript
// Additive — keep legacy inputTokens/outputTokens
contextInputTokens: z.number().int().nonnegative().optional(),
contextOutputTokens: z.number().int().nonnegative().optional(),
totalInputTokens: z.number().int().nonnegative().optional(),
totalOutputTokens: z.number().int().nonnegative().optional(),
contextModelId: z.string().nullable().optional(),
```

---

## Director message classification

| Origin | scope | updatesContext |
|--------|-------|---------------|
| Root namespace, ordinary AI message | `root` | `true` |
| Non-root namespace (subagent) | `subagent` | `false` |
| Native summarization message (`additional_kwargs.lc_source === "summarization"`) | `internal` | `false` |

- Native DeepAgents role subagents count toward parent totals. They are not durable child runs — their usage flows through the same `usage.record()` path with `scope: "subagent"`.
- Durable child workflow runs retain their own `usage_ledger` rows and must NOT be folded into parent billing.

---

## `DirectorUsageTracker` — pure accumulator, no side effect in `foldOnce()`

```typescript
export class DirectorUsageTracker {
  private input = 0;
  private output = 0;

  seed(totals: { input: number; output: number }) {
    this.input = totals.input;
    this.output = totals.output;
  }

  record(snapshot: { input_tokens?: number; output_tokens?: number } | null | undefined) {
    if (!snapshot) return;
    if (typeof snapshot.input_tokens === "number") this.input += snapshot.input_tokens;
    if (typeof snapshot.output_tokens === "number") this.output += snapshot.output_tokens;
  }

  snapshot(): { input: number; output: number } {
    return { input: this.input, output: this.output };
  }

  // foldOnce() removed — no cumulative reporting side effect.
  // mapDirectorValues invokes onModelUsage directly for each AI message.
}
```

`mapDirectorValues` invokes `req.onModelUsage` once for every deduplicated AI message:

```typescript
// In mapDirectorValues, after processing usage_metadata from a deduplicated AI message:
req.onModelUsage?.({
  inputTokens: metadata.input_tokens,
  outputTokens: metadata.output_tokens,
  modelId: extractModelId(message),
  scope: decoded.namespace.length === 0 ? "root" : "subagent",
  updatesContext: decoded.namespace.length === 0 && !isNativeSummarizationMessage(message),
});
```

---

## Provider `onUsage` — exactly-once per request

- `ChatRequest.onUsage` stays internal to each provider implementation.
- Every provider request must invoke it exactly once with the final per-request usage.
- **Anthropic streaming**: currently emits incremental events. Fix it to collect usage events during streaming and emit one final callback with the complete totals.

### All non-Director provider call sites with correct scope

| Site | scope | updatesContext |
|------|-------|---------------|
| Final plain-chat generation (`streamChatRun`) | `root` | `true` |
| Workflow node | `root` | `true` |
| Root ReAct iteration | `root` | `true` |
| Long-horizon extraction | `internal` | `false` |
| Summarization | `internal` | `false` |
| Structured repair | `internal` | `false` |

---

## Route-owned `normalizedBudget`

### Update flow

```typescript
// execute/route.ts and reply/route.ts
let normalizedBudget: NormalizedBudget = createEmptyBudget();

function publishBudgetState() {
  // 1. Partial run_state SSE frame (only budget, rest of state is client-owned)
  send({ kind: "run_state", state: { budget: { ...normalizedBudget } } });

  // 2. Domain event for realtime listeners
  publishDomainEvent(`run:${run.id}`, {
    type: "run.usage.updated",
    orgId: org.orgId,
    runId: run.id,
    inputTokens: normalizedBudget.contextInputTokens,
    outputTokens: normalizedBudget.contextOutputTokens,
    totalInputTokens: normalizedBudget.totalInputTokens,
    totalOutputTokens: normalizedBudget.totalOutputTokens,
    toolCalls: normalizedBudget.toolCalls,
    ts: new Date().toISOString(),
  });

  // 3. Enqueue through serialized checkpoint writer
  checkpointWriter.enqueue({ budget: normalizedBudget });
}

const onModelUsage = (update: ModelUsageUpdate) => {
  normalizedBudget.totalInputTokens += update.inputTokens;
  normalizedBudget.totalOutputTokens += update.outputTokens;
  if (update.updatesContext) {
    normalizedBudget.contextInputTokens = update.inputTokens;
    normalizedBudget.contextOutputTokens = update.outputTokens;
    normalizedBudget.contextModelId = update.modelId;
  }
  publishBudgetState();
};

// onToolUsage stays separate — after changing toolCalls it must also call
// publishBudgetState() so the live tool count and durable budget remain current.
const onToolUsage = (count: number) => {
  normalizedBudget.toolCalls = count;
  publishBudgetState();
};
```

### Resume

```typescript
const prior = loadCheckpoint().state?.budget;
normalizedBudget = normalizeBudget(prior);
DirectorUsageTracker.seed({
  input: normalizedBudget.totalInputTokens,
  output: normalizedBudget.totalOutputTokens,
});
```

---

## Checkpoint writer — serialized drain queue

```typescript
class CheckpointWriter {
  private inflight: Promise<void> | null = null;
  private patch: { budget: NormalizedBudget } | null = null;
  private pendingEvents: RunEvent[] = [];
  private currentVersion: number;

  async enqueue(input: { budget: NormalizedBudget; events?: RunEvent[] }) {
    this.patch = { budget: input.budget };      // coalesce — latest budget wins
    if (input.events) this.pendingEvents.push(...input.events);
    if (this.inflight) return;                   // already writing
    this.inflight = this.flush();
    await this.inflight;
  }

  private async flush() {
    while (this.patch || this.pendingEvents.length > 0) {
      const events = this.pendingEvents.splice(0);
      const patch = this.patch;
      this.patch = null;

      // atomicCheckpoint with statePatch (JSONB top-level merge, not replacement)
      const result = await atomicCheckpoint({
        orgId,
        runId,
        expectedCheckpointVersion: this.currentVersion,
        statePatch: patch ? { budget: patch.budget } : undefined,
        events,
      });
      this.currentVersion = result.checkpointVersion;
      // Preserve existing cancellation/pause mismatch handling
    }
    this.inflight = null;
  }

  async drain(): Promise<void> {
    while (this.inflight || this.patch || this.pendingEvents.length > 0) {
      await (this.inflight ?? this.flush());
    }
  }
}
```

### `atomicCheckpoint` extension — `statePatch`

```typescript
export async function atomicCheckpoint(
  sql: Sql,
  orgId: string,
  runId: string,
  input: AtomicCheckpointInput & {
    /** JSONB top-level merge into state — used for budget-only writes. */
    statePatch?: Record<string, unknown>;
  }
): Promise<AtomicCheckpointResult> {
  // existing logic, but when statePatch is set:
  //   state = coalesce(state, '{}'::jsonb) || statePatch
  // instead of replacing state entirely.
}
```

- Budget-only writes use `statePatch: { budget: normalizedBudget }`, never `state: { budget }` (which would overwrite other state fields).
- `statePatch` does a SQL `coalesce(state, '{}'::jsonb) || statePatch` (JSONB top-level merge).
- Terminal writes (pause, failure, human-input, cancellation, completion) await `drain()` first, then write the full `state` via the existing replacement path.

---

## Client state

### `mergeDurableState()`

```typescript
// In RunContext
const mergeDurableState = useCallback((patch: Partial<DurableRunState>) => {
  setDurableState((current) => current ? { ...current, ...patch } : patch);
}, []);
```

- Streaming `run_state` frames use `mergeDurableState({ budget })` — partial merge.
- Complete GET restoration uses `setDurableState(fullState)` — full replacement.

### Remove `LiveRunUsage`

Delete from:

1. `apps/web/lib/run-context.tsx` — `LiveRunUsage` type, `liveUsage`/`setLiveUsage` state.
2. `apps/web/lib/chat-adapter.ts` — remove `kind: "usage"` handling, remove the `context_budget` event fallback that mapped to `liveUsage`.
3. `apps/web/components/chat/run-drawer.tsx` — remove `liveUsage` from `RuntimeCapacity`, remove `run_state`-to-`liveUsage` mapping, remove any `kind: "usage"` frame handling.
4. `apps/web/components/chat/chat-thread.tsx` — remove `setLiveUsage` in restore block, remove SSE `kind: "usage"` handling.

Context meter reads exclusively from `normalizeBudget(run.durableState?.budget)`:

```typescript
const budget = normalizeBudget(run.durableState?.budget);
const contextTotal = budget.contextInputTokens + budget.contextOutputTokens;
const window = capabilities?.contextWindow ?? 0;
```

---

## SSE schema update

Current canonical SSE frames:

```
text, event, usage, run_state, checkpoint, done, error
```

Updated:

```
text, event, run_state, checkpoint, done, error
```

No `usage` frame. The `run_state` frame carries `{ state: { budget: NormalizedBudget } }`. Client adapters process it into `durableState` via `mergeDurableState`.

---

## Billing — `usage_ledger`

### Segment delta

```typescript
// At request start
const segmentStartTotals = {
  input: normalizedBudget.totalInputTokens,
  output: normalizedBudget.totalOutputTokens,
};

// At terminate (after drain())
const segmentDelta = {
  inputTokens: normalizedBudget.totalInputTokens - segmentStartTotals.input,
  outputTokens: normalizedBudget.totalOutputTokens - segmentStartTotals.output,
};
if (segmentDelta.inputTokens > 0 || segmentDelta.outputTokens > 0) {
  await recordUsage(sql, orgId, {
    runId,
    provider: modelProvider,
    model: modelId,
    inputTokens: segmentDelta.inputTokens,
    outputTokens: segmentDelta.outputTokens,
    costMicros: 0,  // placeholder until pricing is implemented from a verified source
    idempotencyKey: `run:${runId}:resume:${requestId}`,
  });
}
```

### Idempotency

```sql
ALTER TABLE usage_ledger ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX idx_usage_ledger_idempotency ON usage_ledger (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

`recordUsage` must be idempotent — `INSERT ... ON CONFLICT (org_id, idempotency_key) DO NOTHING`. Key format:

- First write: `run:{runId}:initial`
- Resume writes: `run:{runId}:resume:{requestId}`

---

## Previous chat-context fix

Ensure that on the root chat route, `activeRunId` / `lastRunId` chat metadata is set and eligible for restoration. Without it, `restorableRunId` is `null` in `chat-thread.tsx:1417` and `reset()` is called, clearing all durable state. The usage redesign depends on this — verify the metadata is written on run creation and loaded on chat navigation.

---

## File-by-file changes

### `packages/core/src/index.ts`
- Export `ModelUsageUpdate`, `NormalizedBudget`, `normalizeBudget()`.
- Extend `runBudgetSchema` additively.

### `packages/graph/src/director/usage.ts`
- Remove `foldOnce()`. Add `seed()`. `mergeFromSubagent` → remove or no-op comment.

### `packages/graph/src/index.ts`
- Add `onModelUsage` to graph state annotation and `RunRequest`.
- In `mapDirectorValues`: invoke `onModelUsage` per deduplicated AI message with correct scope/updatesContext.
- Remove `foldOnce()` call; `DirectorUsageTracker` no longer has that method.

### `apps/web/app/api/runs/execute/route.ts`
- Replace `onUsage` with `onModelUsage`.
- Route owns `normalizedBudget`. `onToolUsage` also calls `publishBudgetState()`.
- `CheckpointWriter` instance — `enqueue()` on each update, `drain()` before terminal.
- `recordUsage` with segment delta + idempotency key.
- `costMicros: 0`.

### `apps/web/app/api/runs/[id]/reply/route.ts`
- Same pattern: `onModelUsage`, `normalizedBudget`, `CheckpointWriter`, `publishBudgetState()`, segment delta billing.

### `apps/web/app/api/runs/[id]/route.ts`
- Remove `getRunUsageTotals()` and `payload.usage`. Return `run.state.budget` directly.

### `apps/web/lib/run-context.tsx`
- Remove `LiveRunUsage` type, `liveUsage`/`setLiveUsage` state.
- Add `mergeDurableState()`.

### `apps/web/components/chat/chat-thread.tsx`
- Remove `kind: "usage"` SSE handling.
- Remove `setLiveUsage` in restore.
- Use `mergeDurableState` for `run_state` frames.

### `apps/web/lib/chat-adapter.ts`
- Remove `kind: "usage"` handling.
- Remove `context_budget` event fallback.
- `run_state` → `mergeDurableState`.

### `apps/web/components/chat/run-drawer.tsx`
- `RuntimeCapacity` reads `normalizeBudget(run.durableState?.budget)`.
- Remove all `liveUsage` references.
- Max from `capabilities.contextWindow`.

### `packages/db/src/index.ts`
- `atomicCheckpoint` — add `statePatch` param for JSONB merge.
- `recordUsage` — add `idempotencyKey` param, `ON CONFLICT DO NOTHING`.
- Migration: add `idempotency_key` column + unique partial index.

### Provider fixes
- Anthropic streaming: collect incremental usage events, emit one final callback.

---

## Testing

| Test | What it verifies |
|------|------------------|
| Provider exactly-once usage | Each provider request fires `onUsage` once with final totals |
| `statePatch` preserves unrelated checkpoint fields | Non-budget state fields survive a budget-only `statePatch` write |
| Partial `run_state` client merging | `mergeDurableState({ budget })` merges into existing durable state without replacing other fields |
| Ledger idempotency | Duplicate `recordUsage` with same idempotency key does not insert a second row |
| Checkpoint-version serialization | Writer rejects out-of-order version, preserves cancellation/pause mismatch handling |
| Compaction context reduction | Next model call after compaction has lower `contextInputTokens`; `totalInputTokens` continues growing |
| Resume segment delta | Second reply writes only the new tokens, not the full cumulative total |
| Reload with empty ledger, populated budget | GET returns budget directly, shows correct context |
| Root vs subagent context isolation | Subagent `onModelUsage` with `updatesContext: false` does not overwrite root context fields |
| All execution paths emit `onModelUsage` | Direct chat, workflow, ReAct, repair — each fires callback with correct scope |
| Live `run_state` before terminal | Client receives budget updates during run, not only at end |
| Legacy budget fallback | `normalizeBudget` returns approximation from legacy values, not zero |
| `usage_ledger` row for main run | Execute and reply routes write segment delta — row exists after run |
| Chat metadata restoration | `activeRunId`/`lastRunId` set on run creation, loaded on chat navigation |
| Typecheck, lint, unit tests, build, E2E | Full CI passes |

---

## Removal checklist

- [ ] `liveUsage` state in `RunContext`
- [ ] `LiveRunUsage` type
- [ ] SSE `kind: "usage"` frame emission and handling
- [ ] `context_budget` event fallback in chat-adapter.ts
- [ ] `getRunUsageTotals` from GET display endpoint
- [ ] `payload.usage` field in GET response
- [ ] `DirectorUsageTracker.foldOnce()`
- [ ] Independent checkpoint timer → serialized `CheckpointWriter`
- [ ] `onUsage` callback → replaced by `onModelUsage`
- [ ] `mergeFromSubagent` active code
- [ ] `calculateCost` placeholder in billing path (use `costMicros: 0`)
- [ ] `new Date()` inside `normalizeBudget()` normalizer
