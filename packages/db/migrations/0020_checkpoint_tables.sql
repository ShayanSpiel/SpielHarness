-- LangGraph PostgresSaver checkpoint tables for the Director runtime.
-- Created via migration instead of at request time (checkpointer.setup()).
-- See packages/graph/src/director/checkpointer.ts for the adapter that uses these.

-- Checkpoints: one row per persisted state snapshot.
-- Writes are sequenced by checkpoint_version for optimistic concurrency.
create table if not exists langgraph_checkpoints (
  thread_id text not null,
  checkpoint_ns text not null default '',
  parent_checkpoint_id text,
  checkpoint text not null,
  metadata text not null default '{}',
  checkpoint_id text not null,
  checkpoint_version int not null default 1,
  created_at timestamptz not null default now(),
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

-- Checkpoint blobs: large serializable values referenced by checkpoints.
create table if not exists langgraph_checkpoint_blobs (
  thread_id text not null,
  checkpoint_ns text not null default '',
  channel text not null,
  version text not null,
  type text,
  blob bytea,
  primary key (thread_id, checkpoint_ns, channel, version)
);

-- Writes: pending writes that haven't been applied to a checkpoint yet.
create table if not exists langgraph_checkpoint_writes (
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  task_id text not null,
  idx int not null,
  channel text not null,
  type text,
  value bytea,
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

create index if not exists langgraph_checkpoints_idx
  on langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id);

create index if not exists langgraph_checkpoint_blobs_idx
  on langgraph_checkpoint_blobs (thread_id, checkpoint_ns, channel);

create index if not exists langgraph_checkpoint_writes_idx
  on langgraph_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);
