-- "Kiến trúc sư" của dự án: ô đầu tiên của trang Nhập dự án (Danh sách dự án, React), gợi ý các dự án KTS đã tham gia;
-- hiện ở bảng Thông tin của trang chi tiết dự án.
-- Code: du_an.kien_truc_su (db-map.json), client kienTrucSu. Chỉ ghi khi client gửi khoá; dự án cũ giữ NULL.
-- Kiểm tra trước: cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table projects drop column architect;

alter table projects
  add column architect text;

comment on column projects.architect is 'Architect of the project (free text, name of person / firm); NULL = not entered';

-- Xác minh sau
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'architect') then
    raise exception '0036: thiếu cột projects.architect';
  end if;
end $$;
