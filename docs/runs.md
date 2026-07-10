# Runs

The run workbench lives at `/runs`. The right sidebar shows run details: context, step log, artifacts. The chat area is where the user interacts with the team.

## Streaming protocol

The server emits Server-Sent Events. Each frame is `data: { kind, ... }\n\n` with one of:

- `run` — run id, selected target, and selected context summary. This is emitted first so chat can resume human-input runs.
- `event` — `RunEvent` (typed via `eventTypeSchema` in `packages/core`).
- `artifact` — `Artifact` produced by the run.
- `text` — streamed text output from chat, LLM skills, and retrieval skills.
- `human_input` — `HumanInputRequest` (the run is pausing for a user answer).
- `error` — terminal error.

Event types:

```
node_started, node_status,
skill_started, skill_completed,
human_input_requested, human_input_received,
tool_call_started, tool_call_result,
artifact_created,
eval_score_updated,
node_completed, run_completed, run_failed, run_cancelled
```

## Human-in-the-loop

When a step's skill is `kind="human_input"`, the run pauses. The chat shows a question card with the questions defined in the skill. The user answers and hits **Send answers**. The reply hits `POST /api/runs/[id]/reply` and the run resumes from the next node.

## Context tracing

`/api/runs/execute` stores the typed target, selected context references, selected context summary, normalized nodes, and `explicit_context` in `runs.inputs`. Empty explicit context is represented as `[]`; it does not trigger automatic library injection.

## Cancel

`POST /api/runs/[id]/cancel` cancels the run. The current SSE stream is closed client-side via the AbortController in `useRunExecutor`.

## Reset

A run can be reset (events/artifacts cleared) by reloading the page or by calling `run.resetRun()` from the store. The persisted rows in the database remain.
