-- Kinh doanh: thêm giai đoạn "giao-ns" (Nhân sự KD phụ trách) giữa Tiếp cận và Tư vấn của pipeline khách hàng tiềm năng.
alter table sales_leads drop constraint ck_sales_leads_stage;
alter table sales_leads add constraint ck_sales_leads_stage check (stage in (
  'tiep-can', 'giao-ns', 'tu-van', 'bao-gia', 'dam-phan', 'chot-hd', 'bao-gia-thi-cong', 'thiet-ke', 'thi-cong', 'truot-thau'
));
