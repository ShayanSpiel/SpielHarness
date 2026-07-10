# Harness Phase State

Current branch: `codex-harness-cleanup-phases`

Current checkpoint commit: `7ee4b9b` (`Clean up strategy prompts harness UX`)

## Current State

- `/prompts` redirects to `/strategy`.
- Strategy owns two sections:
  - Strategy Files
  - Prompts
- Strategy and Prompt folders are scoped to their own files instead of inheriting global Library folders.
- Knowledge/Library still uses shared folders intentionally.
- Prompt and strategy folders no longer populate the global library folder list.
- Eval Target Type is no longer shown in the primary eval editor.
- Duplicate "Save eval as skill" action was removed.
- Workflow runs are blocked in the UI/function unless the workflow is active.
- Existing runtime still represents executable object availability through file `status` values.

## Immediate Product Direction

Keep the UX simple:

- Do not expose `draft` or `archived` for Roles, Skills, Evals, or Workflows yet.
- Use one `Enabled` switch for executable objects.
- Internally map enabled state to the existing DB-compatible status values for now:
  - enabled: `active`
  - disabled: `draft`
- Treat archive as a later feature only when there is archive browsing, restore, and clear lifecycle UX.

For Files, Strategy, and Prompts:

- Hide status controls unless status changes real behavior.
- Do not invent draft/archive UX until there is an actual lifecycle.

## Eval Runtime Reality

The graph currently runs only the first skill on a workflow node:

```ts
const skill = state.skills.find(
  (s) => s.id === (node.skillIds[0] ?? null)
) ?? null;
```

Eval skills execute mechanically through `evaluateRules(state.output || state.prompt, rules)`.

This means:

- Assigning an eval skill as a secondary role skill does not reliably run it.
- Mentioning an eval in a role prompt is not a real eval. It is only LLM instruction.
- A real eval must be either:
  - a direct Eval page run, or
  - its own workflow step/gate.

## Recommended Eval Product Model

Use two workflow step types:

- Role step: a marketing team member that generates, researches, edits, packages, asks, etc.
- Eval step: a QA/gate step that scores the previous output or a mapped workflow artifact.

In the workflow UI, evals should be addable in the same area as roles, but visually labeled as QA steps:

- `QA: Pipeline Gates`
- `QA: Content Quality`
- `QA: Grounding Check`

This keeps the user model simple:

- Roles make work.
- Evals judge work.
- Workflows connect both.

Do not present evals as generic Skills in the normal workflow-building UX.

## Next Phase: Evals UX

Goals:

- Make eval creation digestible for marketers.
- Keep deterministic checks and quality checks customizable.
- Avoid raw schemas and comma-separated string instructions in normal flows.
- Keep an advanced escape hatch later, but do not expose it as the default path.

Recommended eval editor model:

1. Eval header
   - Name
   - Description
   - Enabled switch
   - Overall pass score
   - Direct test input

2. Criteria list
   - Each criterion is a row/card with:
     - human-readable label
     - check type
     - editable values as chips/inputs
     - weight
     - pass threshold only when useful
     - plain-language helper text

3. Check types
   - Contains any of
   - Must not include
   - Minimum words
   - Maximum words
   - Matches pattern
   - LLM judge

4. Value editing
   - For multi-value checks, use editable chips.
   - Add value via inline input.
   - Values can be deleted individually.
   - No comma-separated UX.

5. Test panel
   - Paste sample output.
   - Run eval.
   - Show pass/fail, score, failed criteria, and plain recommendations.

6. Workflow integration
   - Add evals as QA workflow steps.
   - Eval step should use previous step output by default.
   - Later: allow explicit mapping to workflow artifacts.

## Later Phases

- Replace status dropdowns with Enabled switches across Roles, Skills, Evals, and Workflows.
- Remove `targetType` / `targetId` from eval UX and eventually from required authoring paths.
- Implement eval workflow steps/gates.
- Implement a universal input/output contract model with:
  - readable names
  - descriptions
  - data type
  - required/optional
  - multi-value support
  - editable suggestion chips
  - custom values
- Add mentions/reference system only after object boundaries are clean.
- Add archive lifecycle only when archive browse/restore UX exists.

## Verification From Last Phase

Both passed before commit `7ee4b9b`:

```bash
npm run typecheck
npm run lint
```
