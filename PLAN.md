# SpielOS Production Readiness Plan

This plan tracks the current architecture. Historical restoration work and removed UI behavior do not belong here; completed implementation details are recorded in `docs/production-readiness-audit.md`.

## Current baseline

- The harness is file-backed and executable definitions resolve from `files`.
- Plain chat works without a selected harness item and uses stored model configuration or the environment-backed Mistral fallback.
- Workflow execution uses saved LangGraph nodes and edges, including fan-out, joins, evaluation retry, human checkpoints, and file-backed roles/skills/evals.
- Durable statuses are `running`, `waiting_human`, `completed`, `failed`, and `cancelled`. Client `idle` is not persisted.
- Runtime events drive chat activity, active-role identity, composer state, and the Events inspector. Terminal states clear all loading UI.
- The run inspector uses equal-width Context, Events, and Outputs tabs. Its toggle contains no run-status indicator.

## P0: identity and tenant authorization

- Add Google application sign-in with server-managed, revocable sessions.
- Use one portable PostgreSQL database for auth tables and product data. Supabase may host it, but Supabase Auth must not be required for portability.
- Resolve the user and active organization from the authenticated session and `org_memberships` on every request.
- Enforce viewer/editor/admin/owner permissions server-side for every read and mutation.
- Separate application sign-in from Google Workspace connector consent.
- Add CSRF/origin protection, mutation and login rate limits, session revocation, and security audit events.

## P0: durable execution

- Enqueue runs transactionally and execute them in a worker with leases and heartbeats.
- Persist events and checkpoints incrementally with atomic sequence allocation.
- Support cursor replay/reconnect, abandoned-run recovery, and shared cancellation.
- Put side effects behind idempotency keys and explicit confirmation records.

## P0: billing and credits

- Add billing accounts, plans, entitlements, and a versioned price catalog.
- Reserve credits atomically before enqueueing work.
- Settle or release reservations from provider-reported usage.
- Make ledger and webhook processing idempotent and auditable.
- Enforce organization and optional member budgets on the server.

## P0: integration credentials

- Remove provider access and refresh tokens from browser cookies.
- Store encrypted credentials server-side with user/workspace ownership, scopes, expiry, refresh, and revocation state.
- Keep application-auth accounts separate from connector grants.

## P1: hardening and observability

- Parse every API request with shared schemas and enforce payload limits.
- Add structured request/run/org logs, metrics, secret redaction, and retention policies.
- Capture provider-native token usage and cost per node.
- Add database migration tests and browser tests for chat, graph branching/joining, human resume, cancellation, and active-role transitions.
- Profile large routes before adding dynamic imports or virtualization.

## Release gate

Do not expose the application publicly until every P0 section is implemented and verified. Passing typecheck, lint, tests, and a production build proves build health; it does not prove multi-tenant isolation, durable execution, or billing correctness.
