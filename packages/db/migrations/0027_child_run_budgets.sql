-- Phase I: Durable Child Budgets
--
-- Tracks child-run counters in the database so they survive
-- process restart, retry, and concurrent execution.

create table if not exists child_run_budgets (
  parent_run_id uuid not null references runs(id) on delete cascade,
  capability_call_count int not null default 0,
  child_run_count int not null default 0,
  active_child_runs int not null default 0,
  child_input_tokens int not null default 0,
  tool_calls_count int not null default 0,
  primary key (parent_run_id)
);
