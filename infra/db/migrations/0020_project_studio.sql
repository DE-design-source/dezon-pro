-- "Studio" của dự án: hiện / sửa ở bảng Thông tin của trang chi tiết dự án (React), lọc ở bảng Ghi danh nhiều dự án.
-- Code: du_an.studio (db-map.json), client studio. Chỉ ghi khi client gửi khoá; dự án cũ giữ NULL.
-- Kiểm tra trước: cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table projects drop column studio;

alter table projects
  add column studio text;

comment on column projects.studio is 'Design studio of the project (free text); NULL = not entered';

-- Xác minh sau
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'studio') then
    raise exception '0020: thiếu cột projects.studio';
  end if;
end $$;
