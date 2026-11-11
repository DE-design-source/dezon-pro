-- Thông tin cơ bản của dự án (trang chi tiết dự án, React - theo trang dự án của dezon.vn): Nhóm thiết kế, Nhiếp ảnh gia,
-- Nhà thầu thi công, Năm hoàn thiện. "Công ty" (thiết kế) dùng cột studio (migration 0038), Kiến trúc sư = architect (0036).
-- Code: du_an.nhom_thiet_ke / nhiep_anh_gia / nha_thau_thi_cong / nam_hoan_thien (db-map.json), client nhomThietKe /
-- nhiepAnhGia / nhaThauThiCong / namHoanThien. Chỉ ghi khi client gửi khoá; dự án cũ giữ NULL.
-- Năm hoàn thiện để text (người dùng gõ tự do: "2025", "2025 - 2026", rỗng = xoá) như các cột thông tin khác của projects.
-- Kiểm tra trước: các cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table projects drop column design_team, drop column photographer, drop column contractor, drop column completion_year;

alter table projects
  add column design_team text,
  add column photographer text,
  add column contractor text,
  add column completion_year text;

comment on column projects.design_team is 'Design team members of the project (free text, comma separated); NULL = not entered';
comment on column projects.photographer is 'Photographer of the project photos (free text); NULL = not entered';
comment on column projects.contractor is 'Construction / fit-out contractor (free text); NULL = not entered';
comment on column projects.completion_year is 'Year the project was completed (free text, e.g. 2025); NULL = not entered';

-- Xác minh sau
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'projects'
        and column_name in ('design_team', 'photographer', 'contractor', 'completion_year')) <> 4 then
    raise exception '0039: thiếu cột thông tin cơ bản của projects';
  end if;
end $$;
