-- Chat: nhớ công ty Dezon Pro của tài khoản chat gắn Dezon Pro (backend/CHAT.md mục 6.7). Mỗi lần POST /api/v1/chat/auth/dezon
-- so công ty hiện tại (users.company_id) với cột này; khác nhau = người đó đã chuyển công ty -> bỏ kết bạn với đồng nghiệp cũ
-- (tài khoản gắn Dezon Pro), kết bạn với đồng nghiệp mới, rồi ghi công ty mới vào đây. Không đổi công ty thì không kết bạn lại
-- (ai đã tự huỷ kết bạn với đồng nghiệp không bị kết bạn lại mỗi lần đăng nhập).
-- - chat_users.qs_company_id: uuid của companies lúc đăng nhập Dezon Pro gần nhất; null = tài khoản OTP / QR, hoặc tài khoản
--   Dezon Pro không thuộc công ty (super). KHÔNG khoá ngoại (như qs_user_id): xoá công ty không bị chặn bởi chat.
-- - Điền sẵn từ users.company_id cho tài khoản đã gắn (0045) - không thì lần đăng nhập đầu sau migration bị coi là đổi công ty.
-- Code: module backend/internal/modules/chat (service_dezon.go, SQL thô qua pgx); db-map.json: chat_nguoi_dung.qs_cong_ty_id.
-- Kiểm tra trước: đã có chat_users.qs_user_id (0045), chưa có cột qs_company_id.
-- Quay lui:
--   alter table chat_users drop column qs_company_id;
--   delete from schema_migrations where version = '0046';

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_users' and column_name = 'qs_user_id') then
    raise exception '0046: thiếu chat_users.qs_user_id (chạy 0045 trước)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_users' and column_name = 'qs_company_id') then
    raise exception '0046: cột chat_users.qs_company_id đã có';
  end if;
end $$;

alter table chat_users add column qs_company_id uuid;

comment on column chat_users.qs_company_id is 'companies.id of the linked Dezon Pro account at its last Dezon Pro sign-in; a different users.company_id on the next sign-in means the person moved company (colleague friendships are redone). Null = OTP / QR account or a Dezon Pro account without a company. No FK.';

update chat_users c set qs_company_id = u.company_id from users u where u.id = c.qs_user_id and u.company_id is not null;

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_users' and column_name = 'qs_company_id') then
    raise exception '0046: thiếu chat_users.qs_company_id';
  end if;
end $$;
