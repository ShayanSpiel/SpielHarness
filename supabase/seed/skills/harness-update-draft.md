# Harness Update Draft

Revise a harness draft previously proposed by an agent.

## Safety contract

- Updates only agent-proposed drafts; active or user-authored harness files are rejected.
- Requires `expectedVersion` for optimistic concurrency control.
- A stale version fails clearly instead of silently overwriting parallel work.

## Input

Provide `id`, `expectedVersion`, and one or more of `title`, `body`, or `metadata`.

## Output

The updated draft id, title, type, status, and new version.
