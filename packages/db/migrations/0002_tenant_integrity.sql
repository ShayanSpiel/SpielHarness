-- Enforce same-workspace ownership across cross-table references.
-- NOT VALID keeps this deployable on existing databases while checking new writes.

create unique index if not exists folders_org_id_unique_idx on folders (org_id, id);
create unique index if not exists files_org_id_unique_idx on files (org_id, id);
create unique index if not exists chats_org_id_unique_idx on chats (org_id, id);
create unique index if not exists runs_org_id_unique_idx on runs (org_id, id);
create index if not exists org_memberships_profile_idx on org_memberships (profile_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'folders_parent_same_org_fk') then
    alter table folders add constraint folders_parent_same_org_fk foreign key (org_id, parent_id) references folders (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'files_folder_same_org_fk') then
    alter table files add constraint files_folder_same_org_fk foreign key (org_id, folder_id) references folders (org_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_versions_file_same_org_fk') then
    alter table file_versions add constraint file_versions_file_same_org_fk foreign key (org_id, file_id) references files (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_relations_source_same_org_fk') then
    alter table file_relations add constraint file_relations_source_same_org_fk foreign key (org_id, source_file_id) references files (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'file_relations_target_same_org_fk') then
    alter table file_relations add constraint file_relations_target_same_org_fk foreign key (org_id, target_file_id) references files (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_chat_same_org_fk') then
    alter table chat_messages add constraint chat_messages_chat_same_org_fk foreign key (org_id, chat_id) references chats (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runs_chat_same_org_fk') then
    alter table runs add constraint runs_chat_same_org_fk foreign key (org_id, chat_id) references chats (org_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'runs_workflow_same_org_fk') then
    alter table runs add constraint runs_workflow_same_org_fk foreign key (org_id, workflow_id) references files (org_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'run_events_run_same_org_fk') then
    alter table run_events add constraint run_events_run_same_org_fk foreign key (org_id, run_id) references runs (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'run_input_files_run_same_org_fk') then
    alter table run_input_files add constraint run_input_files_run_same_org_fk foreign key (org_id, run_id) references runs (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'run_input_files_file_same_org_fk') then
    alter table run_input_files add constraint run_input_files_file_same_org_fk foreign key (org_id, file_id) references files (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'run_output_files_run_same_org_fk') then
    alter table run_output_files add constraint run_output_files_run_same_org_fk foreign key (org_id, run_id) references runs (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'run_output_files_file_same_org_fk') then
    alter table run_output_files add constraint run_output_files_file_same_org_fk foreign key (org_id, file_id) references files (org_id, id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'usage_ledger_run_same_org_fk') then
    alter table usage_ledger add constraint usage_ledger_run_same_org_fk foreign key (org_id, run_id) references runs (org_id, id) on delete cascade not valid;
  end if;
end
$$;

-- Validate after repairing any legacy cross-workspace rows. NOT VALID foreign
-- keys already protect every new insert/update before validation.
