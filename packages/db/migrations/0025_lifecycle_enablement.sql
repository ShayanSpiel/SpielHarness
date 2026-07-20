-- Phase E: Separate lifecycle from enablement
--
-- Splits status (which conflated lifecycle + enablement) into:
--   lifecycle: 'draft' | 'published' | 'archived'
--   enabled: boolean
--   validation_diagnostics: jsonb

alter table files add column if not exists lifecycle varchar not null default 'published';
alter table files add column if not exists enabled boolean not null default true;
alter table files add column if not exists validation_diagnostics jsonb not null default '[]'::jsonb;

-- Backfill existing statuses
update files set lifecycle = 'published', enabled = true where status = 'active';
update files set lifecycle = 'draft', enabled = false where status = 'draft';
update files set lifecycle = 'archived', enabled = false where status = 'archived';
update files set lifecycle = 'archived', enabled = false where status = 'deleted';
