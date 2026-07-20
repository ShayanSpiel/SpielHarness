# Runs

Chat is the primary run surface. The right inspector has Context, Events, and Outputs tabs. Workflow and direct executable pages use the same `/api/runs/execute` contract.

## Request contract

The request includes `prompt`, an optional `type` (defaults to `chat`), `contextFileIds`, chat history, and an optional idempotency key.

- `workflow` uses `workflowId`. The resolver also accepts `targetId` for compatibility, but clients must send `workflowId`.
- `role`, `skill`, and `eval` use `targetId`.
- `chat` has no executable target.
- Empty file context is `contextFileIds: []`; the server supplies workspace catalog awareness but does not attach every file body.

## Lifecycle

Durable statuses are:

- `running`: the model or graph may emit work.
- `waiting_human`: execution is checkpointed and requires `/reply`.
- `completed`: successful terminal state.
- `failed`: terminal runtime or persistence failure.
- `cancelled`: terminal user/system cancellation.

`idle` exists only in the client before a run starts. UI loading is derived from `status === "running"`. Terminal events and `done.status` clear activity and the active role; no second loading flag is allowed.

## Streaming protocol

The server returns SSE frames separated by a blank line:

- `run`: run id and type.
- `event`: typed lifecycle event.
- `artifact`: generated structured output.
- `text`: native model/output delta.
- `status`: optional transient compatibility label; lifecycle state comes from events and `done`.
- `human_input`: question payload and pause point.
- `error`: transport/runtime error.
- `done`: terminal or waiting status.

Lifecycle event families are `run_*`, `node_*`, `skill_*`, `tool_call_*`, `human_input_*`, `artifact_created`, and `eval_score_updated`. LangGraph writes custom event frames when an operation starts or finishes, so the UI does not wait for the node result to discover that work began.

Plain chat emits model-generation run events without pretending a workflow is executing. Workflow events carry node, skill, and active-role identity. Chat compacts paired start/completion events into inline activity rows without a bordered transcript. The Events inspector preserves the full ordered history.

## Resume and cancellation

Human input is posted to `/api/runs/[id]/reply`. The checkpoint is loaded from `runs.state`, resumed, and replaced with the latest checkpoint. Output files and events are persisted.

The valid transition is `running → waiting_human → running`. A run can enter any terminal state from `running`; terminal states do not resume.

Client cancellation aborts the active streaming request and calls `/api/runs/[id]/cancel`. The endpoint updates durable status, but there is no cross-process cancellation signal until execution is moved to a worker.

## Child Run Budgets

Parent runs can limit child run creation and capability usage:

- `ensureChildRunBudget(parentRunId)` — idempotent insert.
- `reserveChildRunSlot(parentRunId, maxChildRuns, maxParallelChildRuns)` — atomically increments counters; returns false when limits reached.
- `releaseChildRunSlot(parentRunId, inputTokens?)` — decrements active count and accumulates input tokens.
- `incrementCapabilityCall(parentRunId, capability, maxCalls)` — returns false when per-capability limit reached.
- `getChildRunBudget(parentRunId)` — returns current counters.

All operations use atomic SQL updates with optimistic locking.

## Tool Invocations

The `tool_invocations` table provides idempotent deduplication:

- `tryClaimToolInvocation(sql, orgId, parentRunId, logicalKey, capabilityId, inputHash)`:
  1. Checks for existing completed/failed invocation by `logical_key + input_hash` — returns existing row if found.
  2. Returns `null` if a concurrent claim is in progress (status = `running`).
  3. Inserts a new `running` row; unique constraint catches concurrent claims.
- `completeToolInvocation(sql, id, status, result?, receipt?)` — sets status to `completed` or `failed` with result ref and receipt.

Statuses: `running`, `completed`, `failed`.

## Director Verification

After a run completes, `collectEvidence` and `evaluateCompletion` check completion criteria against collected evidence:

| Criterion | Evidence Source |
|-----------|----------------|
| `requiredArtifacts` | Artifact IDs emitted during run |
| `requiredWorkflows` | Completed workflow IDs |
| `requiredToolCalls` | Tool invocation counts by capability |
| `requiredEvalThresholds` | Eval scores from run results |

`evaluateCompletion` returns `all`, `partial`, or `none` with corresponding evidence.

## Replay

`GET /api/runs/[id]/events` returns persisted events and `GET /api/runs/[id]/artifacts` returns linked output files. Events are currently persisted at pause/termination rather than continuously, so they are not yet a live reconnect mechanism.
