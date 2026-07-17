# SpielOS Frontier Automation Audit and Execution Plan

Status: active implementation and live certification
Audit date: 2026-07-17  
Audience: Terra and every implementation agent working in this repository

## Implementation status — 2026-07-17

This document remains the active milestone record. Do not restart the audit or
replace it with a new plan after a session reset.

Completed and validated:

- Auth and application database pool defaults raised from one to four with
  configurable limits, session lookup coalescing, and a retry path. The app
  pool fix followed a measured 498-second resumed checkpoint stall during the
  live landing-page run.
- Server-side organization membership is now the authorization source; the
  client role cookie is ignored for permission decisions.
- Google sign-in uses identity scopes only; connector OAuth uses signed,
  short-lived state bound to user, organization, and integration. Provider
  access/refresh tokens are no longer stored in browser cookies.
- Drive records use the real organization id and Drive loading is limited to
  Files > Files rather than every workspace boot.
- Catalog entries with no executable adapter (Calendar, GA4, Exa/Tavily MCP,
  Brave) are marked unavailable in the file-backed manifest, blocked by the
  API, and covered by an adapter-conformance test.
- JSON boundary and UI guardrail regressions were fixed. The suite last passed
  typecheck, lint, UI contracts, and 103 unit tests; production builds pass,
  with the existing missing native SWC warning still open.
- Long-horizon state now flows through plain chat, `llm_call`, and ReAct
  workflow nodes; the pinned state and append-only milestone list are included
  in durable checkpoints and restored after a human pause/restart. Existing
  milestones are no longer misreported as fresh compactions or overwritten.
- Live browser scenario `LH-20260717-A` passed on the configured
  `mistral-small-latest` model after removing the model-tier bypass that had
  silently disabled extraction. The inspector persisted `v1` with the Project
  Aster goal, one decision, one open task, and the no-external-writes
  constraint across a full Next.js process restart. The native
  `long_horizon` event was visible in Events. Files > Files also reloaded the
  connected Drive list after restart without modifying an external file.
- Typed multi-file project artifacts now validate a project contract, reject
  unsafe/duplicate paths, create durable project artifacts, and render in a
  shared Preview/Source/Files workbench. A delimiter-based raw-file transport
  recovers HTML/CSS/JS without one giant escaped JSON response. The workbench
  has a shared full-screen dialog in chat and the inspector, with Escape close.
  HTML preview is sandboxed and local project CSS/assets are assembled without
  remote execution. JSON and real PDF bytes have dedicated render paths.
- File-backed Landing Page Strategist, Builder, and Publisher roles, an
  HTML-first Premium Landing Page workflow, project template, project artifact
  skill, and outcome evaluator are seeded and resolvable. Drive folder/file
  create/update/project-publish and Notion database-create primitives are
  registered as groundwork, but no external landing write is in the current
  workflow or claimed as certified.
- Human-input resume now shows explicit context/model-generation activity,
  live resumed usage/run-state frames, and a numbered wizard step rail. Retry
  reuses the persisted answers for a pending human checkpoint. Terminal human
  answers remain structured engine state and are no longer emitted as raw JSON
  assistant messages or generic artifacts. Authoritative run status is applied
  after durable event replay, key resume events persist immediately, and the
  inline timeline/artifacts restore independently of assistant text.
- Live Medium certification resumed from the saved brief/strategy checkpoint,
  recovered the malformed builder envelope into a seven-file project, emitted
  the project and 89/100 eval artifacts, reached Landing Review, accepted the
  user's approval, verified Preview/Source/Files and full-screen behavior, and
  completed with 60 durable events.

In progress — do not mark complete until live/restart tests pass:

- The basic live/restart continuity slice now passes, but Milestone E remains
  open until a live forced-compaction/milestone run and the complete 200+ turn
  matrix cover model switching, conflicting instructions, human pauses, and
  replay from a restarted durable worker. The current request-owned runtime
  cannot satisfy the worker-restart portion of that gate.
- HTML-first runtime certification now passes end to end, including durable
  resume, artifact recovery, QA, review, completion, and restored workbench UI.
  Business-quality certification remains open: the live artifact invented
  unsupported implementation-time, source-coverage, freshness, time-to-value,
  and security claims despite the brief; it also omitted the requested
  `analytics.json` and `Files/form-handler.js`. The existing lexical evaluator
  passed at 89/100 and therefore needs stricter claim/file-contract rules before
  the landing workflow can be called publish-ready.

Known active blockers/debt:

- Runs are still request-owned; there is no durable worker, lease/fencing,
  cross-process event transport, or persistent external-operation idempotency
  journal.
- Drive plain-file/folder/project write primitives and project artifact viewers
  now exist, but the durable idempotency journal, live sandbox write/cleanup
  certification, Google-native document creation, GitHub, deployment, GA4, and
  MCP remain open. Do not claim external write automation as complete.
- Cold authenticated startup and Drive list loading remain slow. The duplicate
  Drive request was removed, but DB/session latency needs instrumentation and
  a concurrency benchmark.
- Browser automation may lose the released authenticated tab after a build.
  On reset, reopen/claim the localhost tab, verify the logged-in profile,
  then run the live plain-chat and Files > Files regression before continuing.

## 1. Executive verdict

SpielOS has a promising file-backed harness, a usable graph editor, native run events, human-input primitives, model routing work, and a polished UI foundation. It is not yet a production-ready business-automation platform and it is not yet safe to describe as capable of arbitrary long-horizon AI employees.

The blocking gap is architectural, not cosmetic: the product catalog and seeded workflows claim operations that the runtime cannot execute; runs still live inside a web request and can die with it; external writes do not have a durable idempotency journal; authentication is unstable under normal page fan-out; the long-horizon context implementation is not connected to live graph execution; and artifacts are stored and rendered mostly as strings.

Do not begin by adding more impressive workflow JSON. Build one truthful, durable vertical slice at a time. Every visible capability must have an executable adapter, a test environment, a structured output contract, an observable receipt, and a failure/recovery test.

## 2. Current capability matrix

| Requested capability | Current state | Required state |
| --- | --- | --- |
| Google Drive | Connected list/search/read/export plus typed folder/file create, update and project-publish primitives; writes are not yet journaled or live-certified | Move, copy, permission and Google-native export operations with durable idempotency, receipts, previews, and sandbox tests |
| Google Docs/Sheets/Slides/Forms | No creation adapter | Typed create/update/export adapters, visually verified templates, Drive links and safe in-app preview |
| GitHub and GitHub Pages | No integration or runtime adapter | GitHub App auth, repo/branch/tree/commit/PR/Pages operations, protected-write policy and deployment receipts |
| Chat execution | SSE/events and inline activity exist | Durable background execution, reconnect/replay, accurate error presentation, fast authenticated startup and one event subscription per workspace |
| Artifact UI | Shared project workbench renders sandboxed multi-file HTML Preview, per-file Source/Files, JSON, and real PDF bytes in chat and inspector | Full-screen Data/History/Provenance, additional office/media renderers, large-artifact virtualization and visual certification |
| Premium landing pages | File-backed HTML-first roles/workflow/template/eval and typed multi-file project creation exist; live Medium run passed brief/strategy but full artifact approval is pending | Complete live artifact preview/a11y certification, then opt-in form persistence, Drive save, GitHub preview and deployment receipts |
| Analytics report | Seed advertises `analytics.report`; no executable adapter | GA4 adapter, normalized datasets, chart/report artifacts and Drive export |
| SEO/content calendar | Seed workflows exist, but outcomes are generic text and connected persistence is incomplete | Structured datasets, premium artifact rendering, Notion/Sheets persistence and outcome evals |
| Website manipulation | Missing | Safe Git tree changes, previews, checks, approval boundaries, commit/PR/deploy receipts |
| Long-horizon memory | Live chat and workflow model nodes use the long-horizon assembler; pinned state/milestones persist through metadata and durable checkpoints; browser/process-restart continuity passed for the basic slice | Forced live compaction, retrieval references, 200+ turn model-switch/human-pause continuity, and durable-worker restart evals |
| General workflow flexibility | Basic DAG, roles, skills, files, eval loops and human questions | Versioned workflow spec with conditions, triggers, typed variables, subflows, map/reduce, retries, policies and compensation |
| MCP integrations | Catalog entries exist; graph throws not configured/not implemented | Real client, discovery, auth/policy layer, timeouts, schemas, audit and conformance tests |

## 3. Confirmed audit findings

### P0 — security and correctness

1. Workspace authorization trusts the client-controlled `spielos.org-role` cookie in `apps/web/lib/server.ts`. Authorization must come only from server-side membership data. Display cookies must never grant permissions.
2. Google OAuth callback code stores raw access and refresh tokens in browser cookies after also storing an encrypted connection secret. Tokens must remain server-side only.
3. App login requests broad Gmail, Calendar, Drive and Analytics scopes. Authentication and connector consent must be separated; connectors request the minimum scope at connection time.
4. OAuth state is not strongly bound to user, organization and intended integration in a server-verifiable record.
5. A browser/request disconnect can still abort a run. There is no durable worker, lease/fencing protocol or cross-process run registry.
6. External side effects have no persistent invocation journal or idempotency fence. Retrying a run can duplicate emails, pages, files or publications.
7. Integration catalog truth is not enforced. Seeded analytics and MCP capabilities can reach guaranteed runtime failures.

### P0 — reliability and performance

1. `AUTH_POOL_MAX` defaults to `1`. Live testing produced connection-acquisition timeouts, terminated connections, intermittent 401 responses and multi-second to multi-tens-of-seconds page requests.
2. The app issues duplicate session, files, Drive, chat, model and organization requests during page startup. Both chat and domain stores subscribe to organization invalidation, and Drive data is loaded outside the Drive surface.
3. A plain chat request took roughly a minute to reach an authentication failure after route compilation and pool contention. The UI rendered the operational failure as an assistant message rather than a Notice/error state.
4. The production build succeeds but falls back because the native Darwin SWC package is unavailable. Large route bundles include Knowledge at roughly 382 kB first load and Workflows at roughly 300 kB.

Increasing the pool is necessary but not sufficient. Make pool sizes environment-configurable, benchmark `1/4/8` (within Supavisor/database limits), remove duplicate demand, memoize request-local session checks, and test concurrent authenticated page boot. Otherwise a larger local pool only moves saturation downstream.

### P1 — agent/runtime architecture

1. `packages/providers/src/long-horizon.ts` is not called by live graph execution. `packages/graph/src/index.ts` still calls `assembleConversationContext`.
2. Realtime fan-out and active-run control are process-local. They will diverge across multiple web instances.
3. The core graph is a basic DAG. It lacks versioned triggers, conditional expressions, typed workflow variables, subworkflows, foreach/map-reduce, retry/backoff policy, compensation, concurrency policy and explicit artifact contracts.
4. Tool invocation uses a text protocol instead of provider-native structured tool calling, reducing validation and increasing malformed outputs.
5. Completion verification checks presence of node output, not the real business outcome or external side-effect receipt.

### P1 — integrations and artifacts

1. Drive provider code supports list/search/read/export, not writes or folder management. Google-native exports are reduced to text/CSV and truncated.
2. `apps/web/app/api/google-drive/workspace-files/route.ts` returns a hardcoded organization id.
3. Two Google token-refresh paths behave differently; one does not persist refreshed credentials.
4. There is no Google Analytics, Google Workspace creation, GitHub, Vercel or real MCP runtime adapter.
5. Artifact types are broad string bodies with loose metadata. The chat and Events inspector render artifact bodies in `pre` elements. There is no sandboxed HTML renderer, PDF viewer, sheet/grid, slide/document viewer, media viewer, project tree or Drive embed.

### P1 — test/release health

Audit commands on this snapshot:

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run build`: pass, with SWC fallback and large-route warnings noted above
- `npm run check:ui`: fail on an arbitrary radius in `apps/web/lib/email.ts`
- `npm test`: 88 pass, 1 fail because `tests/db-json.test.ts` imports a missing `json` export
- `npm run db:verify`: fails because the script does not load the expected local environment
- Playwright E2E: fails/timeouts on `networkidle`; authenticated fixtures are missing and the wait strategy is incompatible with realtime/SSE

Live Drive testing confirmed connection, listing and file metadata. It did not prove write, folder, document creation or embed behavior because those operations do not exist. No external file was modified during the audit.

## 4. Target architecture

### 4.1 File-backed product model

Keep business behavior editable and file-backed:

- roles, skills, workflows, evals, prompts, strategies, templates and integration manifests live as validated files;
- stable generic primitives, security invariants and adapter implementations live in code;
- UI catalogs are generated from files plus runtime capability introspection, never duplicated in components;
- seeds contain real, executable starter content, not decorative or aspirational capabilities;
- every `contextSlug`, integration operation and workflow reference is statically resolvable.

Do not hardcode a marketing-only runtime. Marketing is the first complete product pack built on generic primitives.

### 4.2 WorkflowSpec v2

Introduce a versioned schema while preserving v1 imports:

```text
WorkflowSpec
  metadata: id, version, owner, labels, compatibility
  trigger: manual | schedule | webhook | event
  inputs: typed fields, defaults, validation, secrets references
  nodes: role | skill | tool | subworkflow | human_gate | transform | map | reduce
  edges: success | failure | condition(expression)
  policy: timeout, retry/backoff, concurrency, budget, confirmation, compensation
  artifacts: named typed output contracts
  permissions: allowed integrations, operations and data scopes
  evals: node, outcome, safety and regression gates
```

The editor should expose a simple default mode for non-coders and progressively reveal advanced behavior. JSON remains portable and directly editable.

### 4.3 Durable execution kernel

```text
API enqueue -> durable queue -> worker lease/fence -> node/tool journal
            -> atomic checkpoint + event log -> replayable realtime/SSE
            -> versioned artifact store -> external operation receipt
```

Requirements:

- web requests enqueue or attach; they never own the run lifecycle;
- workers use expiring leases and fencing tokens;
- checkpoints, event sequence and node status update atomically;
- each external call has a stable invocation id, input hash, attempt state and provider receipt;
- retries distinguish safe reads, idempotent writes and confirmation-required writes;
- cancellation/pause is durable and observed at checkpoints;
- reconnect replays from sequence number without duplicate UI events;
- Redis/Postgres-backed fan-out replaces process-local state in production.

### 4.4 Integration SDK

Every operation implements one contract: typed input/output schemas, auth/scopes, read/write effect, idempotency support, timeout/retry semantics, confirmation policy, redaction rules and receipt mapping. A runtime capability registry exposes only installed and authenticated operations.

Seed validation must fail when a workflow references an operation without an executable adapter. Unavailable operations remain visibly unavailable with a reason; they must never appear runnable.

### 4.5 Artifact model and workbench

Replace loose string artifacts with a versioned `ArtifactDescriptor`:

- `kind`, MIME type, renderer, title and version;
- inline content, local file tree or external provider reference;
- structured data/schema for tables and charts;
- dependencies/assets and build metadata;
- run/node/tool provenance and evaluation results;
- preview URL, source URL and provider receipt;
- permissions, retention and content hash.

The shared artifact workbench provides full-screen Preview and Source tabs, plus Data, Files, History and Provenance when relevant. Required renderers: sanitized Markdown, highlighted code, sandboxed HTML, PDF, table/sheet, charts, images, document/slide previews and multi-file web projects. Drive embeds must be permission-aware and fall back to an external link.

### 4.6 Long-horizon state

Use an immutable message/event log plus explicit mutable working state:

- pinned objectives, constraints and accepted decisions;
- workflow/node state and external resource references;
- milestone summaries with source ranges;
- retrieval index over approved files, messages and artifacts;
- compaction ladder driven by measured token budgets;
- extraction proposals validated and persisted as auditable state operations;
- compaction/retrieval events shown accurately in Events, with a concise chat summary.

No provider call may be hidden from budgets, traces or cost accounting. Cheap-model routing is allowed only after quality evals prove it preserves state and outcome quality.

## 5. Implementation sequence and release gates

Do not reorder these milestones unless a written dependency analysis proves it safe.

### Milestone A — make the current product reliable

1. Fix the red unit/UI/database/E2E checks and make test commands load deterministic test configuration.
2. Replace `networkidle` waits with semantic UI/run-state waits. Add authenticated Playwright fixtures and isolated test organizations.
3. Instrument session lookup, DB acquisition, route startup, provider time-to-first-token, event relay and client render latency.
4. Tune configurable auth/app pools against a concurrency test; remove duplicate startup fetches, centralize one workspace realtime subscription and lazy-load Drive only inside Files > Files.
5. Restore native SWC and split the largest route bundles.
6. Render auth/runtime failures as shared Notice/error states, never assistant prose.

Gate: all checks green; zero pool timeouts at the documented concurrency target; warm authenticated page p95 and chat pre-provider p95 have measured budgets; duplicate fetch/subscription assertions pass.

### Milestone B — fix tenancy, OAuth and credential boundaries

1. Remove role-cookie authorization. Resolve active organization and membership server-side for every protected request.
2. Implement owner/admin/editor/viewer permissions centrally and add cross-tenant negative tests.
3. Separate app sign-in from connector OAuth. Bind OAuth state to user/org/integration with expiry and one-time consumption.
4. Remove provider tokens from cookies; unify encrypted server-side refresh and persistence.
5. Add CSRF, rate-limit, audit-log, token-revocation and stale-workspace recovery tests.

Gate: no client-controlled value changes authorization; no provider token reaches browser storage; tenant-isolation and OAuth replay tests pass.

### Milestone C — build the durable agent kernel

1. Add a database-backed run queue, worker leases/fencing and cross-process event fan-out.
2. Add durable node attempts, tool invocation journal, idempotency keys and external receipts.
3. Move execution out of `apps/web/app/api/runs/execute/route.ts`; keep that route as enqueue/attach streaming transport.
4. Make pause/cancel/resume/retry survive process and browser restarts.
5. Add failure injection for worker kill, duplicated delivery, checkpoint conflict, 429/5xx, token expiry and lost network.

Gate: a run continues after browser disconnect and worker restart; replay is ordered and duplicate-free; a write operation cannot execute twice for one invocation id.

### Milestone D — enforce truthful capabilities and WorkflowSpec v2

1. Add the integration SDK and generate the capability matrix from manifests plus registered adapters.
2. Implement real MCP transport, discovery, schema validation, timeout and policy enforcement.
3. Fail seed/CI validation on missing adapters, unresolved context slugs or invalid operation inputs.
4. Add v2 conditions, typed variables, retries, error edges, subworkflows, map/reduce, triggers and policies incrementally behind schema-version dispatch.
5. Migrate one existing small workflow and prove v1 compatibility before migrating the catalog.

Gate: every runnable catalog operation passes adapter conformance; every seeded workflow can be planned against installed operations without guaranteed runtime failure.

### Milestone E — wire frontier session continuity

1. Replace live legacy context assembly with the long-horizon pipeline behind an explicit rollout flag.
2. Persist pinned state, milestones, retrieval references and state operations in atomic checkpoints.
3. Emit real compaction/retrieval/state events and include all model calls in budgets and metrics.
4. Test 200+ turn sessions with live runtime replay, model switching, compaction, human pauses, process restarts and conflicting instructions.
5. Establish quality/cost evals before routing extraction, summarization or evaluation to cheaper models.

Gate: continuity tests prove objectives, constraints, decisions, open tasks and external resource ids survive compaction and restart without fabricated state.

### Milestone F — ship Google Drive and Workspace as the first write vertical

1. Implement typed Drive folder/file create, update, move, copy, trash, permission and export operations.
2. Implement Docs, Sheets, Slides and Forms creation/update with reusable file-backed templates.
3. Return provider ids, revision/version, web-view/export links and receipts as structured artifacts.
4. Add Drive/Workspace sandbox accounts, recorded read fixtures and live write cleanup tests.
5. Add permission-aware preview/embed to the artifact workbench.

Keep Drive records only in Files > Files as external context. Local seed synchronization and local folder cleanup must never mutate Drive. Agent writes occur only through explicit integration operations and the durable journal.

Gate: an agent can create a folder, document, sheet, slide, form and PDF export; preview each result; reconnect and resume safely; and prove cleanup without touching unrelated files.

### Milestone G — ship GitHub and deployment

1. Use GitHub App installation auth, repository allowlists and minimum permissions.
2. Implement repo/branch/read/tree-write/commit/PR/checks/Pages/deployment operations.
3. Default website changes to a branch and preview/PR. Direct default-branch writes and production deploys require explicit policy/confirmation.
4. Add content-hash idempotency, conflict detection, secret scanning and build/test receipts.
5. Add Vercel or other platforms through the same adapter contract; do not special-case deployment in workflow code.

Gate: a sandbox workflow creates or updates a multi-file site, opens a PR, passes checks, publishes a preview and returns immutable commit/deployment links without duplicate commits.

### Milestone H — complete the artifact workbench and chat polish

1. Promote artifacts from expandable raw text to the shared full-screen workbench.
2. Add format renderers and Preview/Source/Data/Files/History/Provenance tabs only when applicable.
3. Keep chat execution compact; show accurate tool/parallel/streaming summaries inline and complete native event detail in Events.
4. Virtualize long threads/event lists, memoize renderers and progressively load large artifacts.
5. Fix empty-state contradictions and validate dark, light and monochrome themes at compact and wide widths.

Gate: every supported artifact has a safe, usable preview and source view; long threads remain responsive; keyboard/a11y and theme screenshot tests pass.

### Milestone I — premium marketing verticals

Build these as file-backed product packs using the same generic runtime:

1. **Premium Landing Page Studio:** research -> strategy brief -> offer/copy -> design tokens -> asset generation -> multi-file project -> Google/Notion form integration -> validation -> GitHub preview -> approval -> deploy -> analytics handoff.
2. **Monthly Analytics Report:** GA4 extraction -> normalized dataset -> insight/evidence pass -> charts -> executive report -> Docs/Sheets/PDF outputs -> Drive save and preview.
3. **SEO and Content Calendar:** research -> keyword clusters -> prioritization -> calendar dataset -> artifact preview -> Notion database or Sheets persistence -> approval.
4. **Website Maintenance:** inspect repo/site -> propose patch -> branch/commit -> visual and integration tests -> PR -> approved deployment.
5. **Professional Coding Employee:** issue/brief -> repository context -> plan -> edits -> tests -> review/eval -> PR with traceable evidence.

Native Notion Forms creation must be capability-discovered. If the provider API does not support it, use an explicit supported form/database integration and label it accurately; never simulate success.

Each pack includes roles, skills, workflows, evals, prompts, templates, integration requirements, example inputs and outcome-specific acceptance fixtures under `supabase/seed`.

Gate: each vertical completes from user request to externally verifiable result in a sandbox, including pause/reconnect, approval, retry, preview and receipt paths.

## 6. Required test matrix

Every integration and workflow must cover:

- happy path and empty/no-result path;
- expired/withdrawn auth, missing scope and wrong organization;
- rate limit, timeout, provider 4xx/5xx and malformed response;
- browser disconnect, worker restart and replay from checkpoint;
- duplicate delivery and concurrent edit/conflict;
- approval accepted, rejected and abandoned;
- partial external success followed by internal failure;
- large files, Unicode, binary/unsupported formats and permission denial;
- artifact renderer security, HTML sandboxing and untrusted Markdown;
- dark, light and monochrome visual checks;
- keyboard, screen-reader naming, focus and reduced motion;
- performance and cost budgets;
- output-quality evals grounded in source evidence and provider receipts.

Use sandbox Google, GitHub, Notion and analytics properties for live tests. Never use a developer's personal files as an automated fixture.

## 7. Definition of production-ready

SpielOS is ready for a capability only when all statements are true:

1. The capability is declared in a file-backed manifest and backed by a registered executable adapter.
2. Inputs and outputs are schema-validated and the UI can render the result.
3. Authentication, authorization and scope are explicit and tenant-safe.
4. Writes have confirmation policy, idempotency, durable receipts and recovery behavior.
5. Runs survive browser and worker failure and resume without duplicated effects.
6. Chat and Events show only real runtime events; errors are not assistant prose.
7. Unit, contract, integration, authenticated E2E, fault-injection, security, visual and performance gates pass.
8. Documentation states real limitations and unavailable operations visibly.

Do not claim “frontier-level” from architecture or synthetic tests alone. Prove it with a versioned eval suite covering continuity, tool correctness, outcome quality, recovery, latency and cost across representative long-horizon workflows.

## 8. Terra's first implementation queue

Terra should execute these tickets in order and stop at each gate:

1. Make the current checks deterministic and green; record baseline timings and bundle sizes.
2. Fix pool configuration, session retry/memoization, duplicate startup loads and duplicate realtime subscriptions.
3. Remove client-authoritative role state and provider-token cookies; unify OAuth refresh.
4. Generate a runtime capability report and make CI reject seeded operations without adapters. Mark currently unsupported catalog actions unavailable.
5. Introduce the durable queue/worker and prove a read-only run survives disconnect/restart.
6. Add the tool invocation journal and prove an idempotent sandbox write cannot duplicate.
7. Wire long-horizon state into live graph execution and add restart/compaction continuity tests.
8. Introduce `ArtifactDescriptor` and the workbench shell; implement Markdown, code, HTML and table renderers first.
9. Add WorkflowSpec v2 version dispatch and one migrated workflow with conditions, retry policy and typed artifacts.
10. Implement the Drive folder + plain-file write vertical, then Docs/Sheets/Slides/Forms and PDF export.
11. Implement GitHub branch/tree/commit/PR/Pages preview using the same durable write contract.
12. Build and certify Premium Landing Page Studio before expanding the rest of the marketing pack.

## 9. Implementation discipline

- Preserve the current dirty worktree and identify ownership before editing overlapping files.
- Treat this audit as evidence, not as proof that existing uncommitted implementations are correct. Read and test the current file before changing it.
- Update migrations and `supabase/manual_harness_merge.sql` together when schema changes.
- Keep the information architecture required by `AGENTS.md`: no Harness page; Strategy and Prompts remain one workspace; Files keeps exactly Library and Files.
- Follow `.agents/skills/spielos-ui/SKILL.md`, `docs/design-system.md`, `docs/interaction-design.md`, `docs/ui-quality-process.md` and `docs/ui-workbench.md` for every UI change.
- Put repeated visual decisions in `packages/design-system` first and verify dark, light and monochrome in the browser.
- Implement the smallest end-to-end slice, test it visually and operationally, then generalize. Do not batch dozens of unverified adapters or seeded workflows.
- Remove dead or superseded paths only after migration tests prove no active path uses them.
- Keep an audit matrix in each implementation change: claimed capability, adapter, auth, effect policy, artifact renderer, tests and known limits.

This sequence is intentionally strict: reliable auth and durable idempotent execution precede new write integrations; truthful integrations precede premium workflow claims; and premium workflows are accepted only through externally verifiable outcomes.
