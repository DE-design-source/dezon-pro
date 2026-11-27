-- 0057_users_role_subadmin.sql (tạo ở nhánh feature/role với số 0053, trùng 0053_sales_lead_dashboard của src_N -> đổi số khi gộp)
-- Vai trò 'subadmin' (nhãn giao diện "Admin", 2026-11-27, roadmap M14.7): giữa nhân viên (staff) và quản trị công ty (admin).
--  * Tạo / sửa / phân quyền tài khoản nhân viên của công ty mình, chỉ trong phạm vi quyền của chính mình; không sửa cài đặt
--    công ty, không tạo / sửa quản trị công ty. Quyền dữ liệu của chính nó tính như nhân viên (access_grants / users.perms).
--  * Ràng buộc gốc ck_users_role ở baseline.sql (chưa migration nào sửa) -> bỏ rồi tạo lại cùng tên, thêm 'subadmin'.
-- Kiểm tra trước: có ck_users_role; mọi dòng users.role thuộc (super, admin, staff).
-- Quay lui (chỉ khi không còn tài khoản subadmin cần giữ):
--   update users set role = 'staff' where role = 'subadmin';
--   alter table users drop constraint ck_users_role,
--     add constraint ck_users_role check (role in ('super', 'admin', 'staff'));
--   comment on column users.role is 'Access role: super (system admin), admin (company owner), staff';

do $$
begin
  if not exists (select 1 from pg_constraint
      where conname = 'ck_users_role' and conrelid = 'public.users'::regclass) then
    raise exception '0057: thiếu ràng buộc ck_users_role';
  end if;
  if exists (select 1 from users where role is null or role not in ('super', 'admin', 'staff')) then
    raise exception '0057: users.role có giá trị ngoài super / admin / staff';
  end if;
end $$;

alter table users
  drop constraint ck_users_role,
  add constraint ck_users_role check (role in ('super', 'admin', 'subadmin', 'staff'));

comment on column users.role is
  'Access role: super (system admin), admin (company owner), subadmin (manages staff accounts within own rights), staff';

-- Xác minh sau
do $$
begin
  if not exists (select 1 from pg_constraint
      where conname = 'ck_users_role' and conrelid = 'public.users'::regclass
        and pg_get_constraintdef(oid) like '%subadmin%') then
    raise exception '0057: ck_users_role chưa nhận giá trị subadmin';
  end if;
end $$;
