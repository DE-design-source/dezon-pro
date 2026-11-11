-- HR - lưu những gì giao diện gốc (bản dữ liệu tĩnh 8686a37) có mà máy chủ chưa lưu:
--   * hr_security_settings.ui_settings: cài đặt bảo mật (2FA, SSO, IP, thời gian phiên), chi nhánh được truy cập thêm của
--     từng người, người dùng mô phỏng của từng vai trò. Code: hr_bao_mat.giao_dien (db-map.json).
--   * hr_payroll_runs.sent_employee_ids: danh sách nhân sự đã gửi phiếu lương (bước 3 "Gửi phiếu lương"). Code: hr_ky_luong.da_gui.
-- Nhật ký thao tác của giao diện ghi vào audit_logs (action hr.ui) - không cần cột mới.
-- Kiểm tra trước: 0022, 0024 đã chạy; cột chưa có.
-- Quay lui: alter table hr_security_settings drop column ui_settings; alter table hr_payroll_runs drop column sent_employee_ids;

do $$ begin
  if to_regclass('public.hr_security_settings') is null or to_regclass('public.hr_payroll_runs') is null then
    raise exception '0027: cần chạy 0022, 0024 trước';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'hr_security_settings' and column_name = 'ui_settings')
    or exists (select 1 from information_schema.columns where table_name = 'hr_payroll_runs' and column_name = 'sent_employee_ids') then
    raise exception '0027: cột đã có';
  end if;
end $$;

alter table hr_security_settings add column ui_settings jsonb not null default '{}'::jsonb,
  add constraint ck_hr_security_settings_ui_settings check (jsonb_typeof(ui_settings) = 'object');
comment on column hr_security_settings.ui_settings is 'UI security settings document: {settings {key: {label, value}}, session, branches {employeeId: [branch]}, roleUsers {role: employeeId}}.';

alter table hr_payroll_runs add column sent_employee_ids jsonb not null default '[]'::jsonb,
  add constraint ck_hr_payroll_runs_sent_employee_ids check (jsonb_typeof(sent_employee_ids) = 'array');
comment on column hr_payroll_runs.sent_employee_ids is 'Employee ids whose payslip was sent (step "Gửi phiếu lương"); cleared when the run is reopened.';

-- Xác minh sau
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'hr_security_settings' and column_name = 'ui_settings')
    or not exists (select 1 from information_schema.columns where table_name = 'hr_payroll_runs' and column_name = 'sent_employee_ids') then
    raise exception '0027: thiếu cột';
  end if;
end $$;
