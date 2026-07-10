# Data Model

All durable records include `org_id` unless they are global auth-adjacent records. The schema is single-user first but org-ready.

Core durable objects:

- orgs and profiles
- strategy files
- roles, tools, role tool assignments
- prompts and prompt versions
- knowledge sources and chunks
- assets
- graph templates
- runs, run roles, run artifacts
- artifacts and artifact lineage
- events
- eval reports

Lineage is modeled through `artifact_lineage` and `run_artifacts`. Prompt and artifact history is versioned. Configurable objects use `deleted_at` where lineage may need to survive deletion.
