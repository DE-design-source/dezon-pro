-- Kinh doanh, trang khách hàng dạng dashboard (tiếp 0053): 2 ràng buộc CHECK cho điều service đã kiểm
-- (backend/internal/modules/sales/service_plan.go) để dữ liệu ghi thẳng vào database cũng không lệch:
--   sales_lead_tasks.done_at chỉ có khi is_done (bỏ tick xong -> done_at null);
--   sales_lead_appointments: có cả giờ bắt đầu lẫn giờ kết thúc thì giờ kết thúc phải sau giờ bắt đầu (HH:MM so như chuỗi).
-- Kiểm tra trước: 2 ràng buộc chưa có. Dữ liệu cũ vi phạm (nếu có) sửa trước khi thêm ràng buộc:
--   task chưa xong mà còn done_at -> done_at = null (đúng nghĩa: chưa xong thì không có thời điểm xong);
--   lịch hẹn có giờ kết thúc không sau giờ bắt đầu -> bỏ giờ kết thúc (end_time = '').
-- Quay lui: alter table sales_lead_tasks drop constraint ck_sales_lead_tasks_done_at;
--           alter table sales_lead_appointments drop constraint ck_sales_lead_appointments_end_time_after_start;

do $$ begin
  if to_regclass('public.sales_lead_tasks') is null or to_regclass('public.sales_lead_appointments') is null then
    raise exception '0054: thiếu bảng sales_lead_tasks / sales_lead_appointments (chạy 0053 trước)';
  end if;
  if exists (select 1 from pg_constraint where conname in ('ck_sales_lead_tasks_done_at', 'ck_sales_lead_appointments_end_time_after_start')) then
    raise exception '0054: ràng buộc ck_sales_lead_tasks_done_at / ck_sales_lead_appointments_end_time_after_start đã có';
  end if;
end $$;

update sales_lead_tasks set done_at = null where not is_done and done_at is not null;
update sales_lead_appointments set end_time = '' where start_time <> '' and end_time <> '' and end_time <= start_time;

alter table sales_lead_tasks add constraint ck_sales_lead_tasks_done_at check (is_done or done_at is null);
alter table sales_lead_appointments add constraint ck_sales_lead_appointments_end_time_after_start
  check (start_time = '' or end_time = '' or end_time > start_time);

-- Xác minh sau
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_sales_lead_tasks_done_at' and conrelid = 'public.sales_lead_tasks'::regclass) then
    raise exception '0054: thiếu ràng buộc ck_sales_lead_tasks_done_at';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_sales_lead_appointments_end_time_after_start' and conrelid = 'public.sales_lead_appointments'::regclass) then
    raise exception '0054: thiếu ràng buộc ck_sales_lead_appointments_end_time_after_start';
  end if;
end $$;
