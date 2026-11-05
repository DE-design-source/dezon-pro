/* Dữ liệu mẫu HR — đợt 2: lương & bảo hiểm, tuyển dụng, hiệu suất & đào tạo, phân quyền & nhật ký. */

/* ======================= PHÂN QUYỀN (RBAC) ======================= */
export const ROLES = {
  sysadmin: { label: 'System Admin', desc: 'Toàn quyền hệ thống, cấu hình phân quyền & bảo mật', tone: 'danger', userId: 17, scope: 'all' },
  hradmin: { label: 'HR Admin', desc: 'Quản lý toàn bộ dữ liệu nhân sự, lương, tuyển dụng', tone: 'attendance', userId: 4, scope: 'all' },
  manager: { label: 'Trưởng phòng', desc: 'Xem & duyệt dữ liệu nhân sự trong phòng ban mình', tone: 'primary', userId: 6, scope: 'dept' },
  employee: { label: 'Nhân viên', desc: 'Chỉ xem hồ sơ, công, lương, mục tiêu của bản thân', tone: 'muted', userId: 9, scope: 'self' },
}
export const PERM_MODULES = [
  { key: 'employees', label: 'Hồ sơ nhân sự' },
  { key: 'attendance', label: 'Chấm công & phép' },
  { key: 'payroll', label: 'Lương & bảo hiểm' },
  { key: 'recruit', label: 'Tuyển dụng' },
  { key: 'performance', label: 'Hiệu suất & đào tạo' },
  { key: 'security', label: 'Phân quyền & bảo mật' },
]
export const PERM_ACTIONS = [
  { key: 'view', label: 'Xem' }, { key: 'create', label: 'Tạo' }, { key: 'edit', label: 'Sửa' },
  { key: 'delete', label: 'Xoá' }, { key: 'approve', label: 'Duyệt' }, { key: 'export', label: 'Xuất' },
]
const all = ['view', 'create', 'edit', 'delete', 'approve', 'export']
export const DEFAULT_PERMS = {
  sysadmin: Object.fromEntries(PERM_MODULES.map(m => [m.key, [...all]])),
  hradmin: { employees: [...all], attendance: [...all], payroll: [...all], recruit: [...all], performance: [...all], security: ['view', 'export'] },
  manager: { employees: ['view', 'export'], attendance: ['view', 'approve', 'export'], payroll: [], recruit: ['view', 'edit', 'approve'], performance: ['view', 'create', 'edit', 'approve'], security: [] },
  employee: { employees: ['view'], attendance: ['view', 'create'], payroll: ['view'], recruit: [], performance: ['view', 'edit'], security: [] },
}
export const BRANCHES = ['Văn phòng HCM', 'Công trường Riverside', 'Kho Bình Chánh']

export const SECURITY_SETTINGS = {
  require2fa: { label: 'Bắt buộc xác thực 2 lớp (2FA) cho HR Admin & System Admin', value: true },
  require2faAll: { label: 'Bắt buộc 2FA cho toàn bộ nhân viên', value: false },
  sso: { label: 'Đăng nhập một lần qua Google Workspace (OAuth2)', value: true },
  ipLimit: { label: 'Chỉ cho phép truy cập bảng lương từ mạng công ty', value: false },
  maskSalary: { label: 'Ẩn số tiền lương mặc định (bấm để hiện)', value: true },
}
export const SESSION_OPTIONS = ['15 phút', '30 phút', '1 giờ', '8 giờ']

/* Nhật ký thao tác ban đầu (mới nhất trước) */
export const INITIAL_AUDIT = [
  { id: 9, time: '23/09/2026 · 08:42', user: 'Ngô Mỹ Duyên', role: 'hradmin', module: 'attendance', action: 'approve', target: 'Đơn nghỉ phép — Ngọc Hà', ip: '10.0.1.24' },
  { id: 8, time: '23/09/2026 · 08:15', user: 'Lê Trung Kiên', role: 'sysadmin', module: 'security', action: 'edit', target: 'Bật 2FA bắt buộc cho HR Admin', ip: '10.0.1.8' },
  { id: 7, time: '22/09/2026 · 17:05', user: 'Nguyễn Đức Anh', role: 'manager', module: 'attendance', action: 'approve', target: 'Đơn OT — Phạm Quốc Bảo (cấp 1)', ip: '113.161.42.7' },
  { id: 6, time: '22/09/2026 · 16:30', user: 'Đặng Hữu Phúc', role: 'hradmin', module: 'payroll', action: 'export', target: 'Bảng lương tháng 8/2026 (CSV)', ip: '10.0.1.31' },
  { id: 5, time: '22/09/2026 · 10:12', user: 'Ngô Mỹ Duyên', role: 'hradmin', module: 'employees', action: 'edit', target: 'Hồ sơ Vũ Thị Diệu — cập nhật CCCD', ip: '10.0.1.24' },
  { id: 4, time: '21/09/2026 · 14:48', user: 'Ngô Mỹ Duyên', role: 'hradmin', module: 'recruit', action: 'edit', target: 'Ứng viên Đinh Gia Huy → Đề nghị (Offer)', ip: '10.0.1.24' },
  { id: 3, time: '21/09/2026 · 09:03', user: 'Đỗ Thành Long', role: 'employee', module: 'auth', action: 'login', target: 'Đăng nhập thất bại (sai mật khẩu 2 lần)', ip: '14.232.18.90', warn: true },
  { id: 2, time: '20/09/2026 · 18:20', user: 'Đặng Hữu Phúc', role: 'hradmin', module: 'payroll', action: 'approve', target: 'Duyệt bảng lương tháng 8/2026', ip: '10.0.1.31' },
  { id: 1, time: '20/09/2026 · 08:00', user: 'Hệ thống', role: 'sysadmin', module: 'payroll', action: 'create', target: 'Gửi 20 phiếu lương tháng 8/2026 qua email (BullMQ job #4812)', ip: '—' },
]
export const AUDIT_ACTION_LABEL = { view: 'Xem', create: 'Tạo', edit: 'Sửa', delete: 'Xoá', approve: 'Duyệt', reject: 'Từ chối', export: 'Xuất', login: 'Đăng nhập', role: 'Đổi vai trò' }

/* ======================= LƯƠNG & BẢO HIỂM ======================= */
/* Cấu hình mặc định — có thể chỉnh trong tab "Cấu hình công thức". Kiểm tra lại theo quy định hiện hành trước khi áp dụng thật. */
export const DEFAULT_PAYROLL_CONFIG = {
  lunch: 730000, // phụ cấp ăn trưa (miễn thuế tối đa 730.000đ)
  phoneByLevel: { 'Nhân viên': 300000, 'Chuyên viên': 500000, 'Điều phối': 700000, 'Trưởng nhóm': 1000000, 'Quản lý': 1200000, 'Phó phòng': 1500000, 'Trưởng phòng': 2000000, 'Giám đốc': 3000000 },
  siteAllowance: 1500000, // phụ cấp công trường
  otRate: 1.5, // hệ số OT ngày thường
  commissionRate: 0.01, // hoa hồng KD trên doanh số
  insCap: 46800000, // trần lương đóng BHXH/BHYT (20 × lương cơ sở 2.340.000)
  emp: { bhxh: 0.08, bhyt: 0.015, bhtn: 0.01 },
  com: { bhxh: 0.175, bhyt: 0.03, bhtn: 0.01 },
  personalDeduction: 15500000,
  dependentDeduction: 6200000,
  brackets: [ // thu nhập tính thuế / tháng (đ) — thuế suất
    { upTo: 10000000, rate: 0.05 }, { upTo: 30000000, rate: 0.1 }, { upTo: 60000000, rate: 0.2 },
    { upTo: 100000000, rate: 0.3 }, { upTo: null, rate: 0.35 },
  ],
}
/* Thưởng / phạt / doanh số theo tháng (theo id nhân viên) */
export const INITIAL_ADJUSTMENTS = {
  '2026-09': {
    2: [{ kind: 'bonus', label: 'Thưởng tiến độ dự án Riverside', amount: 5000000 }],
    6: [{ kind: 'bonus', label: 'Thưởng an toàn 0 sự cố', amount: 2000000 }],
    7: [{ kind: 'sales', label: 'Doanh số hợp đồng Lô B12', amount: 850000000 }],
    16: [{ kind: 'sales', label: 'Doanh số nhà phố Q7', amount: 320000000 }, { kind: 'penalty', label: 'Đi muộn quá 3 lần', amount: 200000 }],
    15: [{ kind: 'penalty', label: 'Đi muộn 2 lần', amount: 100000 }],
  },
}
export const PAYROLL_STATUS = { draft: { label: 'Nháp', tone: 'muted' }, approved: { label: 'Đã duyệt', tone: 'primary' }, paid: { label: 'Đã chi trả', tone: 'success' } }

/* ======================= TUYỂN DỤNG ======================= */
export const STAGES = [
  { key: 'applied', label: 'Ứng tuyển', tone: 'muted' },
  { key: 'screening', label: 'Sàng lọc CV', tone: 'primary' },
  { key: 'interview', label: 'Phỏng vấn', tone: 'finance' },
  { key: 'offer', label: 'Đề nghị (Offer)', tone: 'qs' },
  { key: 'hired', label: 'Nhận việc', tone: 'success' },
  { key: 'rejected', label: 'Loại', tone: 'danger' },
]
export const SOURCES = ['LinkedIn', 'TopCV', 'VietnamWorks', 'Giới thiệu nội bộ', 'Website công ty', 'Facebook']
/* Thư viện JD (mô tả công việc) — nguồn dữ liệu chuẩn cho mọi tin tuyển dụng */
export const JD_LEVELS = ['Thực tập', 'Nhân viên', 'Chuyên viên', 'Trưởng nhóm', 'Trưởng phòng', 'Giám đốc']
export const INITIAL_JDS = [
  { id: 1, code: 'JD-TC-01', title: 'Kỹ sư giám sát công trình', dept: 'thicong', level: 'Chuyên viên', salary: '18–25 triệu', updated: '2026-08-12',
    summary: 'Giám sát thi công kết cấu, nghiệm thu khối lượng, phối hợp tư vấn giám sát tại công trường.',
    duties: ['Giám sát thi công phần kết cấu, hoàn thiện theo bản vẽ & tiêu chuẩn', 'Nghiệm thu khối lượng, lập biên bản nghiệm thu nội bộ', 'Phối hợp tư vấn giám sát, chủ đầu tư xử lý phát sinh', 'Báo cáo tiến độ ngày/tuần cho Chỉ huy trưởng'],
    requirements: ['Tốt nghiệp ĐH Xây dựng dân dụng & công nghiệp', 'Tối thiểu 3 năm kinh nghiệm giám sát', 'Có chứng chỉ hành nghề giám sát hạng II trở lên', 'Đọc bản vẽ tốt, sử dụng AutoCAD'],
    benefits: ['Phụ cấp công trường 1.500.000đ/tháng', 'Thưởng tiến độ theo dự án', 'BHXH đầy đủ, khám sức khoẻ định kỳ'] },
  { id: 2, code: 'JD-TC-02', title: 'Chỉ huy trưởng công trường', dept: 'thicong', level: 'Trưởng phòng', salary: '30–45 triệu', updated: '2026-05-03',
    summary: 'Điều hành toàn bộ hoạt động thi công tại công trường, chịu trách nhiệm tiến độ, chất lượng, an toàn.',
    duties: ['Lập và điều phối kế hoạch thi công tổng thể', 'Quản lý đội thi công, thầu phụ, vật tư tại công trường', 'Đảm bảo an toàn lao động & vệ sinh môi trường', 'Làm việc với chủ đầu tư, tư vấn giám sát'],
    requirements: ['Tối thiểu 8 năm kinh nghiệm, 3 năm ở vị trí tương đương', 'Đã chỉ huy công trình nhà cao tầng', 'Chứng chỉ chỉ huy trưởng hạng I'],
    benefits: ['Thưởng hoàn thành dự án', 'Xe đưa đón / phụ cấp xăng xe', 'Lương tháng 13'] },
  { id: 3, code: 'JD-TC-03', title: 'Giám sát an toàn lao động', dept: 'thicong', level: 'Nhân viên', salary: '10–14 triệu', updated: '2026-07-20',
    summary: 'Kiểm tra, huấn luyện và giám sát công tác an toàn lao động trên công trường.',
    duties: ['Kiểm tra an toàn hằng ngày, lập biên bản vi phạm', 'Huấn luyện ATLĐ cho công nhân mới', 'Quản lý cấp phát đồ bảo hộ'],
    requirements: ['Có chứng chỉ an toàn lao động nhóm 3', 'Ưu tiên 1 năm kinh nghiệm công trường'],
    benefits: ['Phụ cấp công trường', 'Đào tạo chứng chỉ chuyên sâu'] },
  { id: 4, code: 'JD-TK-01', title: 'Kiến trúc sư thiết kế', dept: 'thietke', level: 'Chuyên viên', salary: '20–30 triệu', updated: '2026-06-15',
    summary: 'Thiết kế kiến trúc nhà ở, chung cư; triển khai hồ sơ bản vẽ thi công.',
    duties: ['Lên ý tưởng & phương án kiến trúc', 'Triển khai hồ sơ thiết kế cơ sở, bản vẽ thi công', 'Phối hợp kết cấu, MEP trên mô hình BIM'],
    requirements: ['Tốt nghiệp ĐH Kiến trúc', 'Thành thạo Revit, AutoCAD, SketchUp', 'Có portfolio dự án nhà ở'],
    benefits: ['Môi trường dự án lớn', 'Hỗ trợ học chứng chỉ BIM'] },
  { id: 5, code: 'JD-QS-01', title: 'Kỹ sư QS (dự toán)', dept: 'qs', level: 'Chuyên viên', salary: '16–24 triệu', updated: '2026-04-02',
    summary: 'Bóc tách khối lượng, lập dự toán và kiểm soát chi phí dự án.',
    duties: ['Bóc tách khối lượng từ bản vẽ / mô hình BIM', 'Lập dự toán, so sánh báo giá nhà cung cấp', 'Theo dõi chi phí phát sinh so với dự toán'],
    requirements: ['2 năm kinh nghiệm QS', 'Thành thạo Excel, phần mềm dự toán'],
    benefits: ['Thưởng tiết kiệm chi phí dự án'] },
  { id: 6, code: 'JD-KDDA-01', title: 'Nhân viên kinh doanh dự án', dept: 'kdda', level: 'Nhân viên', salary: '12 triệu + hoa hồng', updated: '2026-09-01',
    summary: 'Tìm kiếm khách hàng dự án dân dụng, chăm sóc & chốt hợp đồng.',
    duties: ['Tìm kiếm, tiếp cận khách hàng tiềm năng', 'Khảo sát nhu cầu, phối hợp lập báo giá', 'Đàm phán & chốt hợp đồng thi công'],
    requirements: ['Kỹ năng giao tiếp, đàm phán tốt', 'Ưu tiên có kinh nghiệm sales xây dựng / BĐS'],
    benefits: ['Hoa hồng 1% doanh số', 'Thưởng nóng theo hợp đồng'] },
  { id: 7, code: 'JD-MKT-01', title: 'Content Creator', dept: 'marketing', level: 'Nhân viên', salary: '10–14 triệu', updated: '2026-08-05',
    summary: 'Sản xuất nội dung cho fanpage, website và kênh video của công ty.',
    duties: ['Lên kế hoạch & viết nội dung đa kênh', 'Phối hợp media quay dựng video dự án', 'Theo dõi chỉ số tương tác'],
    requirements: ['Viết tốt, có tư duy hình ảnh', 'Portfolio nội dung'],
    benefits: ['Môi trường sáng tạo, linh hoạt'] },
  { id: 8, code: 'JD-TCKT-01', title: 'Kế toán nội bộ', dept: 'tckt', level: 'Nhân viên', salary: '13–16 triệu', updated: '2026-03-10',
    summary: 'Hạch toán chi phí công trình, đối chiếu công nợ nhà cung cấp.',
    duties: ['Hạch toán chi phí theo từng công trình', 'Đối chiếu công nợ, lập đề nghị thanh toán', 'Hỗ trợ quyết toán tạm ứng'],
    requirements: ['Tốt nghiệp ĐH Kế toán', '2 năm kinh nghiệm kế toán xây dựng', 'Thành thạo MISA'],
    benefits: ['Thưởng quý theo KPI'] },
  { id: 9, code: 'JD-HCNS-01', title: 'Chuyên viên tuyển dụng', dept: 'hcns', level: 'Chuyên viên', salary: '14–18 triệu', updated: '2026-02-18',
    summary: 'Triển khai kế hoạch tuyển dụng cho khối văn phòng & công trường.',
    duties: ['Đăng tin, sàng lọc CV, sắp xếp phỏng vấn', 'Xây dựng nguồn ứng viên kỹ thuật', 'Onboarding nhân sự mới'],
    requirements: ['2 năm kinh nghiệm tuyển dụng', 'Ưu tiên từng tuyển kỹ sư xây dựng'],
    benefits: ['Thưởng theo số lượng tuyển thành công'] },
  { id: 10, code: 'JD-MH-01', title: 'Nhân viên cung ứng vật tư', dept: 'muahang', level: 'Nhân viên', salary: '11–14 triệu', updated: '2026-06-28',
    summary: 'Đặt hàng, theo dõi giao nhận vật tư cho các công trình.',
    duties: ['Lập đơn mua hàng theo bóc tách QS', 'Theo dõi giao hàng, kiểm đếm tại kho', 'Cập nhật tồn kho vật tư'],
    requirements: ['1 năm kinh nghiệm mua hàng / kho', 'Thành thạo Excel'],
    benefits: ['Phụ cấp đi lại'] },
]
export const INITIAL_JOBS = [
  { id: 1, jdId: 1, title: 'Kỹ sư giám sát công trình', dept: 'thicong', qty: 2, site: 'Riverside — Tòa A', salary: '18–25 triệu', deadline: '2026-10-15', status: 'open', channels: ['LinkedIn', 'TopCV'], desc: 'Giám sát thi công kết cấu, nghiệm thu khối lượng, phối hợp tư vấn giám sát.' },
  { id: 2, jdId: 4, title: 'Kiến trúc sư thiết kế', dept: 'thietke', qty: 1, site: 'Văn phòng HCM', salary: '20–30 triệu', deadline: '2026-10-30', status: 'open', channels: ['LinkedIn', 'Website công ty'], desc: 'Thiết kế kiến trúc nhà ở, chung cư; triển khai hồ sơ bản vẽ thi công.' },
  { id: 3, jdId: 6, title: 'Nhân viên kinh doanh dự án', dept: 'kdda', qty: 2, site: 'Văn phòng HCM', salary: '12 triệu + hoa hồng', deadline: '2026-10-10', status: 'open', channels: ['TopCV', 'Facebook'], desc: 'Tìm kiếm khách hàng dự án dân dụng, chăm sóc & chốt hợp đồng.' },
  { id: 4, jdId: 8, title: 'Kế toán nội bộ', dept: 'tckt', qty: 1, site: 'Văn phòng HCM', salary: '13–16 triệu', deadline: '2026-09-30', status: 'paused', channels: ['VietnamWorks'], desc: 'Hạch toán chi phí công trình, đối chiếu công nợ nhà cung cấp.' },
]
export const INITIAL_CANDIDATES = [
  { id: 1, jobId: 1, name: 'Lê Hoàng Phúc', email: 'phuc.le@gmail.com', phone: '0903 112 334', source: 'LinkedIn', stage: 'interview', applied: '2026-09-05', cv: 'CV_LeHoangPhuc.pdf', exp: '5 năm giám sát kết cấu tại Coteccons',
    reviews: [{ by: 'Nguyễn Đức Anh', round: 'Vòng 1 — Chuyên môn', scores: { chuyenmon: 4, kinhnghiem: 5, giaotiep: 4, vanhoa: 4 }, note: 'Nắm chắc quy trình nghiệm thu, đọc bản vẽ tốt.', date: '2026-09-12' }] },
  { id: 2, jobId: 2, name: 'Phạm Thu Uyên', email: 'uyen.pt@gmail.com', phone: '0938 554 221', source: 'Giới thiệu nội bộ', stage: 'interview', applied: '2026-09-10', cv: 'Portfolio_PhamThuUyen.pdf', exp: '3 năm KTS tại studio thiết kế nhà phố', reviews: [] },
  { id: 3, jobId: 3, name: 'Ngô Bảo Châu', email: 'chau.ngo@gmail.com', phone: '0977 300 118', source: 'TopCV', stage: 'screening', applied: '2026-09-20', cv: 'CV_NgoBaoChau.pdf', exp: '2 năm sales BĐS', reviews: [] },
  { id: 4, jobId: 4, name: 'Đinh Gia Huy', email: 'huy.dinh@gmail.com', phone: '0912 888 607', source: 'VietnamWorks', stage: 'offer', applied: '2026-08-28', cv: 'CV_DinhGiaHuy.pdf', exp: '4 năm kế toán công trình',
    reviews: [{ by: 'Phan Bảo Ngọc', round: 'Vòng 2 — Trưởng phòng', scores: { chuyenmon: 5, kinhnghiem: 4, giaotiep: 4, vanhoa: 5 }, note: 'Phù hợp, đề xuất offer 15 triệu.', date: '2026-09-15' }] },
  { id: 5, jobId: 1, name: 'Trần Bảo Long', email: 'long.tran@gmail.com', phone: '0909 765 004', source: 'LinkedIn', stage: 'rejected', applied: '2026-08-20', cv: 'CV_TranBaoLong.pdf', exp: '1 năm hiện trường', reviews: [{ by: 'Nguyễn Đức Anh', round: 'Vòng 1 — Chuyên môn', scores: { chuyenmon: 2, kinhnghiem: 2, giaotiep: 3, vanhoa: 3 }, note: 'Chưa đủ kinh nghiệm cho vị trí.', date: '2026-08-28' }] },
  { id: 6, jobId: 1, name: 'Võ Minh Khoa', email: 'khoa.vo@gmail.com', phone: '0965 221 870', source: 'TopCV', stage: 'applied', applied: '2026-09-21', cv: 'CV_VoMinhKhoa.pdf', exp: '3 năm giám sát MEP', reviews: [] },
  { id: 7, jobId: 3, name: 'Huỳnh Ngọc Mai', email: 'mai.huynh@gmail.com', phone: '0988 140 551', source: 'Facebook', stage: 'applied', applied: '2026-09-22', cv: 'CV_HuynhNgocMai.pdf', exp: 'Mới tốt nghiệp, thực tập sales 6 tháng', reviews: [] },
  { id: 8, jobId: 2, name: 'Lâm Quốc Việt', email: 'viet.lam@gmail.com', phone: '0905 662 900', source: 'LinkedIn', stage: 'screening', applied: '2026-09-18', cv: 'CV_LamQuocViet.pdf', exp: '6 năm KTS, có chứng chỉ hành nghề', reviews: [] },
]
export const REVIEW_CRITERIA = [
  { key: 'chuyenmon', label: 'Chuyên môn' }, { key: 'kinhnghiem', label: 'Kinh nghiệm' },
  { key: 'giaotiep', label: 'Giao tiếp' }, { key: 'vanhoa', label: 'Phù hợp văn hoá' },
]
export const INITIAL_INTERVIEWS = [
  { id: 1, candidateId: 2, date: '2026-09-24', time: '09:30', round: 'Vòng 1 — Chuyên môn', interviewer: 'Trần Anh', mode: 'Trực tiếp', place: 'Phòng họp 2 — VP HCM' },
  { id: 2, candidateId: 1, date: '2026-09-24', time: '14:00', round: 'Vòng 2 — Ban giám đốc', interviewer: 'Cao Hưng', mode: 'Trực tiếp', place: 'Phòng họp 1 — VP HCM' },
  { id: 3, candidateId: 8, date: '2026-09-25', time: '10:00', round: 'Vòng 1 — Chuyên môn', interviewer: 'Trần Anh', mode: 'Online', place: 'meet.google.com/siteflow-kts' },
  { id: 4, candidateId: 3, date: '2026-09-26', time: '15:30', round: 'Vòng 1 — HR', interviewer: 'Ngô Mỹ Duyên', mode: 'Online', place: 'meet.google.com/siteflow-sales' },
]

/* ======================= HIỆU SUẤT & ĐÀO TẠO ======================= */
/* Kỳ mục tiêu: quý hiện tại, quý sau, cả năm (theo ngày thật, giờ VN). Đánh giá nhân sự theo quý hiện tại (REVIEW_PERIOD). */
export const PERIODS = (() => {
  const [y, m] = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).split('-').map(Number)
  const q = Math.ceil(m / 3)
  return [`Q${q}/${y}`, q === 4 ? `Q1/${y + 1}` : `Q${q + 1}/${y}`, `Năm ${y}`]
})()
export const REVIEW_PERIOD = PERIODS[0]
export const INITIAL_OKRS = [
  { id: 1, period: 'Q3/2026', title: 'Bàn giao đúng tiến độ dự án Riverside GĐ2', owner: 2, dept: 'cco',
    krs: [{ id: 11, title: 'Hoàn thành kết cấu phần thân tầng 1–5', target: 100, current: 72, unit: '%', owner: 6 },
      { id: 12, title: 'Số sự cố an toàn lao động', target: 0, current: 0, unit: 'vụ', owner: 10, inverse: true },
      { id: 13, title: 'Chi phí phát sinh ngoài dự toán', target: 3, current: 2.1, unit: '%', owner: 3, inverse: true }] },
  { id: 2, period: 'Q3/2026', title: 'Tăng trưởng doanh số khối dân dụng', owner: 23, dept: 'kddd',
    krs: [{ id: 21, title: 'Doanh số ký mới', target: 5, current: 3.6, unit: 'tỷ', owner: 23 },
      { id: 22, title: 'Số hợp đồng ký mới', target: 12, current: 9, unit: 'HĐ', owner: 16 }] },
  { id: 5, period: 'Q3/2026', title: 'Chuẩn hoá thiết kế trên nền tảng BIM', owner: 24, dept: 'thietke',
    krs: [{ id: 51, title: 'Tỷ lệ dự án mới triển khai bằng Revit', target: 100, current: 60, unit: '%', owner: 29 },
      { id: 52, title: 'Sai lệch khối lượng QS từ mô hình', target: 3, current: 4.2, unit: '%', owner: 30, inverse: true }] },
  { id: 3, period: 'Q3/2026', title: 'Nâng cao nhận diện thương hiệu SiteFlow', owner: 5, dept: 'marketing',
    krs: [{ id: 31, title: 'Lead từ kênh digital', target: 300, current: 214, unit: 'lead', owner: 5 },
      { id: 32, title: 'Video dự án xuất bản', target: 8, current: 6, unit: 'video', owner: 14 }] },
  { id: 4, period: 'Q3/2026', title: 'Chuẩn hoá vận hành nhân sự', owner: 4, dept: 'hcns',
    krs: [{ id: 41, title: 'Thời gian tuyển dụng trung bình', target: 30, current: 34, unit: 'ngày', owner: 4, inverse: true },
      { id: 42, title: 'Tỷ lệ nhân sự hoàn thành đào tạo bắt buộc', target: 100, current: 85, unit: '%', owner: 20 }] },
]
export const REVIEW_SKILLS = [
  { key: 'kq', label: 'Kết quả công việc', weight: 40 }, { key: 'cm', label: 'Năng lực chuyên môn', weight: 25 },
  { key: 'pp', label: 'Phối hợp & giao tiếp', weight: 15 }, { key: 'kl', label: 'Kỷ luật & chuyên cần', weight: 10 },
  { key: 'pt', label: 'Chủ động & phát triển', weight: 10 },
]
export const REVIEW_STATES = {
  todo: { label: 'Chưa bắt đầu', tone: 'muted' }, self: { label: 'Chờ tự đánh giá', tone: 'finance' },
  manager: { label: 'Chờ quản lý đánh giá', tone: 'primary' }, done: { label: 'Hoàn tất', tone: 'success' },
}
/* Đợt đánh giá Q3/2026 — một vài nhân sự đã có điểm */
export const INITIAL_REVIEWS = {
  9: { state: 'done', self: { kq: 4, cm: 4, pp: 4, kl: 5, pt: 3 }, mgr: { kq: 4, cm: 4, pp: 3, kl: 5, pt: 4 }, selfNote: 'Hoàn thành giám sát tầng 1–3 đúng hạn.', mgrNote: 'Cần chủ động báo cáo sớm các vướng mắc.' },
  11: { state: 'manager', self: { kq: 5, cm: 4, pp: 4, kl: 4, pt: 4 }, selfNote: 'Đội A vượt tiến độ đổ bê tông 3 ngày.' },
  12: { state: 'self' }, 10: { state: 'self' },
  13: { state: 'done', self: { kq: 4, cm: 5, pp: 4, kl: 4, pt: 4 }, mgr: { kq: 5, cm: 5, pp: 4, kl: 4, pt: 5 }, selfNote: 'Hoàn thành bộ nhận diện dự án mới.', mgrNote: 'Xuất sắc, đề xuất tăng lương.' },
}
export const COURSES = [
  { id: 1, title: 'An toàn lao động nhóm 3', category: 'Bắt buộc', hours: 16, format: 'Trực tiếp', mandatory: true, tone: 'danger' },
  { id: 2, title: 'Quy trình nghiệm thu nội bộ', category: 'Chuyên môn', hours: 6, format: 'E-learning', mandatory: false, tone: 'primary' },
  { id: 3, title: 'BIM cơ bản với Revit', category: 'Công nghệ', hours: 24, format: 'Blended', mandatory: false, tone: 'qs' },
  { id: 4, title: 'Văn hoá & quy chế SiteFlow', category: 'Hội nhập', hours: 3, format: 'E-learning', mandatory: true, tone: 'attendance' },
  { id: 5, title: 'Kỹ năng đàm phán hợp đồng', category: 'Kỹ năng mềm', hours: 8, format: 'Trực tiếp', mandatory: false, tone: 'finance' },
  { id: 6, title: 'Quản lý dự án theo chuẩn PMI', category: 'Quản lý', hours: 32, format: 'Blended', mandatory: false, tone: 'success' },
]
export const LEARNING_PATHS = [
  { id: 1, title: 'Kỹ sư công trường mới', courses: [4, 1, 2, 3], for: 'Thi công · 0–6 tháng' },
  { id: 2, title: 'Nhân viên kinh doanh mới', courses: [4, 5], for: 'Kinh doanh · 0–3 tháng' },
  { id: 3, title: 'Phát triển quản lý cấp trung', courses: [6, 5, 2], for: 'Trưởng nhóm trở lên' },
]
/* Ghi danh: empId → { courseId: tiến độ % } */
export const INITIAL_ENROLL = {
  1: { 4: 100, 1: 100, 6: 100 }, 2: { 4: 100, 1: 100, 6: 100, 3: 70 }, 3: { 4: 100, 1: 100 }, 4: { 4: 100, 1: 100 }, 5: { 4: 100, 1: 60 },
  6: { 4: 100, 1: 100, 2: 100, 6: 60 }, 7: { 4: 100, 1: 100, 5: 100, 6: 20 }, 8: { 4: 100, 1: 100 }, 9: { 4: 100, 1: 100, 2: 80 }, 10: { 4: 100, 1: 40 },
  11: { 4: 100, 1: 100, 3: 30 }, 12: { 4: 100, 1: 100 }, 13: { 4: 100, 1: 100, 3: 15 }, 14: { 4: 100, 1: 100 }, 15: { 4: 50 }, 16: { 4: 100, 1: 100, 5: 100 },
  17: { 4: 100, 1: 100, 3: 55 }, 18: { 4: 100, 1: 80 }, 19: { 4: 100, 1: 100 }, 20: { 4: 100, 1: 100 },
}

/* ======================= ĐỊNH PHÍ THEO PHÒNG BAN =======================
   fund: quỹ lương kế hoạch / tháng (gồm lương, phụ cấp, BH công ty đóng) · items: định phí khác cố định hằng tháng */
const M = 1000000
export const INITIAL_FIXED_COSTS = {
  hdqt: { fund: 20 * M, items: [{ name: 'Thù lao thành viên HĐQT độc lập', amount: 20 * M }] },
  ceo: { fund: 75 * M, items: [{ name: 'Xe công vụ & tài xế', amount: 15 * M }] },
  bod: { fund: 15 * M, items: [{ name: 'Chi phí họp điều hành định kỳ', amount: 3 * M }] },
  bks: { fund: 25 * M, items: [{ name: 'Thù lao kiểm soát viên độc lập', amount: 10 * M }] },
  bcl: { fund: 25 * M, items: [{ name: 'Tư vấn chiến lược (phân bổ)', amount: 12 * M }] },
  coo: { fund: 65 * M, items: [] },
  cco: { fund: 70 * M, items: [] },
  kddd: { fund: 55 * M, items: [{ name: 'Thuê showroom nhà mẫu', amount: 20 * M }] },
  marketing: { fund: 90 * M, items: [{ name: 'Quảng cáo cố định (SEO, fanpage)', amount: 30 * M }, { name: 'Công cụ thiết kế & quản lý mạng xã hội', amount: 5 * M }] },
  rnd: { fund: 30 * M, items: [{ name: 'Phòng thí nghiệm vật liệu', amount: 12 * M }] },
  hcns: { fund: 95 * M, items: [{ name: 'Thuê văn phòng HCM (phân bổ)', amount: 60 * M }, { name: 'Phần mềm HR & chấm công', amount: 4 * M }] },
  tckt: { fund: 95 * M, items: [{ name: 'Phần mềm kế toán', amount: 3 * M }, { name: 'Kiểm toán báo cáo tài chính (phân bổ)', amount: 10 * M }] },
  thietke: { fund: 110 * M, items: [{ name: 'Bản quyền Autodesk (Revit, AutoCAD)', amount: 18 * M }, { name: 'Khấu hao máy trạm', amount: 6 * M }] },
  muahang: { fund: 60 * M, items: [{ name: 'Thuê kho Bình Chánh', amount: 35 * M }] },
  qs: { fund: 60 * M, items: [{ name: 'Phần mềm dự toán', amount: 4 * M }] },
  it: { fund: 45 * M, items: [{ name: 'Hosting, SaaS & tên miền', amount: 15 * M }, { name: 'Bảo trì hạ tầng mạng', amount: 8 * M }] },
  kdda: { fund: 75 * M, items: [{ name: 'Hồ sơ năng lực & dự thầu', amount: 8 * M }] },
  thicong: { fund: 200 * M, items: [{ name: 'Thuê lán trại công trường', amount: 25 * M }, { name: 'Khấu hao máy thi công', amount: 40 * M }, { name: 'Bảo hiểm công trình', amount: 12 * M }] },
  haumai: { fund: 40 * M, items: [{ name: 'Kho vật tư bảo hành', amount: 6 * M }] },
}
