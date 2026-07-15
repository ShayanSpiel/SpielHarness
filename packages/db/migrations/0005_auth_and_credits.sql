-- SpielOS: Auth, multi-org, credits, and billing abstraction.
-- BetterAuth tables are created by the BetterAuth CLI (npx auth@latest migrate).
-- This migration adds credit tracking and billing event logging.

-- ── Credits ────────────────────────────────────────────────────

create table if not exists org_credits (
  org_id uuid primary key references orgs(id) on delete cascade,
  balance bigint not null default 0,
  lifetime_used bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  amount bigint not null,
  reason text not null,
  run_id uuid references runs(id) on delete set null,
  provider text,
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_transactions_provider_event
  on credit_transactions(provider, provider_event_id)
  where provider is not null and provider_event_id is not null;

create index if not exists credit_transactions_org_idx
  on credit_transactions(org_id, created_at desc);

-- ── Billing events ─────────────────────────────────────────────

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists billing_events_org_idx
  on billing_events(org_id, created_at desc);

create index if not exists billing_events_unprocessed_idx
  on billing_events(created_at)
  where processed = false;

-- ── Usage ledger improvements ──────────────────────────────────

alter table usage_ledger add column if not exists
  actual_input_tokens bigint;

alter table usage_ledger add column if not exists
  actual_output_tokens bigint;

alter table usage_ledger add column if not exists
  cost_micros numeric;

-- ── Model pricing ──────────────────────────────────────────────

alter table models add column if not exists
  input_cost_per_1k_micros bigint default 0;

alter table models add column if not exists
  output_cost_per_1k_micros bigint default 0;

-- ── Billing provider seed (file-backed, not hardcoded) ─────────
-- Provider config lives in supabase/seed/billing-providers.json
-- This table stores runtime state for enabled providers.

create table if not exists billing_providers (
  id text primary key,
  name text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
