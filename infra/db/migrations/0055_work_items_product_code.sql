-- Mã sản phẩm của công tác (thư viện Phần thô, file mẫu Prelim: KSHT, DDMB...). Code: cong_tac.ma_sp (db-map.json), client maSP;
-- khi thêm công tác vào bảng Phần thô, mã vào cột "Mã sản phẩm" của bảng. Chữ tự do; công tác cũ giữ NULL.
-- Kiểm tra trước: cột chưa có (add column báo lỗi nếu đã có -> cả file quay lui).
-- Quay lui: alter table work_items drop column product_code;

alter table work_items add column product_code text;

comment on column work_items.product_code is 'Product / item code shown in the "Mã sản phẩm" column of the rough-work table (e.g. KSHT); NULL = not entered';

-- Xác minh sau
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'work_items' and column_name = 'product_code') then
    raise exception '0055: thiếu cột work_items.product_code';
  end if;
end $$;
