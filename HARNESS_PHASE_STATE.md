# Harness Phase State

Current branch: `codex-harness-cleanup-phases`

Last committed checkpoint: `d92383b` (`Tighten eval editor layout`)

Uncommitted working state:

- Eval QA workflow steps and gate runtime behavior are implemented and verified locally.
- Phase 1 eval input mapping and Phase 2 enabled-state cleanup are implemented and verified locally.
- Seed sync refresh loop is fixed: seed sync now dispatches an in-app workspace reload event instead of hard-refreshing the browser, and seed metadata comparison strips `undefined` values.
- Universal input/output contracts were simplified: contracts are now role-owned editable Markdown/JSON bodies, not global catalog records.
- Phases 5-7 have baseline implementations in place and should be polished with manual UX review next.
- Production build fix: `/assets` compatibility route now redirects client-side to `/knowledge`, avoiding a Next prerender failure on the server redirect page.
- Current dirty files are expected and should be committed together when ready:
  - `HARNESS_PHASE_STATE.md`
  - `apps/web/app/assets/page.tsx`
  - `apps/web/app/api/harness/seed/route.ts`
  - `apps/web/app/api/runs/[id]/reply/route.ts`
  - `apps/web/app/api/runs/execute/route.ts`
  - `apps/web/app/evals/page.tsx`
  - `apps/web/app/knowledge/page.tsx`
  - `apps/web/app/roles/page.tsx`
  - `apps/web/app/settings/page.tsx`
  - `apps/web/app/strategy/page.tsx`
  - `apps/web/app/tools/page.tsx`
  - `apps/web/app/workstreams/page.tsx`
  - `apps/web/components/document-editor.tsx`
  - `apps/web/components/prompt-editor.tsx`
  - `apps/web/components/seed-bootstrap.tsx`
  - `apps/web/lib/execution-service.ts`
  - `apps/web/lib/object-references.ts`
  - `apps/web/lib/supabase-store.ts`
  - `apps/web/lib/use-workspace-store.ts`
  - `apps/web/lib/workspace-data.ts`
  - `packages/core/src/index.ts`
  - `packages/graph/src/index.ts`
  - `supabase/seed/workflows/ad-test-planning.json`
  - `supabase/seed/workflows/content-pipeline.json`
  - `apps/web/components/mention-insert.tsx`

## Product Direction

Keep the harness simple and file-backed.

- Do not expose `draft` or `archived` for Roles, Skills, Evals, or Workflows yet.
- Use one `Enabled` switch for executable objects.
- Internally map enabled state to existing DB-compatible status values:
  - enabled: `active`
  - disabled: `draft`
- Treat archive as a later feature only when archive browsing, restore, and lifecycle UX exist.
- Defaults may exist, but starter content should be editable file-backed seed records, not hardcoded app behavior.

For Files, Strategy, and Prompts:

- Hide status controls unless status changes real behavior.
- Do not invent draft/archive UX until there is an actual lifecycle.

## Current State

- `/prompts` redirects to `/strategy`.
- Strategy owns two sections:
  - Strategy Files
  - Prompts
- Strategy and Prompt folders are scoped to their own files instead of inheriting global Library folders.
- Knowledge/Library still uses shared folders intentionally.
- Prompt and strategy folders no longer populate the global library folder list.
- Eval Target Type is not shown in the primary eval editor.
- File-backed eval descriptions no longer show raw JSON bodies in the eval editor.
- Eval editor criteria rows use aligned row layout, editable chips for multi-value checks, and info-icon helpers.
- Eval result history is not duplicated in the main editor pane; result details remain in the inspector.
- Duplicate "Save eval as skill" action was removed.
- Workflow runs are blocked in the UI/function unless the workflow is enabled.
- Workflows now use the same simple Enabled switch pattern as evals.
- Roles and Skills now use the same Enabled switch pattern in primary UX.
- Strategy, Prompts, and Library pages hide file status controls because status has no clear lifecycle behavior there yet.
- New Roles default to the first enabled workspace model instead of always using a hardcoded model id.
- Global contract records and Settings > Contracts were removed as overbuilt for the current hierarchy.
- Role input/output contracts are now role-owned metadata fields edited directly in the Role sidebar.
- Role contracts support Markdown/JSON authoring, required/multiple flags, and mention insertion.
- Workflow role steps inherit the selected Role input/output contract names; workflows no longer pretend to own separate contract definitions.
- Eval workflow steps show source mapping and a fixed eval report output.
- Workflow run context now keeps role/skill ids in node payloads and selected Files in file context; role ids are no longer sent as knowledge context.
- Prompt, document, role prompt, role contract, workflow prompt override, skill implementation, and eval sample/description editors can insert stable object mentions using one `spielos://kind/id` reference format.
- Existing runtime still represents executable object availability through file `status` values.

## Eval And Workflow Gate State

The graph still runs only the first skill on each workflow node:

```ts
const skill = state.skills.find(
  (s) => s.id === (node.skillIds[0] ?? null)
) ?? null;
```

That is now an explicit product constraint:

- Assigning an eval skill as a secondary role skill does not reliably run it.
- Mentioning an eval in a role prompt is not a real eval.
- Real evals run either from the Eval page or as their own workflow QA step.

Implemented:

- Enabled eval files appear beside roles in the Workflows step toolbar as `QA:` steps.
- Clicking or dragging a `QA:` eval adds a workflow node with `nodeType: "eval"`.
- Eval workflow nodes use a synthetic `runtime.eval` Evaluation Runner role.
- Eval workflow nodes execute the selected file-backed eval definition.
- Eval step inspector shows `QA eval`, hides Role/Skills controls, and shows gate behavior.
- Eval `loopConfig` is passed from eval files into workflow nodes and runtime execution.
- QA gate behavior is now runtime-enforced:
  - pass: continue workflow
  - fail without retry: stop workflow and emit `run_failed`
  - fail with retry enabled: retry the previous step until max attempts, then stop if still failing
- Run API routes preserve graph terminal status, so QA gate failures are stored as failed runs instead of completed runs.
- QA steps now persist and execute an explicit eval input source:
  - previous step output
  - workflow request
  - selected workflow step output
- The graph stores outputs by node id so evals do not depend only on the latest global `state.output`.
- `LLM judge` is hidden from new criterion choices until it has model-backed scoring; existing saved rows are still preserved.
- Direct Eval page test runs remain score-producing eval runs; they do not become workflow gate failures.
- Seed workflows now use real `harness_eval` files for QA steps instead of legacy evaluator skills.

Not done:

- Retry policy is inherited from the eval record and shown as behavior text; there is no per-workflow retry editor yet.
- Existing DB workstreams seeded before this change may still contain legacy evaluator-skill nodes until reseeded or manually edited.
- Eval input mapping supports one source at a time. Multi-source artifact composition belongs in the universal contract phase.

## Initial Plan Audit

1. Prompts and Strategy
   - Done: `/prompts` is redirected into `/strategy`; Strategy separates Strategy Files and Prompts; prompt folders no longer leak into Library.
   - Remaining: audit prompt-specific icons, labels, metadata, JSON prompt validation/runtime purpose, and empty states for polish.

2. Hardcoded Values
   - Partially done: evals/workflows now avoid decorative status UX and use file-backed eval/workflow records; new Roles use the configured workspace model by default.
   - Audit findings captured below. Remaining implementation should be split by object boundary, not handled as one broad refactor.

3. Status and State Fields
   - Done for evals, workflows, roles, and skills: primary UX uses Enabled and disabled objects are blocked at runtime.
   - Done for Strategy, Prompts, and Library: decorative status controls are hidden.
   - Remaining: deeper audit of Settings/Chat/context surfaces and archive lifecycle only when browse/restore UX exists.

4. Universal Input and Output System
   - Corrected: global contract records were removed as the wrong abstraction for the lean hierarchy.
   - Done: Roles own editable input/output contract bodies; Workflows inherit role contract names; Skills keep technical schemas; Evals keep source mapping and eval report output.
   - Remaining polish: deeper runtime validation and richer multi-source artifact composition only when the runtime can enforce it.

5. Workflow Sidebar
   - Done: Files picker has search and selected visibility; selected files remain node `fileIds`; workflow run payload sends selected files as context and leaves role/skill ids in node config.
   - Remaining polish: manual browser verification of file-to-graph state on a real workflow run.

6. Evaluation UX
   - Mostly done: Target Type hidden, descriptions are text, criteria are readable, values use chips, direct test run exists, evals can be QA workflow gates, and QA steps have explicit input mapping.
   - Remaining: model-backed `LLM judge` scoring if that check type should be supported.

7. Universal Object Mentions
   - Baseline done: shared object reference builder and stable mention format exist for Files, Prompts, Roles, Skills, Evals, and Workflows.
   - Implemented in supported text editors: Prompt editor and Document editor.
   - Remaining polish: richer searchable popover, duplicate-name disambiguation UI, and validation warnings for deleted/inaccessible references.

8. Sidebar and Form Consistency
   - Baseline done: evals, workflows, roles, skills, strategy, prompts, and library now use consistent Enabled/status treatment and shared contract/mention affordances where applicable.
   - Remaining polish: manual visual QA and copy tightening across Settings, Chat context pickers, run drawers, and shared editors.

## Next Implementation Phases

### Phase 1: Finish Evals Cleanly

Goal: close the remaining eval gaps without expanding scope.

Tasks:

- Done: add explicit eval input source UX for QA steps:
  - default: previous step output
  - next option: selected workflow artifact/output contract
- Done: persist and execute that mapping instead of relying only on `state.output || state.prompt`.
- Deferred: per-workflow retry override. Keep retry owned by the eval until there is a clear marketer need.
- Done: hide `LLM judge` from new choices until model-backed scoring exists.
- Not added: focused automated tests. No test runner is configured; verification remains `typecheck` and `lint` for now.

### Phase 2: Status Consistency Across Executable Objects

Goal: make availability behavior understandable everywhere.

Tasks:

- Done: replace Roles status dropdowns with Enabled switches.
- Done: replace Skills status dropdowns with Enabled switches.
- Done: confirm disabled Roles cannot be selected in workflow builder and are blocked by runtime validation.
- Done: confirm disabled Skills cannot be selected in role/workflow controls and are blocked by runtime validation.
- Done: keep `archived` internal until browse/restore UX exists.
- Done: hide decorative status controls for Strategy, Prompts, and Library.

### Phase 3: Hardcoded Harness Values Audit

Goal: remove sample-data coupling and non-functional fields.

Tasks:

- Done: initial scan of hardcoded categories, tags, artifact names, input/output strings, role/skill/eval names, workflow labels, settings, model defaults, and sample records.
- Done: new Role defaults now use the first enabled workspace model instead of a fixed model id.
- Finding: most real starter content is already under `supabase/seed`:
  - agents
  - skills
  - evals
  - system prompts/strategy files
  - templates
  - workflows
- Done: workflow seed contract strings remain compatibility labels only; loaded workflow role nodes are normalized to the selected Role contract names.
- Done: Role input/output authoring moved into role metadata; legacy artifact arrays remain only as compatibility fields.
- Finding: Skill category/auth/effect options are hardcoded but currently map directly to runtime skill behavior and type unions. Keep them validated defaults unless a real customization need appears.
- Finding: folder defaults for Strategy, Prompts, and Library are hardcoded page defaults. They are user-editable once files/folders exist; avoid a config system unless workspace-level folder templates become a feature.
- Finding: model defaults still exist in runtime fallback paths (`mistral-large-latest`) where no provider/model is configured. That fallback is acceptable as a runtime default, but visible creation flows should prefer configured workspace models.
- Remaining: audit Settings and Chat context copy/defaults for sample-data coupling.
- Remaining: remove legacy evaluator skill seeds if they become redundant after existing migrations/reseeds are handled.
- Remaining: update `supabase/manual_harness_merge.sql` and migrations only if actual schema drift is introduced.

### Phase 4: Universal Input/Output Contracts

Goal: replace raw internal contract strings with readable Role-owned contracts.

Tasks:

- Rejected: global `ContractDefinition` catalog, contract seed files, and Settings > Contracts. It was too complex for the current Role -> Workflow hierarchy.
- Done: define role-owned contract shape: name, format, body, required, and multi-value support.
- Done: Role sidebar has dedicated Skills / Input / Output tabs.
- Done: Role input/output contracts can be written as Markdown or JSON.
- Done: Workflow role nodes inherit and display selected Role contract names instead of editing separate contracts.
- Done: Eval workflow nodes show source mapping and fixed eval report output.
- Done: keep Skill raw schema editing in the Skill inspector only; normal Role/Workflow flows use readable selectors.
- Partially done: runtime validation is still shallow.
- Remaining polish: validation warnings when contract requirements are not met.

### Phase 5: Workflow Files And Context Audit

Goal: make workflow file selection clearly functional.

Tasks:

- Done: trace selected workflow files from UI to `/api/runs/execute` to graph state.
- Done: clarify boundary in code: Files are context via node `fileIds`; Roles/Skills/Evals are executable config via nodes.
- Done: remove role ids from file context payload.
- Done: ensure evals are QA nodes, not generic Skills; Files and prompts are not worker nodes.
- Remaining polish: manual run verification with selected files.

### Phase 6: Mentions And References

Goal: implement one stable object reference system after object boundaries are clean.

Tasks:

- Done: design one mention model with stable IDs and display names.
- Done: add shared mention insertion to Prompt and Document editors.
- Done: add mention insertion to Role prompts, Role input/output contract bodies, Workflow prompt overrides, Skill implementation, and Eval description/test sample.
- Partially done: suggestions include object type labels; full icons/search popover deferred.
- Remaining polish: duplicate-name handling, deleted/inaccessible-reference validation, and permission warnings.

### Phase 7: Cross-Product Form Consistency

Goal: make the product understandable in five minutes without architecture knowledge.

Tasks:

- Done: audit and normalize the main harness editors touched in this phase: Evals, Workflows, Roles, Skills, Strategy, Prompts, Library.
- Done: preserve the existing app shell and layout.
- Remaining polish: Settings, Chat context picker, run drawer, and final browser visual QA.

## Verification

Passed after refresh-loop fix, eval/workflow gate work, and file-backed contract implementation:

```bash
npm run typecheck
npm run lint
npm run build
```

Build note:

- `npm run build` emits warnings about missing optional `@next/swc-darwin-arm64` packages, then falls back and completes successfully.

Manual verification still recommended before commit:

- `/workstreams` shows active evals as `QA:` buttons in the step toolbar.
- Clicking or dragging a `QA:` eval creates a QA node.
- QA node inspector shows `QA eval` and gate behavior, not Role/Skills controls.
- Disabled workflows cannot be run; enabled workflows can run.
- A failing QA workflow gate stops the workflow unless retry is enabled.
