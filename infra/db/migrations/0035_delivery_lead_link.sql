-- Kinh doanh -> Quản lý thiết kế + Quản lý dự án: khách rời giai đoạn tu-van / dam-phan / thiet-ke thì dự án đã tạo từ khách
-- KHÔNG bị xoá nữa (trước đây xoá nếu chưa có công việc / thành viên..., mất ngày, ngân sách, ghi chú, đề mục...), chỉ ẩn:
-- giữ lead_id, đặt is_lead_detached = true; khách quay lại các giai đoạn đó -> hiện lại đúng dự án cũ (không tạo trùng).
-- Code: tk_du_an.tach_khach_hang (db-map.json); module backend/internal/modules/delivery.
-- Kiểm tra trước: 0016 đã chạy, cột chưa có. Quay lui: alter table delivery_projects drop column is_lead_detached.

do $$ begin
  if to_regclass('public.delivery_projects') is null then raise exception '0031: cần chạy 0016_delivery_projects trước'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_projects' and column_name = 'is_lead_detached') then
    raise exception '0031: cột delivery_projects.is_lead_detached đã có';
  end if;
end $$;

alter table delivery_projects
  add column is_lead_detached boolean not null default false;

comment on column delivery_projects.is_lead_detached is 'true = hidden from the lists: its sales lead left the hand-off stages (tu-van / dam-phan / thiet-ke); shown again when the lead returns.';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'delivery_projects'
    and column_name = 'is_lead_detached' and is_nullable = 'NO') then
    raise exception '0031: thiếu cột delivery_projects.is_lead_detached';
  end if;
end $$;
