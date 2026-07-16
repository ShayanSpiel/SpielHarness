-- SpielOS: Wipe existing data and reseed the demo org.
-- WARNING: This deletes ALL existing data.
--
-- This file is DATA ONLY. Schema lives in the numbered migrations under
-- packages/db/migrations (e.g. 0001_init.sql). Apply migrations with
-- `npm run db:migrate` first; this file is then run as part of
-- `npm run db:seed` and `npm run db:reset`.
--
-- Usage (manual):
--   1. npm run db:migrate
--   2. psql "$DATABASE_URL" -f packages/db/migrations/wipe_and_seed.sql
--   3. curl -X POST http://localhost:3000/api/harness/seed
-- Or in one step:
--   npm run db:reset

-- ── Step 1: Delete data (preserve schema) ────────────────────

delete from audit_log;
delete from usage_ledger;
delete from run_output_files;
delete from run_input_files;
delete from run_events;
delete from runs;
delete from chat_messages;
delete from chats;
delete from workspace_variables;
delete from connections;
delete from models;
delete from file_relations;
delete from file_versions;
delete from files;
delete from folders;
delete from org_memberships;
delete from profiles;
delete from orgs;
delete from billing_events;
delete from credit_transactions;
delete from org_credits;
delete from billing_providers;

-- ── Step 2: Seed demo org ─────────────────────────────────────

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Org', 'demo')
  on conflict (id) do nothing;

-- ── Step 3: Seed content files ────────────────────────────────
-- After running this SQL, call the seed API:
--   curl -X POST http://localhost:3000/api/harness/seed
--
-- This reads supabase/seed/ (agents, skills, workflows, templates, system)
-- and creates corresponding rows in the files table.
