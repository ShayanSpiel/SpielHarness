-- Phase 0 instrumentation: per-run pipeline metrics.
-- Captures the pre-provider overhead we are optimizing in Phases 1-4.

create table if not exists run_metrics (
  run_id uuid primary key references runs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null,
  status text not null,
  auth_ms double precision not null default 0,
  harness_resolution_ms double precision not null default 0,
  run_creation_ms double precision not null default 0,
  file_load_ms double precision not null default 0,
  file_parse_ms double precision not null default 0,
  compaction_ms double precision not null default 0,
  provider_ttft_ms double precision not null default 0,
  first_byte_to_client_ms double precision not null default 0,
  event_persist_ms double precision not null default 0,
  run_finalize_ms double precision not null default 0,
  total_ms double precision not null default 0,
  db_query_count integer not null default 0,
  db_total_ms double precision not null default 0,
  hidden_pre_stream_calls integer not null default 0,
  input_tokens_estimate integer not null default 0,
  system_prompt_tokens_estimate integer not null default 0,
  provider_name text,
  model_name text,
  created_at timestamptz not null default now()
);

create index if not exists run_metrics_org_idx on run_metrics (org_id, created_at desc);
