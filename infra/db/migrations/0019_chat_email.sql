-- Chat: đăng nhập / tìm bạn bằng EMAIL bên cạnh số điện thoại. Tài khoản chat có danh tính là số điện thoại HOẶC email
-- (tài khoản tạo bằng email không có số, và ngược lại); mã OTP gửi qua SMS (phone) hoặc qua email (email).
-- Code: chat_nguoi_dung.email, chat_otp.email trong db-map.json; module backend/internal/modules/chat.
-- Kiểm tra trước: bảng chat_users / chat_otp_codes đã có (0018), chưa có cột email.
-- Quay lui (chỉ khi chưa có tài khoản / mã nào theo email): delete from chat_otp_codes where email is not null;
--   alter table chat_otp_codes drop constraint ck_chat_otp_codes_phone_email, drop constraint ck_chat_otp_codes_email,
--   drop column email, alter column phone set not null; (index idx_chat_otp_codes_email_created_at đi theo cột)
--   alter table chat_users drop constraint ck_chat_users_phone_email, drop constraint ck_chat_users_email,
--   drop constraint uq_chat_users_email, drop column email, alter column phone set not null;

do $$ begin
  if to_regclass('public.chat_users') is null or to_regclass('public.chat_otp_codes') is null then
    raise exception '0019: thiếu bảng chat_users / chat_otp_codes (chạy 0018 trước)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_users' and column_name = 'email')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_otp_codes' and column_name = 'email') then
    raise exception '0019: cột email của chat đã có';
  end if;
end $$;

-- ───────────── Tài khoản: phone hoặc email ─────────────

alter table chat_users alter column phone drop not null;
alter table chat_users add column email text;
alter table chat_users add constraint uq_chat_users_email unique (email);
-- email đã chuẩn hoá ở service (chat/email.go: NormalizeEmail): chữ thường, không khoảng trắng, có @ và dấu chấm sau @
alter table chat_users add constraint ck_chat_users_email check (email is null or (email = lower(email)
  and char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
alter table chat_users add constraint ck_chat_users_phone_email check (phone is not null or email is not null);

comment on table chat_users is 'Chat account (identity = phone number or email). Separate from QS users and not tenant-scoped: one account across all companies.';
comment on column chat_users.phone is 'Phone number in E.164 form (+84901234567), normalized by the service; unique. Null = account created by email.';
comment on column chat_users.phone_hash is 'Derived: lowercase hex SHA-256 of phone (null when phone is null); contact matching without sending raw numbers.';
comment on column chat_users.email is 'Lowercase email address, normalized by the service; unique. Null = account created by phone. At least one of phone / email is set.';
comment on column chat_users.created_at is 'Account creation time (first successful OTP verification, by SMS or email).';

-- ───────────── Mã OTP: gửi tới phone hoặc email ─────────────

alter table chat_otp_codes alter column phone drop not null;
alter table chat_otp_codes add column email text;
alter table chat_otp_codes add constraint ck_chat_otp_codes_email check (email is null or (email = lower(email) and char_length(email) <= 254));
alter table chat_otp_codes add constraint ck_chat_otp_codes_phone_email check ((phone is null) <> (email is null));
-- Phục vụ: mã mới nhất / đếm số lần gửi trong 1 giờ / khoá của một email (chat/service_auth.go: RequestOTP, VerifyOTP).
create index idx_chat_otp_codes_email_created_at on chat_otp_codes (email, created_at desc) where email is not null;

comment on table chat_otp_codes is 'One-time login codes sent by SMS (phone) or email; also the source of the OTP rate limits (rows per phone / email / IP per hour). Rows older than 24 h are deleted on the next request of the same phone / email.';
comment on column chat_otp_codes.phone is 'E.164 phone the code was sent to; null when sent by email. Soft reference: the account may not exist yet, no FK.';
comment on column chat_otp_codes.email is 'Lowercase email the code was sent to; null when sent by SMS. Exactly one of phone / email is set.';
comment on column chat_otp_codes.code_hash is 'Lowercase hex HMAC-SHA256(server OTP secret, phone-or-email || '':'' || code); the code itself is never stored.';
comment on column chat_otp_codes.locked_until is 'Set when attempts reach 5: the phone / email cannot request or verify codes until then (15 minutes).';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_chat_users_email') then raise exception '0019: thiếu uq_chat_users_email'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_users_phone_email') then raise exception '0019: thiếu ck_chat_users_phone_email'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_chat_otp_codes_phone_email') then raise exception '0019: thiếu ck_chat_otp_codes_phone_email'; end if;
  if to_regclass('public.idx_chat_otp_codes_email_created_at') is null then raise exception '0019: thiếu idx_chat_otp_codes_email_created_at'; end if;
end $$;
