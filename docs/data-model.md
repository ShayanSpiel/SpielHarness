# Data model

The canonical schema is plain PostgreSQL 14+ in `packages/db/migrations`. Supabase can host it, but application code connects through `DATABASE_URL` with `postgres`; it does not use the Supabase client, `auth.users`, PostgREST, or Supabase RLS today.

## Workspace ownership

`orgs`, `profiles`, and `org_memberships` exist. Every durable harness, chat, run, model, connection, variable, usage, and audit row carries `org_id`. Server queries scope reads and writes with `org_id`.

`0002_tenant_integrity.sql` adds same-workspace composite foreign keys. They are created `NOT VALID` for deployability on existing databases, which protects new writes immediately. Existing data must be checked and the constraints validated before production launch.

There is no authenticated request identity yet. `apps/web/lib/server.ts` resolves every request to the demo organization and grants it full write access. The membership schema is a foundation, not active authorization.

## File-backed harness

`files` is the editable source of truth for knowledge, strategy, prompts, artifacts, roles, skills, workflows, evals, and templates. Harness behavior lives in file bodies and metadata; seed content lives under `supabase/seed`.

- `file_versions` snapshots title/body/metadata changes.
- `file_relations` indexes role-skill and workflow-file references.
- `folders` provides organization within a workspace.
- `run_input_files` and `run_output_files` link run inputs and generated files.

There are no `marketing_objects`, `file_lineage`, `generated_files`, or `eval_reports` tables in the current schema.

## Runs and conversations

`chats` and `chat_messages` store conversation history. `runs` stores the typed target, input references, definition snapshot, status, output text, human answers, and serialized runtime checkpoint. `run_events` is the durable execution timeline. Generated eval/artifact outputs are persisted back to `files` and linked through `run_output_files`.

The current request handler executes runs in-process. Events are streamed immediately to the connected client but persisted in a batch when the request pauses or terminates. A production worker/queue is still required for lease-based execution, reconnectable live streams, retries, and cancellation independent of the browser connection.

## Models, connections, and secrets

`models` stores provider/model configuration and server-side environment-key references. `connections` stores operation declarations and encrypted OAuth configuration. `workspace_variables` stores ordinary values or environment-secret references.

Production requires `CONNECTION_ENCRYPTION_KEY`. Google/Notion integration OAuth currently also uses browser cookies and must be moved to user/workspace-scoped server credentials when application auth is introduced.

## Usage, billing, and credits

`usage_ledger` exists, but current token counts are character-based estimates and `cost_micros` is written as zero. There are no customer, subscription, entitlement, credit balance, reservation, settlement, invoice, or webhook-idempotency tables yet. The app must not enforce paid limits from `usage_ledger` in its current form.
