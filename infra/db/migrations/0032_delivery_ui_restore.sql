-- Quản lý thiết kế + Quản lý dự án: trả giao diện về bản 8686a37 (dữ liệu mẫu) nhưng lưu trên máy chủ. Bản cũ có những thứ
-- 0016 chưa lưu: trạng thái "Thiết kế" (dự án mới từ Kinh doanh), tiến độ / màu thanh tiến độ ở danh sách dự án,
-- sơ đồ tổ chức (trước ở localStorage), đơn mua hàng của bảng kanban (trước chỉ trong bộ nhớ trình duyệt).
-- Code: tk_du_an.tien_do / mau_thanh / so_do_to_chuc, tk_cong_viec.don_mua (db-map.json); module backend/internal/modules/delivery.
-- Kiểm tra trước: 0016 đã chạy, các cột chưa có. Quay lui: bỏ 4 cột, đặt lại ck_delivery_projects_status như 0016
-- (đổi status 'thiet-ke' về 'nhap' trước).

do $$ begin
  if to_regclass('public.delivery_projects') is null then raise exception '0028: cần chạy 0016_delivery_projects trước'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_projects' and column_name = 'org_chart') then
    raise exception '0028: cột delivery_projects.org_chart đã có';
  end if;
end $$;

alter table delivery_projects drop constraint ck_delivery_projects_status;
alter table delivery_projects add constraint ck_delivery_projects_status check (status in ('nhap', 'thiet-ke', 'dang-lam', 'tam-dung', 'hoan-tat'));
-- dự án đang gắn khách hàng Kinh doanh mà chưa ai đổi trạng thái: bản cũ hiện "Thiết kế"
update delivery_projects set status = 'thiet-ke' where lead_id is not null and status = 'nhap';

alter table delivery_projects
  add column progress_pct numeric(5,2),
  add column bar_color    text not null default '',
  add column org_chart    jsonb,
  add constraint ck_delivery_projects_progress_pct check (progress_pct is null or progress_pct between 0 and 100),
  add constraint ck_delivery_projects_org_chart check (org_chart is null or jsonb_typeof(org_chart) = 'object');

alter table delivery_tasks
  add column purchase_orders jsonb not null default '[]'::jsonb,
  add constraint ck_delivery_tasks_purchase_orders check (jsonb_typeof(purchase_orders) = 'array');

comment on column delivery_projects.status is 'nhap (draft) / thiet-ke (design, new from sales) / dang-lam (in progress) / tam-dung (paused) / hoan-tat (done).';
comment on column delivery_projects.progress_pct is 'Manual progress shown in the project list while the project has no Gantt tasks; null = 0.';
comment on column delivery_projects.bar_color is 'CSS colour of the progress bar in the project list; empty = by status.';
comment on column delivery_projects.org_chart is 'Project org chart {parallel: [...], children: [...]} (dept, label, color, icon key, flags); null = default chart.';
comment on column delivery_tasks.purchase_orders is 'Purchase orders of a task in the purchasing phase (kanban): [{id, code, item, supplier, qty, value (million VND), due, owner, stage, assignees, dept}].';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_tasks' and column_name = 'purchase_orders') then
    raise exception '0028: thiếu cột delivery_tasks.purchase_orders';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_projects' and column_name = 'progress_pct') then
    raise exception '0028: thiếu cột delivery_projects.progress_pct';
  end if;
end $$;
