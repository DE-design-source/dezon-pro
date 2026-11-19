-- Trường "Nền tảng" của dự án (trang Nhập dự án / chi tiết dự án, khối Thông tin dự án). Code: du_an.nen_tang (db-map.json),
-- client nenTang. Chữ tự do như các cột thông tin khác của projects; chỉ ghi khi client gửi khoá, dự án cũ giữ NULL.
-- Kiểm tra trước: cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table projects drop column platform;

alter table projects add column platform text;

comment on column projects.platform is 'Platform of the project (free text); NULL = not entered';

-- Xác minh sau
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'platform') then
    raise exception '0050: thiếu cột projects.platform';
  end if;
end $$;
