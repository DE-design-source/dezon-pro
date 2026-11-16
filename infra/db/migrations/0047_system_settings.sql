-- Cài đặt mặc định TOÀN HỆ THỐNG do Siêu quản trị viên lưu (giao diện, chung, hiển thị), mọi tài khoản đăng nhập đọc được.
-- Không theo công ty: không có company_id, không thuộc TenantTables.
create table system_settings (
  setting_key   text not null,
  setting_value jsonb,
  updated_at    timestamptz not null default now(),
  updated_by    text,
  constraint pk_system_settings primary key (setting_key),
  constraint ck_system_settings_setting_key check (setting_key <> '')
);
comment on table system_settings is 'System-wide default settings saved by a super admin, readable by every signed-in user (not per company).';
comment on column system_settings.setting_key is 'Section key: appearance, general or display.';
comment on column system_settings.setting_value is 'JSON object of default values for the section; replaced as a whole on every save.';
comment on column system_settings.updated_at is 'Time of the last save.';
comment on column system_settings.updated_by is 'Username of the last editor.';
