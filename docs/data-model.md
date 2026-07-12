# Data Model

SpielOS is marketing-object first and tenant-scoped. Every durable domain row carries `org_id`; API queries scope privileged access by that id and the database enforces membership with RLS.

## Canonical marketing objects

`files` is the single editable source of truth for strategy, prompts, knowledge, assets, drafts, evidence, templates, roles, skills, evaluations, workflows, chat exports, and generated deliverables. `marketing_objects` is the RLS-safe semantic view over those rows.

- `file_type` describes storage/runtime behavior.
- `metadata.objectType` optionally supplies a more specific marketing object type.
- `metadata.structuredData` optionally supplies a structured representation while `body` remains portable and human-editable.
- `file_versions` stores immutable object revisions. Triggers advance `current_version` when editable content changes.
- `file_relations` is the queryable integrity/index layer for role-skill and workflow-object references.
- `file_lineage` records derivation between generated and source objects.

Legacy `roles`, `tools`, and `graph_templates` tables remain migration-compatible storage only. Active application writes and execution resolve file-backed harness definitions; their duplicate API write paths have been removed.

## Runtime

`runs` stores lifecycle state, the immutable `definition_snapshot`, idempotency key, inputs, outputs, durable human checkpoint, and requesting profile. Related records are:

- `run_events`: append-only execution timeline.
- `run_input_files`: explicit input objects.
- `generated_files`: run outputs linked back to canonical files.
- `eval_reports`: structured evaluation results.
- `usage_ledger`: provider/model token and cost attribution.

Composite tenant foreign keys prevent a child row from referencing a parent in another organization.

## Conversations

`chats` and `chat_messages` are the canonical conversation history. Runs link to their originating chat. Chat context is represented by explicit selected references and snapshotted into the run.

## Identity and authorization

Supabase `auth.users.id` is mirrored to `profiles.id`. `org_memberships` supplies owner/admin/editor/viewer authorization. Server routes validate bearer sessions and memberships before using privileged database credentials. Anonymous access is restricted to the development demo organization; production mutations require a membership role.

## Connections and secrets

`connections` stores redacted connector configuration and declared operations. `workspace_variables` stores ordinary values or environment-secret references. Credential material is resolved only on the server and is never stored in harness files.

## Billing readiness

`billing_customers` maps organizations to an external billing provider. `credit_ledger` is an idempotent signed ledger; service-role-only reservation and settlement functions serialize balance changes. Usage and credit ledgers are separate so provider usage can be reconciled independently from pricing and grants.
