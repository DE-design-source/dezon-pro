-- Duyệt sản phẩm theo phân cấp (2026-11-20, roadmap M14.6):
--  * users.has_product_approval: quản trị hệ thống (super) giao cho TỪNG tài khoản admin công ty quyền duyệt sản phẩm
--    và giao tiếp quyền duyệt (sp_duyet) cho nhân viên. Mặc định false = admin không duyệt, không giao được.
--    Code: users.duoc_duyet_sp (db-map.json).
--  * Sản phẩm chưa duyệt bị ẩn khỏi Bóc tách -> duyệt sẵn toàn bộ sản phẩm đang có (người duyệt 'hệ thống'),
--    chỉ sản phẩm nhập / sửa từ nay mới phải chờ duyệt.
-- Kiểm tra trước: cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table users drop column has_product_approval; (phần duyệt sẵn không hoàn tác được)

alter table users add column has_product_approval boolean not null default false;

comment on column users.has_product_approval is
  'Company admin may approve products and grant sp_duyet to staff; set only by system super admin';

update products
   set is_approved = true,
       approved_by = coalesce(nullif(approved_by, ''), 'hệ thống'),
       approved_at = coalesce(approved_at, now())
 where is_approved is not true;

-- Xác minh sau
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'has_product_approval') then
    raise exception '0051: thiếu cột users.has_product_approval';
  end if;
  if exists (select 1 from products where is_approved is not true) then
    raise exception '0051: còn sản phẩm chưa duyệt sau khi duyệt sẵn';
  end if;
end $$;
