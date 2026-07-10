-- SpielOS harness schema
-- File-first: everything is a file row. Harness files are user-customizable.
-- No hardcoded agents, evals, skills, prompts, templates, or strategy.

-- Harness-specific file_type values already exist in 0001:
--   strategy, prompt, artifact, draft, evidence, asset, eval_report, publish_package, knowledge

-- Add file_kind for categorizing harness roles
alter type file_type add value if not exists 'harness_role';
alter type file_type add value if not exists 'harness_skill';
alter type file_type add value if not exists 'harness_workstream';
alter type file_type add value if not exists 'harness_eval';
alter type file_type add value if not exists 'harness_template';
alter type file_type add value if not exists 'harness_chat_message';

-- Ensure content_format has markdown
alter table files alter column content_format set default 'markdown';

-- Create a simpler view for the harness file set
create view harness_files as
select
  f.id,
  f.org_id,
  f.folder_id,
  f.file_type,
  f.status,
  f.title,
  f.body,
  f.metadata,
  f.created_at,
  f.updated_at
from files f
where f.file_type in (
  'knowledge', 'strategy', 'prompt', 'artifact', 'draft',
  'evidence', 'asset', 'eval_report', 'publish_package',
  'harness_role', 'harness_eval', 'harness_skill',
  'harness_workstream', 'harness_template', 'harness_chat_message'
);

-- Add a function to ensure demo org has a default set of folders
create or replace function ensure_demo_folders()
returns void
language plpgsql
as $$
declare
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  insert into folders (id, org_id, name, sort_order)
  values
    (gen_random_uuid(), v_org_id, 'Agents', 10),
    (gen_random_uuid(), v_org_id, 'Skills', 20),
    (gen_random_uuid(), v_org_id, 'Evals', 30),
    (gen_random_uuid(), v_org_id, 'Templates', 40),
    (gen_random_uuid(), v_org_id, 'Brand', 50),
    (gen_random_uuid(), v_org_id, 'Audience', 60),
    (gen_random_uuid(), v_org_id, 'Offer', 70),
    (gen_random_uuid(), v_org_id, 'Voice', 80),
    (gen_random_uuid(), v_org_id, 'Positioning', 90),
    (gen_random_uuid(), v_org_id, 'System', 100),
    (gen_random_uuid(), v_org_id, 'Commands', 110)
  on conflict (id) do nothing;
end;
$$;
