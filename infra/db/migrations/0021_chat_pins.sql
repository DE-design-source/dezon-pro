-- Chat: ghim tin nhắn trong hội thoại. Nhóm: trưởng / phó nhóm ghim / bỏ ghim; chat 1-1: cả hai bên. Tối đa 5 tin ghim
-- mỗi hội thoại (service kiểm dưới khoá dòng chat_conversations), chỉ tin của chính hội thoại, không ghim tin hệ thống.
-- Ghim -> tin hệ thống "X đã ghim một tin nhắn" + gói WebSocket pins.updated {conversation_id, pins} tới thành viên.
-- Code: module backend/internal/modules/chat (service_pin.go, SQL thô qua pgx); db-map.json: chat_ghim_tin (chat_pinned_messages).
-- Kiểm tra trước: bảng chat_messages / chat_conversations / chat_users đã có (0018), chưa có bảng chat_pinned_messages.
-- Quay lui: drop table chat_pinned_messages; delete from schema_migrations where version = '0021';
--   (tin hệ thống "đã ghim một tin nhắn" giữ nguyên trong chat_messages, chỉ là lịch sử)

do $$ begin
  if to_regclass('public.chat_messages') is null or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_users') is null then
    raise exception '0021: thiếu bảng chat_messages / chat_conversations / chat_users (chạy 0018 trước)';
  end if;
  if to_regclass('public.chat_pinned_messages') is not null then raise exception '0021: bảng chat_pinned_messages đã có'; end if;
end $$;

create table chat_pinned_messages (
  conversation_id  bigint      not null,
  message_id       bigint      not null,
  pinned_by        bigint      not null,
  pinned_at        timestamptz not null default now(),
  constraint pk_chat_pinned_messages primary key (conversation_id, message_id),
  constraint fk_chat_pinned_messages_conversation_id foreign key (conversation_id) references chat_conversations (id) on delete cascade,
  constraint fk_chat_pinned_messages_message_id foreign key (message_id) references chat_messages (id) on delete cascade,
  constraint fk_chat_pinned_messages_pinned_by foreign key (pinned_by) references chat_users (id) on delete restrict
);

-- Phục vụ: FK on delete cascade khi xoá tin (không quét cả bảng)
create index idx_chat_pinned_messages_message_id on chat_pinned_messages (message_id);

comment on table chat_pinned_messages is 'Messages pinned in a conversation (at most 5 per conversation, enforced by the service under the chat_conversations row lock). The message must belong to the same conversation and must not be a system message (checked by the service).';
comment on column chat_pinned_messages.conversation_id is 'Conversation (primary key part 1; list order = pinned_at desc).';
comment on column chat_pinned_messages.message_id is 'Pinned message of that conversation (primary key part 2).';
comment on column chat_pinned_messages.pinned_by is 'Member who pinned it (group: owner / admin; direct: either member).';
comment on column chat_pinned_messages.pinned_at is 'Time the message was pinned.';

-- Xác minh sau
do $$ begin
  if to_regclass('public.chat_pinned_messages') is null then raise exception '0021: thiếu bảng chat_pinned_messages'; end if;
  if not exists (select 1 from pg_constraint where conname = 'pk_chat_pinned_messages') then raise exception '0021: thiếu pk_chat_pinned_messages'; end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_chat_pinned_messages_message_id') then raise exception '0021: thiếu fk_chat_pinned_messages_message_id'; end if;
  if to_regclass('public.idx_chat_pinned_messages_message_id') is null then raise exception '0021: thiếu idx_chat_pinned_messages_message_id'; end if;
end $$;
