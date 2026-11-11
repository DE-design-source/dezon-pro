-- Chat: quản trị nhóm (backend/docs/API.md mục "Quản trị nhóm"): @nhắc tên, ảnh + mô tả nhóm, link mời (có hạn / cần duyệt),
-- hàng chờ duyệt vào nhóm, chuyển trưởng nhóm, giải tán nhóm, cài đặt quyền của nhóm.
-- - chat_conversations: description, avatar_media_id (ảnh chat_media của người đổi, phải ready + image - service kiểm),
--   3 cờ quyền is_admin_only_send / is_admin_only_info / is_admin_only_add, disbanded_at.
-- - chat_conversation_members.last_mention_seq: seq lớn nhất của tin nhắc tới thành viên (hoặc @Tất cả) -> dấu '@' chưa đọc.
-- - chat_messages.mentions: mảng {user_id, offset, length} (user_id 0 = @Tất cả) để hiển thị, đọc / ghi nguyên khối cùng tin.
-- - chat_group_invite_links: link mời, chỉ lưu sha256 của token; tối đa 1 link còn hiệu lực mỗi nhóm.
-- - chat_group_join_requests: yêu cầu vào nhóm qua link cần duyệt.
-- Code: module backend/internal/modules/chat (SQL thô qua pgx); db-map.json: chat_hoi_thoai / chat_thanh_vien / chat_tin_nhan
--   (cột mới), chat_link_moi (chat_group_invite_links), chat_yeu_cau_vao_nhom (chat_group_join_requests).
-- Cờ is_admin_only_info mặc định TRUE: giữ hành vi cũ (chỉ trưởng / phó nhóm đổi tên). Hai cờ còn lại mặc định FALSE (như cũ).
-- Kiểm tra trước: đã có chat_conversations / chat_conversation_members / chat_messages / chat_media (0018, 0020),
--   chưa có 2 bảng mới và chưa có các cột mới.
-- Quay lui (mất link mời, yêu cầu vào nhóm, mô tả / ảnh / cài đặt nhóm, dữ liệu @nhắc tên; nhóm đã giải tán thành nhóm thường
--   mà mọi thành viên đã rời):
--   drop table chat_group_join_requests; drop table chat_group_invite_links;
--   drop index idx_chat_conversations_avatar_media_id;
--   alter table chat_messages drop constraint ck_chat_messages_mentions, drop column mentions;
--   alter table chat_conversation_members drop constraint ck_chat_conversation_members_last_mention_seq, drop column last_mention_seq;
--   alter table chat_conversations drop constraint ck_chat_conversations_description, drop constraint ck_chat_conversations_avatar_media_id,
--     drop constraint ck_chat_conversations_disbanded_at, drop constraint fk_chat_conversations_avatar_media_id,
--     drop column description, drop column avatar_media_id, drop column is_admin_only_send, drop column is_admin_only_info,
--     drop column is_admin_only_add, drop column disbanded_at;
--   delete from schema_migrations where version = '0022';

do $$ begin
  if to_regclass('public.chat_conversations') is null or to_regclass('public.chat_conversation_members') is null
     or to_regclass('public.chat_messages') is null or to_regclass('public.chat_media') is null then
    raise exception '0022: thiếu bảng chat_conversations / chat_conversation_members / chat_messages / chat_media (chạy 0018, 0020 trước)';
  end if;
  if to_regclass('public.chat_group_invite_links') is not null or to_regclass('public.chat_group_join_requests') is not null then
    raise exception '0022: bảng chat_group_invite_links / chat_group_join_requests đã có';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and (
       (table_name = 'chat_conversations' and column_name in ('description', 'avatar_media_id', 'is_admin_only_send',
          'is_admin_only_info', 'is_admin_only_add', 'disbanded_at'))
       or (table_name = 'chat_conversation_members' and column_name = 'last_mention_seq')
       or (table_name = 'chat_messages' and column_name = 'mentions'))) then
    raise exception '0022: cột mới của chat_conversations / chat_conversation_members / chat_messages đã có';
  end if;
end $$;

-- ───────────── Thông tin + cài đặt nhóm ─────────────

alter table chat_conversations add column description text;
alter table chat_conversations add column avatar_media_id bigint;
alter table chat_conversations add column is_admin_only_send boolean not null default false;
alter table chat_conversations add column is_admin_only_info boolean not null default true;
alter table chat_conversations add column is_admin_only_add boolean not null default false;
alter table chat_conversations add column disbanded_at timestamptz;
-- restrict: janitor của chat_media phải bỏ qua tệp đang làm ảnh nhóm (service_media.go: janitorOnce)
alter table chat_conversations add constraint fk_chat_conversations_avatar_media_id
  foreign key (avatar_media_id) references chat_media (id) on delete restrict;
alter table chat_conversations add constraint ck_chat_conversations_description
  check (description is null or (conversation_type = 'group' and btrim(description) <> '' and char_length(description) <= 500));
alter table chat_conversations add constraint ck_chat_conversations_avatar_media_id
  check (avatar_media_id is null or conversation_type = 'group');
alter table chat_conversations add constraint ck_chat_conversations_disbanded_at
  check (disbanded_at is null or conversation_type = 'group');
-- Phục vụ: janitor không xoá tệp đang làm ảnh nhóm + quyền đọc ảnh nhóm (chat/service_media.go: janitorOnce, MediaGet)
create index idx_chat_conversations_avatar_media_id on chat_conversations (avatar_media_id) where avatar_media_id is not null;

comment on column chat_conversations.description is 'Group description, 1..500 characters (blank -> null); null = none / direct conversation.';
comment on column chat_conversations.avatar_media_id is 'Group avatar: a ready image chat_media uploaded by the member who set it (checked by the service); null = default avatar. Restrict: the media janitor skips rows referenced here.';
comment on column chat_conversations.is_admin_only_send is 'Group setting: true = only owner / admins may send messages (members still read and send receipts).';
comment on column chat_conversations.is_admin_only_info is 'Group setting: true = only owner / admins may change name / avatar / description (default true = MVP behaviour).';
comment on column chat_conversations.is_admin_only_add is 'Group setting: true = only owner / admins may add members and create invite links.';
comment on column chat_conversations.disbanded_at is 'Set once when the owner disbands the group; every member active at that moment gets left_at = disbanded_at (read-only history). Null = not disbanded.';

-- ───────────── @nhắc tên ─────────────

alter table chat_conversation_members add column last_mention_seq bigint not null default 0;
alter table chat_conversation_members add constraint ck_chat_conversation_members_last_mention_seq check (last_mention_seq >= 0);
comment on column chat_conversation_members.last_mention_seq is 'Derived: seq of the newest message of the conversation that mentions this member (explicitly or @all); 0 = none. Written only by the send path; unread mention = last_mention_seq > last_read_seq.';

alter table chat_messages add column mentions jsonb;
alter table chat_messages add constraint ck_chat_messages_mentions check (mentions is null or (
  jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) between 1 and 50
  and message_type in ('text', 'image', 'video', 'file')));
comment on column chat_messages.mentions is 'Mentions in content, read / written with the message as a whole: [{"user_id": <id, 0 = @all>, "offset": <UTF-16 index>, "length": <UTF-16 units>}] sorted by offset, non-overlapping, 1..50 items; null = none. Group messages only (checked by the service).';

-- ───────────── Link mời ─────────────

create table chat_group_invite_links (
  id                bigint      generated by default as identity,
  conversation_id   bigint      not null,
  token_hash        text        not null,
  created_by        bigint      not null,
  requires_approval boolean     not null default false,
  expires_at        timestamptz,
  revoked_at        timestamptz,
  use_count         integer     not null default 0,
  created_at        timestamptz not null default now(),
  constraint pk_chat_group_invite_links primary key (id),
  constraint fk_chat_group_invite_links_conversation_id foreign key (conversation_id) references chat_conversations (id) on delete cascade,
  constraint fk_chat_group_invite_links_created_by foreign key (created_by) references chat_users (id) on delete restrict,
  -- Phục vụ: tra link theo token (chat/service_invite.go: preview, join)
  constraint uq_chat_group_invite_links_token_hash unique (token_hash),
  constraint ck_chat_group_invite_links_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_chat_group_invite_links_expires_at check (expires_at is null or expires_at > created_at),
  constraint ck_chat_group_invite_links_use_count check (use_count >= 0)
);
-- Phục vụ: tối đa 1 link còn hiệu lực mỗi nhóm (tạo link mới thu hồi link cũ) + đọc link hiện hành (chat/service_invite.go)
create unique index uq_chat_group_invite_links_conversation_id on chat_group_invite_links (conversation_id) where revoked_at is null;

comment on table chat_group_invite_links is 'Invite links of groups. Only the SHA-256 of the random token is stored (the token is shown once, at creation). At most one non-revoked link per group.';
comment on column chat_group_invite_links.id is 'Primary key.';
comment on column chat_group_invite_links.conversation_id is 'Group the link joins (conversation_type = group, checked by the service).';
comment on column chat_group_invite_links.token_hash is 'Lowercase hex SHA-256 of the base64url token (32 random bytes); the token itself is never stored.';
comment on column chat_group_invite_links.created_by is 'Member who created the link.';
comment on column chat_group_invite_links.requires_approval is 'True = joining creates a pending chat_group_join_requests row that an owner / admin approves.';
comment on column chat_group_invite_links.expires_at is 'Link stops working after this time; null = never expires.';
comment on column chat_group_invite_links.revoked_at is 'Set when revoked (explicitly, by creating a new link, or when the group is disbanded); null = active.';
comment on column chat_group_invite_links.use_count is 'Derived: number of joins (direct joins + approved requests) made through this link. Shown to admins only.';
comment on column chat_group_invite_links.created_at is 'Creation time.';

-- ───────────── Yêu cầu vào nhóm ─────────────

create table chat_group_join_requests (
  id              bigint      generated by default as identity,
  conversation_id bigint      not null,
  user_id         bigint      not null,
  invite_link_id  bigint      not null,
  status          text        not null default 'pending',
  resolved_by     bigint,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint pk_chat_group_join_requests primary key (id),
  constraint fk_chat_group_join_requests_conversation_id foreign key (conversation_id) references chat_conversations (id) on delete cascade,
  constraint fk_chat_group_join_requests_user_id foreign key (user_id) references chat_users (id) on delete cascade,
  constraint fk_chat_group_join_requests_invite_link_id foreign key (invite_link_id) references chat_group_invite_links (id) on delete cascade,
  constraint fk_chat_group_join_requests_resolved_by foreign key (resolved_by) references chat_users (id) on delete restrict,
  constraint ck_chat_group_join_requests_status check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint ck_chat_group_join_requests_resolved_at check ((status = 'pending') = (resolved_at is null)),
  constraint ck_chat_group_join_requests_resolved_by check (resolved_by is null or status in ('approved', 'rejected'))
);
-- Phục vụ: tối đa 1 yêu cầu đang chờ mỗi (nhóm, người) + hàng chờ duyệt của nhóm + yêu cầu của tôi (chat/service_invite.go)
create unique index uq_chat_group_join_requests_conversation_id_user_id on chat_group_join_requests (conversation_id, user_id)
  where status = 'pending';

comment on table chat_group_join_requests is 'Requests to join a group through an invite link with requires_approval. One pending row per (group, user); resolved rows are kept as history.';
comment on column chat_group_join_requests.id is 'Primary key (request_id in the chat API).';
comment on column chat_group_join_requests.conversation_id is 'Group asked to join.';
comment on column chat_group_join_requests.user_id is 'Account asking to join.';
comment on column chat_group_join_requests.invite_link_id is 'Link used (pending requests stay valid after the link is revoked).';
comment on column chat_group_join_requests.status is 'pending / approved / rejected / cancelled (user was added another way, or the group was disbanded).';
comment on column chat_group_join_requests.resolved_by is 'Owner / admin who approved or rejected; null while pending or when cancelled by the system.';
comment on column chat_group_join_requests.resolved_at is 'Time the request left pending; null exactly while pending.';
comment on column chat_group_join_requests.created_at is 'Request time.';

-- Xác minh sau
do $$ begin
  if to_regclass('public.chat_group_invite_links') is null then raise exception '0022: thiếu bảng chat_group_invite_links'; end if;
  if to_regclass('public.chat_group_join_requests') is null then raise exception '0022: thiếu bảng chat_group_join_requests'; end if;
  if to_regclass('public.uq_chat_group_invite_links_conversation_id') is null then raise exception '0022: thiếu uq_chat_group_invite_links_conversation_id'; end if;
  if to_regclass('public.uq_chat_group_join_requests_conversation_id_user_id') is null then raise exception '0022: thiếu uq_chat_group_join_requests_conversation_id_user_id'; end if;
  if to_regclass('public.idx_chat_conversations_avatar_media_id') is null then raise exception '0022: thiếu idx_chat_conversations_avatar_media_id'; end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_chat_conversations_avatar_media_id') then raise exception '0022: thiếu fk_chat_conversations_avatar_media_id'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_messages_mentions') then raise exception '0022: thiếu ck_chat_messages_mentions'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_conversation_members_last_mention_seq') then raise exception '0022: thiếu ck_chat_conversation_members_last_mention_seq'; end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_chat_group_invite_links_token_hash') then raise exception '0022: thiếu uq_chat_group_invite_links_token_hash'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_conversations'
      and column_name in ('description', 'avatar_media_id', 'is_admin_only_send', 'is_admin_only_info', 'is_admin_only_add', 'disbanded_at')) <> 6 then
    raise exception '0022: thiếu cột mới của chat_conversations';
  end if;
end $$;
