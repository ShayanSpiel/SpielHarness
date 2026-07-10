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

## Database

When backend schema drift is suspected, update `supabase/manual_harness_merge.sql` and migrations together where practical. The manual merge is intended for the Supabase SQL editor.
