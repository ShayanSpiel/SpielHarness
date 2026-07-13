# AGENTS.md

## Project Rules

- Treat the harness as file-backed. Do not hardcode production roles, skills, evals, workflows, prompts, or templates in app code.
- Prefer adding editable seed files under `supabase/seed` for starter content.
- Keep file-backed harness ids executable. UI roles and skills may be `files` rows, so run APIs must resolve from `files` as well as legacy `roles` and `tools` tables.
- Keep API responses in the shape consumed by the frontend. `/api/harness/files` returns camelCase client rows.
- Do not reintroduce a `/harness` page or nav item. Harness resources are managed through Roles, Skills, Workstreams, Evals, Strategy, and Knowledge.

## Verification

Run the smallest useful check after changes:

```bash
npm run typecheck
npm run lint
```

Use `npm run build` before shipping larger UI or API changes.

## UI System

- Use the repo skill at `.agents/skills/spielos-ui/SKILL.md` for UI implementation, review, or polish work.
- Treat `docs/design-system.md` and `docs/interaction-design.md` as visual and behavioral sources of truth.
- Put repeated color, typography, radius, motion, shadow, icon, surface, and state decisions in `packages/design-system` before consuming them in app code.
- Preserve established information architecture and layout unless a requested interaction change requires otherwise. Polish shared patterns before page-local instances.
- Run `npm run check:ui` after UI changes. Larger changes require browser verification in dark, light, and monochrome themes.

## Database

When backend schema drift is suspected, update `supabase/manual_harness_merge.sql` and migrations together where practical. The manual merge is intended for the Supabase SQL editor.

## Run Lifecycle

- The durable run statuses are `running`, `waiting_human`, `completed`, `failed`, and `cancelled`. `idle` is client-only and must never be persisted.
- Treat terminal events and the SSE `done.status` as authoritative. Do not maintain a competing loading boolean or infer liveness from the presence of events.
- LangGraph emits node, skill, tool, eval, artifact, human-input, and terminal events when they occur. Do not fabricate progress messages in the UI or model output.
- Plain chat is a first-class assistant path. It must work without a selected harness item and must not be presented as workflow execution.
- A workflow request uses `workflowId`; role, skill, and eval requests use `targetId`. Files use `contextFileIds`.
- Execution activity in chat is inline and compact. Keep the complete event history in the Events inspector; do not render a bordered execution transcript inside the assistant answer.
- Human questions are structured, file-backed workflow/skill data. LangGraph emits the request; the composer renders text answers and the shared choice/wizard primitives render single- and multi-select questions. Do not parse option copy from prose in the UI.
