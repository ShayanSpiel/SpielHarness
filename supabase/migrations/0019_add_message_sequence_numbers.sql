-- Phase 3: message sequence numbers for deterministic ordering

alter table chat_messages add column if not exists sequence_number bigint;

do $$ begin
  if exists (
    select 1 from chat_messages where sequence_number is null limit 1
  ) then
    with numbered as (
      select id, chat_id, row_number() over (partition by chat_id order by created_at, id) as seq
      from chat_messages
      where sequence_number is null
    )
    update chat_messages m
    set sequence_number = n.seq
    from numbered n
    where m.id = n.id;
  end if;
end $$;

alter table chat_messages alter column sequence_number set not null;
create index if not exists chat_messages_chat_seq_idx on chat_messages (chat_id, sequence_number);
alter table chats add column if not exists next_message_sequence bigint not null default 0;

do $$ begin
  with max_seq as (
    select chat_id, coalesce(max(sequence_number), 0) as max_s
    from chat_messages
    group by chat_id
  )
  update chats c
  set next_message_sequence = m.max_s + 1
  from max_seq m
  where c.id = m.chat_id
    and c.next_message_sequence < m.max_s + 1;
end $$;
