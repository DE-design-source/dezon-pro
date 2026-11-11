-- Kinh doanh: thêm giai đoạn "khong-tham-gia" (công ty quyết định không tham gia / từ chối dự án) trước Đã trượt thầu.
alter table sales_leads drop constraint ck_sales_leads_stage;
alter table sales_leads add constraint ck_sales_leads_stage check (stage in (
  'tiep-can', 'giao-ns', 'tu-van', 'bao-gia', 'dam-phan', 'chot-hd', 'bao-gia-thi-cong', 'thiet-ke', 'thi-cong',
  'khong-tham-gia', 'truot-thau', 'spam'
));
