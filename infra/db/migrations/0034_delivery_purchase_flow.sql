-- Quản lý thiết kế + Quản lý dự án: quy trình (các bước kanban) của bảng mua hàng lưu theo từng công việc. Trước đây quy trình
-- chỉ nằm trong bộ nhớ trình duyệt nên tải lại trang thì về quy trình mặc định, đơn ở bước tự tạo không hiện ở cột nào.
-- Code: tk_cong_viec.quy_trinh_mua (db-map.json); module backend/internal/modules/delivery.
-- Kiểm tra trước: 0028 đã chạy, cột chưa có. Quay lui: alter table delivery_tasks drop column purchase_flow.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tasks' and column_name = 'purchase_orders') then
    raise exception '0030: cần chạy 0028_delivery_ui_restore trước';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tasks' and column_name = 'purchase_flow') then
    raise exception '0030: cột delivery_tasks.purchase_flow đã có';
  end if;
end $$;

alter table delivery_tasks
  add column purchase_flow jsonb,
  add constraint ck_delivery_tasks_purchase_flow check (purchase_flow is null or jsonb_typeof(purchase_flow) = 'array');

comment on column delivery_tasks.purchase_flow is 'Purchase kanban stages of the task: [{key, label, color, depts, owners, received, closed}]; null = default stages.';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tasks' and column_name = 'purchase_flow') then
    raise exception '0030: thiếu cột delivery_tasks.purchase_flow';
  end if;
end $$;
