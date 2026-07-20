-- Phase J: Idempotent Tool Invocation
--
-- Journals tool invocations with dedup by logical_key + input_hash.
-- Repeating a completed invocation returns the prior result.
-- Concurrent duplicates are prevented by unique constraint.

create type invocation_status as enum ('running', 'completed', 'failed', 'rejected');

create table if not exists tool_invocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parent_run_id uuid not null references runs(id) on delete cascade,
  logical_key text not null,
  capability_id text not null,
  input_hash text not null,
  attempt int not null default 1,
  status invocation_status not null default 'running',
  result_ref text,
  external_receipt text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(org_id, logical_key, input_hash)
);
