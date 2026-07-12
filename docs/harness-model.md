# Marketing Harness Model

SpielOS is a customizable, role-based marketing team harness. The UI manages harness resources through focused pages, not a separate `/harness` area.

## Source Of Truth

- Configuration: file-backed rows in `files` are the canonical editable definitions for roles, skills, evals, workflows, templates, strategy, prompts, knowledge, and generated objects. Legacy harness tables are not active write sources.
- Content: library, knowledge, drafts, evidence, assets, references, and generated artifacts are content files. They can be selected as execution context, but they are not executable targets.
- Runtime: runs, run events, human inputs, outputs, generated file links, and evaluation artifacts are runtime records. Runtime state is not stored inside role, skill, or workflow definitions.
- Secrets: credentials are resolved server-side from environment variables or secret refs. API responses expose only redacted status.

## Domain Boundaries

- Roles are executable marketing team members. A role owns its prompt, model selection, input/output contracts, memory policy, and assigned skills.
- Skills are reusable capabilities. A skill may reference an operation exposed by an integration, but it does not store connector credentials.
- Integrations live in Settings or server configuration. The relationship is Integration -> operation -> Skill -> Role.
- Evaluations are reusable rubric definitions. They can run independently through the execution service or be represented as `kind="eval"` skills for role/workflow use.
- Workflows coordinate roles. Business nodes reference canonical role records. They do not copy role prompts, models, or assigned skills. A node may carry minimal coordination fields: title, role id, edges, optional prompt override, selected context files, and I/O labels.
- Chat creates execution requests. It does not implement separate role or workflow logic.

## Chat Compatibility

- Empty context is valid and is sent as `explicit_context = []`.
- Files, prompts, datasets, and library records are context only.
- One workflow may be selected. It is exclusive with role, skill, and eval targets; knowledge context is allowed.
- One role may be selected. One direct skill may supplement it.
- One direct skill may run by itself.
- One eval may run by itself.
- Invalid combinations are blocked in the context picker and validated again by `/api/runs/execute`.

## Canonical Execution Path

All executable surfaces call `/api/runs/execute`:

```text
Chat / Role test / Skill test / Eval test / Workflow run
  -> typed execution request
  -> server compatibility validation
  -> harness file resolution
  -> run row
  -> persisted chat response or data-driven DAG runtime
  -> run events, artifacts, generated file links
```

`apps/web/lib/execution-service.ts` owns target inference, compatibility validation, server-side DAG compilation, file-backed role/skill/eval/workflow resolution, selected context tracing, and stored provider/model resolution with environment fallback.

## LangGraph Ownership

`packages/graph` owns orchestration for role, skill, evaluation, and workflow execution. The graph is shared and data-driven:

- `resolve` picks the next role-bound node and skill step.
- `execute` runs the active skill kind with dependency outputs and selected marketing objects.
- `advance` moves through the compiled DAG or persists a durable human-input checkpoint.

Saved workflow edges are authoritative. The server rejects missing endpoints and cycles, computes dependency order, and ignores client-supplied node overrides for saved workflows. Multi-skill nodes are expanded into deterministic skill steps rather than silently dropping companion skills.

Plain empty-context chat can complete through the same run API without building a graph when no executable target is selected.

## Adding Resources

- Provider or integration: add server-side configuration, expose redacted metadata in `/api/integrations`, and register provider adapters in `packages/providers`.
- Skill: create a `harness_skill` file with `metadata.skill=true`, a `kind`, input/output schemas, side-effect metadata, and operation references where needed.
- Role: create a `harness_role` file with prompt body and role metadata including `skillIds`, model id, input types, and output types.
- Evaluation: create a `harness_eval` file with rubric metadata. It can be run directly or saved as an eval skill.
- Workflow: create a `harness_workstream` file whose nodes reference role ids. Keep workflow configuration small.
