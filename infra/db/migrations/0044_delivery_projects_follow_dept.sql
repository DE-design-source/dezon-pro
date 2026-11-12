-- Kinh doanh -> trang triển khai: gửi tới phòng nào thì chỉ hiện ở trang phòng đó (sales deliveryKinds, backend/internal/modules/sales/service.go).
-- Trước đây khách ở tu-van / dam-phan / thiet-ke có dự án ở CẢ Quản lý thiết kế lẫn Quản lý dự án, khách ở thi-cong không có dự án nào.
-- Quy tắc mới (sales_leads.handoff = phiếu bàn giao gần nhất, có thêm khoá "stage" = giai đoạn gửi phiếu từ bản này):
--   phiếu gửi từ đúng giai đoạn đang đứng tới 'Thiết kế' -> design, 'Thi công' -> construction (phiếu cũ không có "stage": chỉ tính ở
--   tu-van / dam-phan); không có phiếu đó: cột thiet-ke -> design, thi-cong -> construction, giai đoạn khác -> không trang nào.
-- Migration này: (1) tạo dự án Quản lý dự án còn thiếu cho khách đang ở thi-cong (như EnsureFromLead: tên sinh từ khách, 2 đề mục
-- cốt lõi, created_at = updated_at = dự án "còn nguyên"); (2) ẩn / hiện lại dự án đang gắn khách cho khớp quy tắc. Không xoá gì.
-- Quay lui: dự án tạo ở (1) có note 'Tạo tự động từ Kinh doanh' và lead_id ở thi-cong; cột is_lead_detached đặt lại được bằng tay.

create temporary table tmp_lead_kind on commit drop as
select l.id as lead_id,
  case
    when l.stage in ('tu-van', 'dam-phan', 'thiet-ke', 'thi-cong')
      and l.handoff->>'dept' in ('Thiết kế', 'Thi công')
      and (coalesce(l.handoff->>'stage', '') = l.stage
        or (coalesce(l.handoff->>'stage', '') = '' and l.stage in ('tu-van', 'dam-phan')))
      then case l.handoff->>'dept' when 'Thiết kế' then 'design' else 'construction' end
    when l.stage = 'thiet-ke' then 'design'
    when l.stage = 'thi-cong' then 'construction'
  end as kind
from sales_leads l;

-- (1) khách ở thi-cong cần dự án thi công mà chưa có dòng nào (cũ: thi-cong không tạo dự án; rời thiet-ke thì dự án còn nguyên bị xoá)
with typ as (
  select l.*, coalesce(nullif(l.project_type, ''), 'Chưa xác định')
    || case when coalesce(l.scale_note, '') <> '' then ' (' || l.scale_note || ')' else '' end as typ
  from sales_leads l
  join tmp_lead_kind k on k.lead_id = l.id and k.kind = 'construction'
  where l.stage = 'thi-cong'
    and not exists (select 1 from delivery_projects p where p.lead_id = l.id and p.kind = 'construction')
),
ins as (
  insert into delivery_projects (company_id, kind, lead_id, project_code, name, client_name, phone, email, address, project_type,
    contract_value_vnd, note, status, created_at, updated_at)
  select t.company_id, 'construction', t.id, nullif(t.project_code, ''),
    case when t.typ like '%—%' then t.typ else t.customer_name || ' — ' || t.typ end,
    t.customer_name, coalesce(t.phone, ''), coalesce(t.email, ''), coalesce(t.address, ''), coalesce(t.project_type, ''),
    round(coalesce(t.estimated_value_vnd, 0)), 'Tạo tự động từ Kinh doanh', 'thiet-ke', now(), now()
  from typ t
  returning id
)
insert into delivery_phases (project_id, name, sort_order, members)
select ins.id, c.name, c.sort_order, '[]'::jsonb
from ins
cross join (values ('Mua hàng & cung ứng', 5), ('Tài chính — dòng tiền', 6)) as c(name, sort_order);

-- (2) ẩn dự án của trang khách không còn cần, hiện lại dự án của trang khách cần (không đổi updated_at)
update delivery_projects p
set is_lead_detached = (k.kind is distinct from p.kind)
from tmp_lead_kind k
where k.lead_id = p.lead_id and p.is_lead_detached is distinct from (k.kind is distinct from p.kind);

comment on column delivery_projects.is_lead_detached is 'true = hidden from the lists: its sales lead no longer needs a project of this kind (sales deliveryKinds: the receiving department of the lead''s hand-off slip, else the thiet-ke / thi-cong column); shown again when it needs one.';

-- Xác minh sau: mỗi khách cần trang nào thì có đúng dự án đó đang hiện (trừ dự án người dùng đã xoá ở tu-van / dam-phan / thiet-ke)
do $$ begin
  if exists (select 1 from delivery_projects p join tmp_lead_kind k on k.lead_id = p.lead_id
             where p.is_lead_detached = (k.kind is not distinct from p.kind)) then
    raise exception '0044: còn dự án gắn khách ẩn / hiện sai trang';
  end if;
  if exists (select 1 from tmp_lead_kind k join sales_leads l on l.id = k.lead_id
             where l.stage = 'thi-cong' and k.kind = 'construction'
               and not exists (select 1 from delivery_projects p where p.lead_id = k.lead_id and p.kind = 'construction')) then
    raise exception '0044: còn khách ở thi-cong thiếu dự án Quản lý dự án';
  end if;
end $$;
