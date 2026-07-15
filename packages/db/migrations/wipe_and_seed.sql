-- SpielOS: Quick-wipe existing data and reseed the demo org.
-- WARNING: This deletes ALL existing data.
--
-- Prerequisite: Migrations must already be applied (run `npm run db:migrate` first).
--
-- Usage:
--   1. psql "$DATABASE_URL" -f packages/db/migrations/0001_init.sql   (first time only)
--   2. psql "$DATABASE_URL" -f packages/db/migrations/0002_*.sql ...  (apply all)
--   3. psql "$DATABASE_URL" -f packages/db/migrations/wipe_and_seed.sql
--   4. curl -X POST http://localhost:3000/api/harness/seed

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
