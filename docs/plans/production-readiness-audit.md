# Production readiness audit — 2026-07-13

## Verdict

The harness/editor UI is buildable and the repaired chat/runtime path is suitable for continued product development. The application is **not ready for public multi-tenant production** until application authentication, durable background execution, and transactional credit enforcement are implemented.

This is a code-backed assessment of the current working tree. Claims in the older data-model and runtime docs that did not exist in the schema or code were removed.

## Repaired in this pass

### Chat and streaming

- Plain chat now reports model generation rather than presenting a workflow as “Running”.
- Token deltas are yielded directly instead of being buffered in arbitrary 60-character chunks.
- Node/skill/eval messages no longer contaminate the assistant’s answer; native events render as compact inline activity and as full history in the Events inspector.
- Active workflow events carry role identity. The latest assistant message switches to the active role name/avatar treatment while that role executes.
- The run inspector uses equal-width design-system `NavTabs` for Context, Events, and Outputs and contains no live/idle toggle badge.
- A single lifecycle state now drives chat, composer, active role, and inspector loading. Terminal events cannot be overwritten by a stale assistant-runtime boolean.
- Harness-free chat uses configured database models or the documented environment-backed Mistral fallback and receives workspace catalog awareness.
- Resumed human-input output is rendered immediately and persisted to chat history.
- The unused browser token route no longer returns a raw Google access token.

### Workflow/runtime correctness

- Fixed null `singleNode` crashes and added durable checkpoint yields.
- Fixed `/reply` reconstructing an object as the run type, which made persisted human-input runs unresumable.
- Human-input checkpoints are stored in `runs.state`; completed nodes are skipped after resume.
- Added truthful `run_started`, node, skill, tool, eval, terminal, and failure events.
- LangGraph custom events now stream at operation start/completion rather than arriving only with the completed node state.
- Added node completion events and explicit failure for unknown/MCP skill kinds instead of simulated success.
- Workflow roots are derived from edges. Fan-out and multi-input joins are represented in the LangGraph graph.
- Multi-skill nodes execute their active skills sequentially instead of silently executing only the first.
- Role-less skill nodes receive a runtime-only role; file-backed eval references become executable eval skills.
- File-backed eval ids resolve to their executable runtime skill ids, including terminal-gate retry routing.
- Workflow seed `prompt`, `x`, and `y` fields now survive parsing.
- Workflow and eval pages now send the actual `/api/runs/execute` request shape. They previously used removed `target`/`contextRefs` fields.
- Workflow chat targets and newly created workflow drafts now always execute with a persisted `workflowId`.
- Removed the second, non-streaming provider call that plain chat made after already streaming the answer.
- Safe read-only generic HTTP tools can execute configured operations. Private/link-local destinations are rejected to reduce SSRF exposure. External writes and MCP calls remain blocked until real adapters exist.
- Artifacts are persisted as canonical files and linked through `run_output_files`.
- Run snapshots now include resolved workflow, role, and skill definitions for deterministic resume.

### Data integrity

- Fixed cross-workspace chat-id upsert/update behavior in the database client.
- Added `0002_tenant_integrity.sql` with composite same-workspace foreign keys for folders, files, chats, runs, events, usage, and run file links.
- Fixed `createFile` ignoring its caller-supplied id.
- Fixed the harness relation refresh function: it previously updated only `updated_at`, which could not fire its `UPDATE OF metadata` trigger.
- Added a safe `search_path` to the security-definer relation refresh function.
- Production credential encryption now requires `CONNECTION_ENCRYPTION_KEY`.

### Build and UI verification

- Development and production builds now use separate Next.js output directories, preventing a running dev server from corrupting release builds.
- ESLint excludes both generated output directories.
- The chat empty state, design-system inspector tabs, and workflows editor were exercised in the in-app browser against the local application.

## Release blockers

### P0 — application identity and authorization

`apps/web/lib/server.ts` still resolves every request to the demo org and grants that org full write/admin access. `profiles` and `org_memberships` exist but are not consulted. The product must not be internet-exposed in this state.

Required implementation:

1. Add application sign-in with Google and server-managed sessions.
2. Resolve `profileId` from the authenticated session on every request.
3. Resolve the active organization only through `org_memberships`; never trust a plain `spielos.org` cookie as authority.
4. Enforce viewer/editor/admin/owner checks on both reads and writes.
5. Bind OAuth `state` to the authenticated user, intended organization, integration, and expiry.
6. Separate application Google sign-in from Google Workspace integration consent. They need separate callbacks/scopes and should normally use separate Google OAuth clients.
7. Add CSRF/origin checks, login and mutation rate limits, session revocation, and security audit events.

### P0 — durable execution

Runs execute inside the Next.js request that owns the SSE response. A browser disconnect, function timeout, deploy, or process crash can terminate work. Event rows are persisted only after pause/termination. The cancellation row does not signal another process.

Required topology:

- Transactionally enqueue a run after reserving credits.
- A worker claims it with a lease and heartbeat.
- Persist each event/checkpoint incrementally with an atomic sequence.
- Stream/replay events from durable storage by sequence/cursor.
- Renew leases, retry only retry-safe nodes, and recover abandoned runs.
- Deliver cancellation through shared durable state or pub/sub.
- Put external writes behind idempotency keys and confirmation records.

### P0 — billing and credits

`usage_ledger` is not a billing system. Counts are estimated from character length, provider-reported usage is not captured, cost is always zero, and usage is recorded after execution. There is no balance or concurrent reservation mechanism.

Minimum design:

- `billing_accounts` and provider customer ids per org.
- `plans`, `entitlements`, and versioned price catalog.
- Immutable signed `credit_ledger` entries with unique idempotency keys.
- `credit_reservations` with reserved/settled/released/expired states.
- `billing_webhook_events` with provider event id uniqueness and replay status.
- A transaction that locks the org balance, reserves worst-case credits, and enqueues the run atomically.
- Settlement from exact provider usage, with reconciliation and negative-balance policy.
- Organization and optional member budget limits enforced server-side.

### P0 — integration credential ownership

Google/Notion integration OAuth still mirrors access/refresh tokens into browser cookies. Those cookies are not a safe multi-user ownership model and are independent from `connections.config`.

Move connector credentials to encrypted, user/workspace-scoped server storage. Store token owner, scopes, expiry, refresh status, and revocation status. Never return provider access tokens to browser code. Better Auth’s own documentation notes that account tokens are not encrypted by default, so encryption must be explicit if app-auth accounts retain tokens.

## Auth/database decision

Use **one portable PostgreSQL database plus Better Auth with Google** for application sign-in. Do not create a second Postgres database, and do not make Supabase Auth the application identity authority if “one-click migration to any Postgres host” is a hard requirement.

Why:

- The application already uses a plain PostgreSQL schema and direct server-side SQL.
- Better Auth supports direct PostgreSQL, Google social sign-in, and generated SQL migrations: [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [OAuth](https://better-auth.com/docs/concepts/oauth).
- Keeping auth tables in the same database makes initial user/org/membership creation transactional and keeps backup/restore one unit.
- Supabase Auth stores operational state in a special `auth` schema owned by `supabase_auth_admin` and depends on the Auth service/JWT behavior, not only portable application tables: [Supabase Auth](https://supabase.com/docs/guides/auth), [schema ownership](https://supabase.com/docs/guides/platform/permissions).

Supabase remains a valid PostgreSQL host. This recommendation is about the auth control plane, not the database vendor.

Recommended identity mapping:

- Let Better Auth own `user`, `account`, `session`, and verification tables.
- Add a stable auth user reference to `profiles` (or make the profile id equal to the auth user id if the generated id type is locked down).
- Keep organization roles in `org_memberships`; do not overload auth provider/account roles.
- Use opaque, revocable database sessions in HttpOnly secure cookies.
- Keep Google Workspace connector grants separate from the Google account used to sign into SpielOS.

## P1 before general availability

- Add atomic event sequence allocation. `max(sequence)+1` can race with cancellation/resume writers.
- Add provider-native token/usage parsing and per-node usage attribution.
- Add request schema parsing with Zod at every API boundary; several routes still cast `request.json()`.
- Add structured logging with request/run/org correlation and secret redaction.
- Add metrics for queue latency, first-token latency, node duration, provider errors, retries, and credit reservation failures.
- Add size limits for prompts, file bodies, history, artifacts, and SSE frames.
- Add retention/deletion policies for chats, runs, events, files, audit logs, and connector credentials.
- Add backup/restore and migration rollback drills.
- Replace broad `catch` fallbacks in settings/domain loading with visible setup/error states.
- Add browser tests for chat, workflow fan-out/join, human resume, cancellation, and active-role transitions.
- Add database integration tests that run both migrations from an empty PostgreSQL 14+ database and validate tenant constraints.
- Review the 145 kB `/knowledge` and 65 kB `/workflows` route payloads; use dynamic imports/virtualization where profiling shows a real cost.

## Verification performed

- `npm run typecheck`
- `npm run lint`
- `npm test` — durable human-input resume, unsupported-skill failure, workflow fan-out/join, and terminal eval retry tests pass.
- `npm run check:colors --workspace @spielos/web`
- `npm run build` — production Next.js build completed successfully. The local machine used the SWC fallback because `@next/swc-darwin-arm64` was absent; CI should install the platform optional dependency and build from a clean lockfile install.
