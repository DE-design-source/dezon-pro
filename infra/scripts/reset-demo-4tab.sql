-- Xoá dữ liệu 4 tab (Kinh doanh, Quản lý thiết kế, Quản lý dự án, HR) của công ty thử "Dezon Demo" (code DEMO) trên database thử.
-- GIỮ: sơ đồ tổ chức HR (đơn vị, trưởng đơn vị, kiêm nhiệm, hồ sơ nhân sự, địa điểm làm việc).
-- Chạy: docker exec -i dezon-pro-db psql -U qspro -d qspro_gotest -v ON_ERROR_STOP=1 < infra/scripts/reset-demo-4tab.sql
-- KHÔNG chạy trên database thật.

do $$ begin
  if current_database() not like '%test%' then raise exception 'Chỉ chạy trên database thử (tên chứa test)'; end if;
end $$;

begin;
create temp table c as select id from companies where code = 'DEMO';
create temp table emp as select id from hr_employees where company_id in (select id from c);

-- Kinh doanh
delete from sales_lead_activities where lead_id in (select id from sales_leads where company_id in (select id from c));
delete from sales_leads where company_id in (select id from c);
-- Quản lý thiết kế / Quản lý dự án (đề mục, công việc, thầu phụ, thành viên, bình luận xoá theo dự án)
delete from delivery_projects where company_id in (select id from c);
-- HR (giữ đơn vị, nhân sự, kiêm nhiệm, địa điểm)
delete from hr_candidates where job_id in (select id from hr_job_openings where company_id in (select id from c));
delete from hr_job_openings where company_id in (select id from c);
delete from hr_job_descriptions where company_id in (select id from c);
delete from hr_attendance_logs where employee_id in (select id from emp);
delete from hr_requests where employee_id in (select id from emp);
delete from hr_schedule_overrides where employee_id in (select id from emp);
delete from hr_work_patterns where employee_id in (select id from emp);
delete from hr_shifts where company_id in (select id from c);
delete from hr_pay_adjustments where employee_id in (select id from emp);
delete from hr_payroll_runs where company_id in (select id from c);
delete from hr_payroll_settings where company_id in (select id from c);
delete from hr_unit_budgets where unit_id in (select id from hr_org_units where company_id in (select id from c));
delete from hr_course_enrollments where employee_id in (select id from emp);
delete from hr_courses where company_id in (select id from c);
delete from hr_learning_paths where company_id in (select id from c);
delete from hr_performance_reviews where employee_id in (select id from emp);
delete from hr_objectives where company_id in (select id from c);
delete from hr_security_settings where company_id in (select id from c);
delete from audit_logs where company_id in (select id from c) and action like 'hr.%';
commit;
