-- Quản lý thiết kế + Quản lý dự án: mọi dự án luôn có 2 đề mục "Mua hàng & cung ứng" (kanban mua hàng) và
-- "Tài chính — dòng tiền" (mốc thu / chi). Dự án mới: service tạo cùng dự án (delivery/service.go ensureCorePhases),
-- không xoá / đổi tên được. Migration này bổ sung cho các dự án đã có mà còn thiếu (chỉ thêm dòng, không đổi cấu trúc).
-- Kiểm tra trước: 0016 đã chạy. Quay lui: không cần (đề mục trống, xoá tay nếu muốn).

do $$ begin
  if to_regclass('public.delivery_phases') is null then raise exception '0029: cần chạy 0016_delivery_projects trước'; end if;
end $$;

insert into delivery_phases (project_id, name, sort_order, members)
select p.id, c.name, c.sort_order, '[]'::jsonb
from delivery_projects p
cross join (values ('Mua hàng & cung ứng', 5), ('Tài chính — dòng tiền', 6)) as c(name, sort_order)
where not exists (select 1 from delivery_phases ph where ph.project_id = p.id and ph.name = c.name);

-- Xác minh sau
do $$ begin
  if exists (select 1 from delivery_projects p where (select count(*) from delivery_phases ph where ph.project_id = p.id
    and ph.name in ('Mua hàng & cung ứng', 'Tài chính — dòng tiền')) < 2) then
    raise exception '0029: còn dự án thiếu đề mục cốt lõi';
  end if;
end $$;
