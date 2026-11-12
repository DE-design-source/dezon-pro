-- Chat: đăng nhập bằng tài khoản Dezon Pro (phiên QS) thay cho OTP - POST /api/v1/chat/auth/dezon (backend/CHAT.md mục 6.7,
-- backend/docs/API.md mục Chat). Mỗi tài khoản Dezon Pro (users.id) gắn đúng một tài khoản chat; tài khoản tạo theo cách này
-- không có số điện thoại / email (danh tính = qs_user_id). Đăng nhập OTP / QR giữ nguyên (app di động, tài khoản cũ).
-- - chat_users.qs_user_id: uuid của users, unique. KHÔNG khoá ngoại: xoá tài khoản Dezon Pro không bị chặn bởi chat, và tài
--   khoản chat (tin đã gửi) vẫn còn - không đăng nhập được nữa vì không còn phiên Dezon Pro nào trỏ tới.
-- - ck_chat_users_phone_email: nới thành "có ít nhất một trong số điện thoại / email / qs_user_id".
-- - ck_chat_devices_login_method: thêm 'dezon'.
-- Code: module backend/internal/modules/chat (service_dezon.go, SQL thô qua pgx); db-map.json: chat_nguoi_dung.qs_user_id.
-- Kiểm tra trước: đã có chat_users / chat_devices (0018, 0019, 0023), chưa có cột qs_user_id.
-- Quay lui (chỉ khi chấp nhận xoá các tài khoản chat chỉ có qs_user_id, kéo theo thiết bị / bạn bè / thành viên nhóm của họ):
--   delete from chat_devices where login_method = 'dezon';
--   delete from chat_users where phone is null and email is null;   (tin / tệp của họ có thể chặn xoá - dọn trước)
--   alter table chat_devices drop constraint ck_chat_devices_login_method,
--     add constraint ck_chat_devices_login_method check (login_method in ('otp', 'qr'));
--   alter table chat_users drop constraint ck_chat_users_phone_email,
--     add constraint ck_chat_users_phone_email check (phone is not null or email is not null);
--   alter table chat_users drop constraint uq_chat_users_qs_user_id, drop column qs_user_id;
--   delete from schema_migrations where version = '0045';

do $$ begin
  if to_regclass('public.chat_users') is null or to_regclass('public.chat_devices') is null or to_regclass('public.users') is null then
    raise exception '0045: thiếu bảng chat_users / chat_devices / users (chạy 0018, 0023 trước)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_devices' and column_name = 'login_method') then
    raise exception '0045: thiếu chat_devices.login_method (chạy 0023 trước)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_users' and column_name = 'qs_user_id') then
    raise exception '0045: cột chat_users.qs_user_id đã có';
  end if;
end $$;

-- ───────────── Tài khoản chat gắn tài khoản Dezon Pro ─────────────

alter table chat_users add column qs_user_id uuid;
alter table chat_users add constraint uq_chat_users_qs_user_id unique (qs_user_id);
alter table chat_users drop constraint ck_chat_users_phone_email;
alter table chat_users add constraint ck_chat_users_phone_email check (phone is not null or email is not null or qs_user_id is not null);

comment on table chat_users is 'Chat account (identity = phone number, email or linked Dezon Pro account). Separate from QS users and not tenant-scoped: one account across all companies.';
comment on column chat_users.qs_user_id is 'users.id of the Dezon Pro account this chat account signs in with (POST /chat/auth/dezon); unique. Null = OTP / QR account. No FK: deleting the Dezon Pro user keeps the chat history.';
comment on column chat_users.created_at is 'Account creation time (first successful OTP verification by SMS / email, or first Dezon Pro sign-in).';

-- ───────────── Thiết bị: cách đăng nhập 'dezon' ─────────────

alter table chat_devices drop constraint ck_chat_devices_login_method;
alter table chat_devices add constraint ck_chat_devices_login_method check (login_method in ('otp', 'qr', 'dezon'));

comment on column chat_devices.login_method is 'otp = SMS / email code; qr = approved by another signed-in device (chat_qr_login_sessions); dezon = exchanged a Dezon Pro session (POST /chat/auth/dezon).';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_chat_users_qs_user_id') then raise exception '0045: thiếu uq_chat_users_qs_user_id'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_users_phone_email') then raise exception '0045: thiếu ck_chat_users_phone_email'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_devices_login_method') then raise exception '0045: thiếu ck_chat_devices_login_method'; end if;
end $$;
