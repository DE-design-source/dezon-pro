-- Chat giai đoạn 2 (backend/CHAT.md mục 1, phần còn lại sau tệp đính kèm 0020; hợp đồng: backend/docs/API.md mục
-- "Giai đoạn 2: trả lời, chuyển tiếp, thu hồi, sửa, reaction, tìm kiếm, đa thiết bị"):
-- - chat_messages: trả lời (reply_to_message_id), chuyển tiếp (is_forwarded), sửa (edited_at), thu hồi (recalled_at / recalled_by:
--   nội dung, @nhắc tên, tệp, tên tệp bị XOÁ khỏi dòng - thu hồi là xoá thật theo ý người gửi, không chỉ ẩn), updated_at (lần đổi
--   cuối sau khi gửi: sửa / thu hồi / reaction - nguồn của GET .../messages/changes).
-- - chat_message_reactions: mỗi người tối đa 1 reaction / tin, bộ cố định like / love / haha / wow / sad / angry.
-- - Tìm tin: hàm IMMUTABLE chat_search_fold (bỏ dấu tiếng Việt, chữ thường, chỉ giữ chữ / số) + index GIN full-text cấu hình
--   'simple' trên nội dung + tên tệp. KHÔNG dùng extension (unaccent / pg_trgm) để chạy được trên mọi PostgreSQL >= 12 mà không cần
--   quyền superuser; bản Go phải dựng truy vấn bằng ĐÚNG biểu thức của index (hằng searchDocSQL trong chat/dto_phase2.go).
-- - chat_devices: user_agent, last_ip, login_method (danh sách thiết bị + đăng xuất từ xa).
-- - chat_qr_login_sessions: đăng nhập web / desktop bằng mã QR (CHAT.md mục 11 bước 3), sống 2 phút, dùng một lần.
-- Code: module backend/internal/modules/chat (SQL thô qua pgx); db-map.json: chat_tin_nhan / chat_thiet_bi (cột mới),
--   chat_reaction (chat_message_reactions), chat_dang_nhap_qr (chat_qr_login_sessions).
-- Kiểm tra trước: đã có chat_messages / chat_devices / chat_users (0018, 0020, 0022), chưa có 2 bảng mới, hàm mới và các cột mới.
-- Quay lui (mất reaction, phiên QR, dấu sửa / thu hồi / chuyển tiếp / trả lời; tin đã thu hồi KHÔNG lấy lại được nội dung - phải
--   xoá các dòng đó trước khi khôi phục ràng buộc cũ):
--   drop table chat_qr_login_sessions; drop table chat_message_reactions;
--   drop index idx_chat_messages_content_file_name; drop function chat_search_fold(text);
--   alter table chat_devices drop constraint ck_chat_devices_user_agent, drop constraint ck_chat_devices_last_ip,
--     drop constraint ck_chat_devices_login_method, drop column user_agent, drop column last_ip, drop column login_method;
--   delete from chat_pinned_messages where message_id in (select id from chat_messages where recalled_at is not null);
--   delete from chat_messages where recalled_at is not null;   (chỉ khi chấp nhận mất các tin đã thu hồi; seq sẽ hở)
--   alter table chat_messages drop constraint ck_chat_messages_recalled, drop constraint ck_chat_messages_edited_at,
--     drop constraint ck_chat_messages_is_forwarded, drop constraint ck_chat_messages_reply_to_message_id,
--     drop constraint fk_chat_messages_reply_to_message_id, drop constraint fk_chat_messages_recalled_by,
--     drop constraint ck_chat_messages_content, drop constraint ck_chat_messages_media_id,
--     drop column reply_to_message_id, drop column is_forwarded, drop column edited_at, drop column recalled_at,
--     drop column recalled_by, drop column updated_at;   (index idx_chat_messages_reply_to_message_id,
--     idx_chat_messages_conversation_id_updated_at đi theo cột)
--   alter table chat_messages add constraint ck_chat_messages_content check (char_length(content) <= 4000 and case
--       when message_type in ('text', 'system') then btrim(content) <> '' when message_type = 'voice' then content = '' else true end),
--     add constraint ck_chat_messages_media_id check ((message_type in ('image', 'video', 'file', 'voice')) = (media_id is not null));
--   delete from schema_migrations where version = '0023';

do $$ begin
  if to_regclass('public.chat_messages') is null or to_regclass('public.chat_devices') is null
     or to_regclass('public.chat_users') is null or to_regclass('public.chat_media') is null then
    raise exception '0023: thiếu bảng chat_messages / chat_devices / chat_users / chat_media (chạy 0018, 0020 trước)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'mentions') then
    raise exception '0023: thiếu cột chat_messages.mentions (chạy 0022 trước)';
  end if;
  if to_regclass('public.chat_message_reactions') is not null or to_regclass('public.chat_qr_login_sessions') is not null then
    raise exception '0023: bảng chat_message_reactions / chat_qr_login_sessions đã có';
  end if;
  if to_regprocedure('public.chat_search_fold(text)') is not null then raise exception '0023: hàm chat_search_fold đã có'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and (
       (table_name = 'chat_messages' and column_name in ('reply_to_message_id', 'is_forwarded', 'edited_at', 'recalled_at',
          'recalled_by', 'updated_at'))
       or (table_name = 'chat_devices' and column_name in ('user_agent', 'last_ip', 'login_method')))) then
    raise exception '0023: cột mới của chat_messages / chat_devices đã có';
  end if;
end $$;

-- ───────────── Tin nhắn: trả lời, chuyển tiếp, sửa, thu hồi ─────────────

alter table chat_messages add column reply_to_message_id bigint;
alter table chat_messages add column is_forwarded boolean not null default false;
alter table chat_messages add column edited_at timestamptz;
alter table chat_messages add column recalled_at timestamptz;
alter table chat_messages add column recalled_by bigint;
alter table chat_messages add column updated_at timestamptz;

-- set null: tin được trả lời chỉ mất khi cả hội thoại bị xoá (cascade) - tin trả lời cũng đi theo, không có dòng mồ côi
alter table chat_messages add constraint fk_chat_messages_reply_to_message_id
  foreign key (reply_to_message_id) references chat_messages (id) on delete set null;
-- restrict: tài khoản chat không bị xoá (như pinned_by / resolved_by)
alter table chat_messages add constraint fk_chat_messages_recalled_by
  foreign key (recalled_by) references chat_users (id) on delete restrict;
-- cùng hội thoại + tin được trả lời không phải tin hệ thống: service kiểm (chat/service_message.go: SendMessage)
alter table chat_messages add constraint ck_chat_messages_reply_to_message_id
  check (reply_to_message_id is null or (reply_to_message_id <> id and message_type <> 'system'));
alter table chat_messages add constraint ck_chat_messages_is_forwarded check (not is_forwarded or message_type <> 'system');
-- chỉ tin văn bản sửa được (chú thích của ảnh / video / tệp không sửa)
alter table chat_messages add constraint ck_chat_messages_edited_at check (edited_at is null or message_type = 'text');
-- tin đã thu hồi: không còn nội dung, @nhắc tên, tệp, tên tệp; tin hệ thống không thu hồi được
alter table chat_messages add constraint ck_chat_messages_recalled check ((recalled_at is null) = (recalled_by is null)
  and (recalled_at is null or (message_type <> 'system' and content = '' and media_id is null and file_name is null and mentions is null)));
alter table chat_messages drop constraint ck_chat_messages_content;
alter table chat_messages add constraint ck_chat_messages_content check (char_length(content) <= 4000 and case
  when recalled_at is not null then content = ''
  when message_type in ('text', 'system') then btrim(content) <> ''
  when message_type = 'voice' then content = ''
  else true end);
alter table chat_messages drop constraint ck_chat_messages_media_id;
alter table chat_messages add constraint ck_chat_messages_media_id check (case
  when recalled_at is not null then media_id is null
  else (message_type in ('image', 'video', 'file', 'voice')) = (media_id is not null) end);

-- Phục vụ: FK on delete set null khi xoá tin (cascade xoá hội thoại) không quét cả bảng
create index idx_chat_messages_reply_to_message_id on chat_messages (reply_to_message_id) where reply_to_message_id is not null;
-- Phục vụ: tin đã đổi (sửa / thu hồi / reaction) của một hội thoại sau một mốc (chat/service_msgactions.go: MessageChanges)
create index idx_chat_messages_conversation_id_updated_at on chat_messages (conversation_id, updated_at, id) where updated_at is not null;

comment on column chat_messages.message_type is 'text / system / image / video / file / voice (system: group created, members added / removed / left, renamed, role changed, pinned...). Kept after recall.';
comment on column chat_messages.content is 'text/system: 1..4000 characters, not blank. image/video/file: optional caption 0..4000. voice: empty. Recalled: empty.';
comment on column chat_messages.media_id is 'Attachment (chat_media) of an image / video / file / voice message; null for text / system and after recall. A forwarded message reuses the media_id of the source message.';
comment on column chat_messages.file_name is 'Type file only: display / download name for this message (a dedup hit reuses the object but keeps the new name). Null after recall.';
comment on column chat_messages.mentions is 'Mentions in content, read / written with the message as a whole: [{"user_id": <id, 0 = @all>, "offset": <UTF-16 index>, "length": <UTF-16 units>}] sorted by offset, non-overlapping, 1..50 items; null = none / recalled. Group messages only (checked by the service); re-validated on edit.';
comment on column chat_messages.reply_to_message_id is 'Message this one replies to: same conversation, not a system message (checked by the service); null = not a reply. The quoted preview is built at read time (recalled target -> "recalled").';
comment on column chat_messages.is_forwarded is 'True = created by forwarding another message (content / media copied, mentions and reply dropped); shown as "Đã chuyển tiếp". The source is not recorded.';
comment on column chat_messages.edited_at is 'Last edit time (text messages only, by the sender within 24 h); null = never edited.';
comment on column chat_messages.recalled_at is 'Recall time; content, mentions, media_id, file_name are wiped in the same statement. Null = not recalled. Set together with recalled_by.';
comment on column chat_messages.recalled_by is 'Who recalled: the sender, or the group owner / admin moderating; null = not recalled.';
comment on column chat_messages.updated_at is 'Derived: time of the last change after sending (edit, recall, reaction set / removed); null = never changed. Drives GET /conversations/:id/messages/changes.';

-- ───────────── Reaction ─────────────

create table chat_message_reactions (
  message_id bigint      not null,
  user_id    bigint      not null,
  reaction   text        not null,
  created_at timestamptz not null default now(),
  constraint pk_chat_message_reactions primary key (message_id, user_id),
  constraint fk_chat_message_reactions_message_id foreign key (message_id) references chat_messages (id) on delete cascade,
  constraint fk_chat_message_reactions_user_id foreign key (user_id) references chat_users (id) on delete cascade,
  constraint ck_chat_message_reactions_reaction check (reaction in ('like', 'love', 'haha', 'wow', 'sad', 'angry'))
);
-- Phục vụ: FK on delete cascade khi xoá tài khoản chat (không quét cả bảng)
create index idx_chat_message_reactions_user_id on chat_message_reactions (user_id);

comment on table chat_message_reactions is 'Emoji reactions on messages: at most one per (message, user); setting another reaction replaces it. Not allowed on system / recalled messages (checked by the service; recall deletes the rows).';
comment on column chat_message_reactions.message_id is 'Message reacted to (primary key part 1).';
comment on column chat_message_reactions.user_id is 'Member who reacted (primary key part 2); must be an active member of the conversation when reacting.';
comment on column chat_message_reactions.reaction is 'like / love / haha / wow / sad / angry (client shows 👍 ❤️ 😆 😮 😢 😡).';
comment on column chat_message_reactions.created_at is 'Time the current reaction was set (reset when replaced).';

-- ───────────── Tìm tin nhắn ─────────────

-- Bỏ dấu tiếng Việt cho tìm kiếm: chữ thường -> bỏ dấu tổ hợp (U+0300..U+036F, khi client gửi dạng NFD) -> đổi chữ có dấu dựng sẵn
-- (NFC) về chữ không dấu, đ -> d -> mọi ký tự không phải chữ / số thành 1 khoảng trắng. Bản Go cùng luật: chat/service_search.go foldVN
-- (test đối chiếu). IMMUTABLE để dùng được trong index; chỉ gọi hàm IMMUTABLE (lower, regexp_replace, translate).
create function chat_search_fold(t text) returns text language sql immutable strict parallel safe as $fn$
  select btrim(regexp_replace(translate(regexp_replace(lower(t), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
    'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ',
    'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'),
    '[^[:alnum:]]+', ' ', 'g'))
$fn$;
comment on function chat_search_fold(text) is 'Search normalization for chat messages: lowercase, strip Vietnamese diacritics (NFD combining marks and precomposed letters, đ -> d), every run of non letter / digit characters -> one space, trimmed. IMMUTABLE so it can back idx_chat_messages_content_file_name; mirrored by foldVN in Go.';

-- Phục vụ: tìm tin trong một hội thoại / mọi hội thoại của tôi (chat/service_search.go: SearchMessages). Truy vấn PHẢI dùng đúng
-- biểu thức + điều kiện này thì planner mới chọn index.
create index idx_chat_messages_content_file_name on chat_messages
  using gin (to_tsvector('simple'::regconfig, chat_search_fold(content || ' ' || coalesce(file_name, ''))))
  where message_type <> 'system' and recalled_at is null;

-- ───────────── Thiết bị ─────────────

alter table chat_devices add column user_agent text not null default '';
alter table chat_devices add column last_ip text not null default '';
alter table chat_devices add column login_method text not null default 'otp';
alter table chat_devices add constraint ck_chat_devices_user_agent check (char_length(user_agent) <= 500);
alter table chat_devices add constraint ck_chat_devices_last_ip check (char_length(last_ip) <= 64);
alter table chat_devices add constraint ck_chat_devices_login_method check (login_method in ('otp', 'qr'));

comment on column chat_devices.user_agent is 'User-Agent header at login (truncated to 500 characters); empty when unknown / logged in before 0023. Shown in the device list.';
comment on column chat_devices.last_ip is 'Client IP at login (OTP / QR) or at the latest token refresh; empty when unknown. Shown in the device list.';
comment on column chat_devices.login_method is 'otp = SMS / email code; qr = approved by another signed-in device (chat_qr_login_sessions).';

-- ───────────── Đăng nhập bằng QR ─────────────

create table chat_qr_login_sessions (
  id              bigint      generated by default as identity,
  code_hash       text        not null,
  poll_token_hash text        not null,
  platform        text        not null,
  device_name     text        not null default '',
  user_agent      text        not null default '',
  request_ip      text        not null default '',
  status          text        not null default 'pending',
  user_id         bigint,
  scanned_at      timestamptz,
  resolved_at     timestamptz,
  consumed_at     timestamptz,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint pk_chat_qr_login_sessions primary key (id),
  constraint fk_chat_qr_login_sessions_user_id foreign key (user_id) references chat_users (id) on delete cascade,
  -- Phục vụ: tra phiên theo mã người dùng quét / gõ (chat/service_qrlogin.go: QRScan, QRApprove, QRReject)
  constraint uq_chat_qr_login_sessions_code_hash unique (code_hash),
  constraint ck_chat_qr_login_sessions_code_hash check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_chat_qr_login_sessions_poll_token_hash check (poll_token_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_chat_qr_login_sessions_platform check (platform in ('ios', 'android', 'web', 'desktop')),
  constraint ck_chat_qr_login_sessions_device_name check (char_length(device_name) <= 200),
  constraint ck_chat_qr_login_sessions_user_agent check (char_length(user_agent) <= 500),
  constraint ck_chat_qr_login_sessions_request_ip check (char_length(request_ip) <= 64),
  constraint ck_chat_qr_login_sessions_status check (status in ('pending', 'scanned', 'approved', 'rejected', 'consumed')),
  constraint ck_chat_qr_login_sessions_user_id check ((status = 'pending') = (user_id is null)),
  constraint ck_chat_qr_login_sessions_scanned_at check ((status = 'pending') = (scanned_at is null)),
  constraint ck_chat_qr_login_sessions_resolved_at check ((status in ('approved', 'rejected', 'consumed')) = (resolved_at is not null)),
  constraint ck_chat_qr_login_sessions_consumed_at check ((status = 'consumed') = (consumed_at is not null)),
  constraint ck_chat_qr_login_sessions_expires_at check (expires_at > created_at)
);
-- Phục vụ: giới hạn số phiên QR tạo theo IP trong 10 phút (chat/service_qrlogin.go: QRStart)
create index idx_chat_qr_login_sessions_request_ip_created_at on chat_qr_login_sessions (request_ip, created_at desc);

comment on table chat_qr_login_sessions is 'QR login of a web / desktop device (CHAT.md section 11 step 3): the new device shows a short code (in a QR), a signed-in device scans it, sees the new device info and approves; the new device then polls with its secret poll token and receives tokens once. Lives 2 minutes (+60 s after approval); rows older than 24 h are deleted on the next start.';
comment on column chat_qr_login_sessions.id is 'Primary key (qr_id in the chat API).';
comment on column chat_qr_login_sessions.code_hash is 'Lowercase hex HMAC-SHA256(server key, normalized 10-character code); the code itself (shown in the QR / typed) is never stored.';
comment on column chat_qr_login_sessions.poll_token_hash is 'Lowercase hex SHA-256 of the 32-byte poll token kept only by the waiting device (never in the QR); required to read the result.';
comment on column chat_qr_login_sessions.platform is 'Platform of the waiting device: ios / android / web / desktop (copied to chat_devices on success).';
comment on column chat_qr_login_sessions.device_name is 'Label sent by the waiting device (browser / OS), at most 200 characters; shown on the confirm screen.';
comment on column chat_qr_login_sessions.user_agent is 'User-Agent header of the start request (truncated to 500 characters); shown on the confirm screen.';
comment on column chat_qr_login_sessions.request_ip is 'Client IP of the start request (rate limit per IP + shown on the confirm screen); empty when unknown.';
comment on column chat_qr_login_sessions.status is 'pending (shown) -> scanned (a user opened the confirm screen) -> approved / rejected -> consumed (tokens handed to the waiting device). Expiry is expires_at, not a status.';
comment on column chat_qr_login_sessions.user_id is 'Account that scanned (and approves / rejects); the new device logs into this account. Null exactly while pending.';
comment on column chat_qr_login_sessions.scanned_at is 'Time the code was scanned / typed; null exactly while pending.';
comment on column chat_qr_login_sessions.resolved_at is 'Time it was approved or rejected; null while pending / scanned.';
comment on column chat_qr_login_sessions.consumed_at is 'Time the waiting device received its tokens (chat_devices row created with login_method = qr); null until then.';
comment on column chat_qr_login_sessions.expires_at is 'created_at + 2 minutes; approval extends it to at least approval time + 60 seconds so the waiting device can claim.';
comment on column chat_qr_login_sessions.created_at is 'Start time.';

-- Xác minh sau
do $$ begin
  if to_regclass('public.chat_message_reactions') is null then raise exception '0023: thiếu bảng chat_message_reactions'; end if;
  if to_regclass('public.chat_qr_login_sessions') is null then raise exception '0023: thiếu bảng chat_qr_login_sessions'; end if;
  if to_regprocedure('public.chat_search_fold(text)') is null then raise exception '0023: thiếu hàm chat_search_fold'; end if;
  if chat_search_fold('Đường  Ấp-Bắc, NGUYỄN') <> 'duong ap bac nguyen' then raise exception '0023: chat_search_fold sai (NFC)'; end if;
  if chat_search_fold(U&'Vie\0323\0302t Nam') <> 'viet nam' then raise exception '0023: chat_search_fold sai (NFD)'; end if;
  if to_regclass('public.idx_chat_messages_content_file_name') is null then raise exception '0023: thiếu idx_chat_messages_content_file_name'; end if;
  if to_regclass('public.idx_chat_messages_conversation_id_updated_at') is null then raise exception '0023: thiếu idx_chat_messages_conversation_id_updated_at'; end if;
  if to_regclass('public.idx_chat_messages_reply_to_message_id') is null then raise exception '0023: thiếu idx_chat_messages_reply_to_message_id'; end if;
  if to_regclass('public.idx_chat_qr_login_sessions_request_ip_created_at') is null then raise exception '0023: thiếu idx_chat_qr_login_sessions_request_ip_created_at'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_messages_recalled') then raise exception '0023: thiếu ck_chat_messages_recalled'; end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_chat_messages_reply_to_message_id') then raise exception '0023: thiếu fk_chat_messages_reply_to_message_id'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_message_reactions_reaction') then raise exception '0023: thiếu ck_chat_message_reactions_reaction'; end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_chat_qr_login_sessions_code_hash') then raise exception '0023: thiếu uq_chat_qr_login_sessions_code_hash'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chat_devices'
      and column_name in ('user_agent', 'last_ip', 'login_method')) <> 3 then
    raise exception '0023: thiếu cột mới của chat_devices';
  end if;
end $$;
