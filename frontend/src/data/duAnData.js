/* Dữ liệu mẫu & tiện ích cho trang Quản lý dự án (du-an.html) */

export const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })() // hôm nay (00:00), trước là mốc cố định 21/09/2026

export const INITIAL_PHASES = [
  { id: 'p1', name: 'Chuẩn bị & xin phép', members: [
      { name: 'Trần Văn Minh', role: 'Kỹ sư trưởng' },
      { name: 'Lê Thị Hoa', role: 'Pháp lý' },
    ], tasks: [
    { id: 't1', name: 'Khảo sát địa chất & hiện trạng', start: '2026-08-01', end: '2026-08-08', progress: 100, assignee: 'Phòng kỹ thuật', critical: false },
    { id: 't2', name: 'Lập hồ sơ thiết kế cơ sở', start: '2026-08-05', end: '2026-08-20', progress: 100, assignee: 'Tư vấn thiết kế', critical: true },
    { id: 't3', name: 'Xin giấy phép xây dựng', start: '2026-08-15', end: '2026-09-01', progress: 100, assignee: 'Bộ phận pháp lý', critical: true },
    { id: 'm1', name: 'Khởi công', start: '2026-09-01', end: '2026-09-01', milestone: true, progress: 100, assignee: 'Ban chỉ huy công trường' },
  ] },
  { id: 'p2', name: 'Thi công phần móng', members: [
      { name: 'Nguyễn Đức Anh', role: 'Chỉ huy trưởng' },
      { name: 'Phạm Quốc Bảo', role: 'Đội thi công A' },
      { name: 'Đỗ Thành Long', role: 'Tư vấn giám sát' },
    ], tasks: [
    { id: 't4', name: 'San lấp mặt bằng', start: '2026-09-01', end: '2026-09-08', progress: 100, assignee: 'Đội thi công A', critical: false },
    { id: 't5', name: 'Ép cọc & gia cố nền', start: '2026-09-05', end: '2026-09-12', progress: 100, assignee: 'Đội thi công A', critical: true },
    { id: 't6', name: 'Đổ bê tông đài móng', start: '2026-09-14', end: '2026-09-28', progress: 45, assignee: 'Đội thi công B', critical: true },
    { id: 't7', name: 'Nghiệm thu phần móng', start: '2026-09-26', end: '2026-10-02', progress: 0, assignee: 'Tư vấn giám sát', critical: true },
  ] },
  { id: 'p3', name: 'Thi công phần thân (kết cấu)', members: [
      { name: 'Nguyễn Đức Anh', role: 'Chỉ huy trưởng' },
      { name: 'Vũ Hải Nam', role: 'Đội thi công B' },
      { name: 'Trịnh Xuân Sơn', role: 'Đội thi công C' },
    ], tasks: [
    { id: 't8', name: 'Đổ cột & vách tầng 1–5', start: '2026-09-28', end: '2026-10-20', progress: 0, assignee: 'Đội thi công B', critical: true },
    { id: 't9', name: 'Đổ sàn tầng 1–5', start: '2026-10-10', end: '2026-11-05', progress: 0, assignee: 'Đội thi công B', critical: false },
    { id: 't10', name: 'Đổ cột & vách tầng 6–10', start: '2026-11-05', end: '2026-11-25', progress: 0, assignee: 'Đội thi công C', critical: true },
    { id: 't11', name: 'Đổ sàn tầng 6–10', start: '2026-11-20', end: '2026-12-15', progress: 0, assignee: 'Đội thi công C', critical: false },
    { id: 'm2', name: 'Cất nóc', start: '2026-12-15', end: '2026-12-15', milestone: true, progress: 0, assignee: 'Ban chỉ huy công trường' },
  ] },
  { id: 'p4', name: 'Hoàn thiện & lắp đặt MEP', members: [
      { name: 'Hoàng Gia Bảo', role: 'Đội hoàn thiện' },
      { name: 'Ngô Thị Lan', role: 'Đội MEP' },
    ], tasks: [
    { id: 't12', name: 'Xây tường bao che', start: '2026-12-01', end: '2026-12-20', progress: 0, assignee: 'Đội hoàn thiện', critical: false },
    { id: 't13', name: 'Lắp đặt điện nước (MEP thô)', start: '2026-12-10', end: '2027-01-05', progress: 0, assignee: 'Đội MEP', critical: true },
    { id: 't14', name: 'Trát tường & sơn bả', start: '2026-12-20', end: '2027-01-15', progress: 0, assignee: 'Đội hoàn thiện', critical: true },
    { id: 't15', name: 'Lắp thiết bị vệ sinh & nội thất', start: '2027-01-05', end: '2027-01-25', progress: 0, assignee: 'Đội hoàn thiện', critical: false },
  ] },
  { id: 'p5', name: 'Nghiệm thu & bàn giao', members: [
      { name: 'Đỗ Thành Long', role: 'Tư vấn giám sát' },
      { name: 'Bùi Minh Khuê', role: 'Phòng QLCL' },
    ], tasks: [
    { id: 't16', name: 'Nghiệm thu PCCC', start: '2027-01-20', end: '2027-01-28', progress: 0, assignee: 'Phòng QLCL', critical: false },
    { id: 't17', name: 'Nghiệm thu hoàn công', start: '2027-01-25', end: '2027-02-05', progress: 0, assignee: 'Tư vấn giám sát', critical: true },
    { id: 'm3', name: 'Bàn giao dự án', start: '2027-02-10', end: '2027-02-10', milestone: true, progress: 0, assignee: 'Ban chỉ huy công trường' },
  ] },
  { id: 'p6', name: 'Mua hàng & cung ứng', members: [
      { name: 'Cao Nhật Tân', role: 'Trưởng phòng mua hàng' },
      { name: 'Lý Thu Trang', role: 'Nhân viên cung ứng' },
    ], tasks: [
    { id: 'pu1', name: 'Đặt hàng thép & xi măng', start: '2026-08-20', end: '2026-09-05', progress: 100, assignee: 'Lý Thu Trang', critical: false },
    { id: 'pu2', name: 'Nhập vật tư đợt 1 (móng)', start: '2026-09-01', end: '2026-09-10', progress: 100, assignee: 'Lý Thu Trang', critical: true },
    { id: 'pu3', name: 'Đặt hàng thép kết cấu tầng cao', start: '2026-09-20', end: '2026-10-08', progress: 35, assignee: 'Cao Nhật Tân', critical: true },
    { id: 'pu4', name: 'Đặt hàng thiết bị MEP', start: '2026-10-15', end: '2026-11-15', progress: 0, assignee: 'Cao Nhật Tân', critical: false },
    { id: 'pu5', name: 'Nhập vật tư hoàn thiện (sơn, gạch)', start: '2026-12-01', end: '2026-12-25', progress: 0, assignee: 'Lý Thu Trang', critical: false },
    { id: 'pu6', name: 'Nhập thiết bị nội thất & vệ sinh', start: '2027-01-05', end: '2027-01-20', progress: 0, assignee: 'Lý Thu Trang', critical: false },
  ] },
  { id: 'p7', name: 'Tài chính — dòng tiền', members: [
      { name: 'Phan Bảo Ngọc', role: 'Kế toán trưởng' },
      { name: 'Trịnh Anh Thư', role: 'Kiểm soát ngân sách' },
    ], tasks: [
    { id: 'f1', name: 'Thu tiền đợt 1 (30% hợp đồng)', planStart: '2026-08-05', start: '2026-08-10', end: '2026-08-10', milestone: true, finType: 'thu', amount: '3,6 tỷ', amountValue: 3600, assignee: 'Phan Bảo Ngọc' },
    { id: 'f2', name: 'Chi tạm ứng nhà thầu móng', planStart: '2026-09-01', start: '2026-09-03', end: '2026-09-03', milestone: true, finType: 'chi', amount: '1,2 tỷ', amountValue: 1200, assignee: 'Trịnh Anh Thư' },
    { id: 'f3', name: 'Chi mua vật tư đợt 1', planStart: '2026-09-08', start: '2026-09-08', end: '2026-09-08', milestone: true, finType: 'chi', amount: '850 triệu', amountValue: 850, assignee: 'Trịnh Anh Thư' },
    { id: 'f4', name: 'Thu tiền đợt 2 (30% hợp đồng)', planStart: '2026-09-28', start: '2026-10-05', end: '2026-10-05', milestone: true, finType: 'thu', amount: '3,6 tỷ', amountValue: 3600, assignee: 'Phan Bảo Ngọc' },
    { id: 'f5', name: 'Chi thanh toán nhà thầu kết cấu', planStart: '2026-11-15', start: '2026-11-20', end: '2026-11-20', milestone: true, finType: 'chi', amount: '2,4 tỷ', amountValue: 2400, assignee: 'Trịnh Anh Thư' },
    { id: 'f6', name: 'Chi mua thiết bị MEP & hoàn thiện', planStart: '2026-12-20', start: '2026-12-28', end: '2026-12-28', milestone: true, finType: 'chi', amount: '1,8 tỷ', amountValue: 1800, assignee: 'Trịnh Anh Thư' },
    { id: 'f7', name: 'Thu tiền đợt 3 (30% hợp đồng)', planStart: '2027-01-10', start: '2027-01-10', end: '2027-01-10', milestone: true, finType: 'thu', amount: '3,6 tỷ', amountValue: 3600, assignee: 'Phan Bảo Ngọc', confirmed: false },
    { id: 'f8', name: 'Thu tiền đợt cuối & bàn giao (10%)', planStart: '2027-02-05', start: '2027-02-12', end: '2027-02-12', milestone: true, finType: 'thu', amount: '1,2 tỷ', amountValue: 1200, assignee: 'Phan Bảo Ngọc', confirmed: false },
  ] },
  { id: 'p8', name: 'Nhân sự & an toàn lao động', members: [
      { name: 'Đặng Hữu Phúc', role: 'Phụ trách nhân sự' },
      { name: 'Vũ Thị Diệu', role: 'An toàn lao động' },
    ], tasks: [
    { id: 'h1', name: 'Tuyển dụng bổ sung công nhân', start: '2026-08-25', end: '2026-09-10', progress: 100, assignee: 'Đặng Hữu Phúc', critical: false },
    { id: 'h2', name: 'Đào tạo an toàn lao động đầu dự án', start: '2026-09-01', end: '2026-09-05', progress: 100, assignee: 'Vũ Thị Diệu', critical: true },
    { id: 'h3', name: 'Kiểm tra an toàn định kỳ — phần móng', start: '2026-09-14', end: '2026-09-20', progress: 70, assignee: 'Vũ Thị Diệu', critical: false },
    { id: 'h4', name: 'Kiểm tra an toàn định kỳ — kết cấu', start: '2026-10-15', end: '2026-10-20', progress: 0, assignee: 'Vũ Thị Diệu', critical: false },
    { id: 'h5', name: 'Huấn luyện PCCC & thoát hiểm', start: '2026-11-01', end: '2026-11-05', progress: 0, assignee: 'Vũ Thị Diệu', critical: false },
    { id: 'h6', name: 'Đánh giá an toàn trước nghiệm thu', start: '2027-01-15', end: '2027-01-22', progress: 0, assignee: 'Vũ Thị Diệu', critical: true },
  ] },
]

/* ---------- Tiện ích ngày tháng ---------- */
export function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export function dayDiff(a, b) { return Math.round((b - a) / 86400000) }
export function fmt(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` }
export function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export function fmtFull(d) { return `${fmt(d)}/${d.getFullYear()}` }

/* Khung thời gian của timeline — tính một lần từ dữ liệu gốc (giống bản HTML) */
const allStarts = INITIAL_PHASES.flatMap(p => p.tasks.map(t => parseD(t.start)))
const allEnds = INITIAL_PHASES.flatMap(p => p.tasks.map(t => parseD(t.end)))
export const RANGE_START = new Date(Math.min(...allStarts)); RANGE_START.setDate(RANGE_START.getDate() - 6)
export const RANGE_END = new Date(Math.max(...allEnds)); RANGE_END.setDate(RANGE_END.getDate() + 8)
export const TOTAL_DAYS = dayDiff(RANGE_START, RANGE_END)

export function statusOf(t) {
  if (t.finType) return parseD(t.start) <= TODAY ? 'done' : 'notstarted'
  if (t.milestone) return t.progress >= 100 ? 'done' : (parseD(t.start) < TODAY ? 'overdue' : 'notstarted')
  if (t.progress >= 100) return 'done'
  if (parseD(t.end) < TODAY && t.progress < 100) return 'overdue'
  if (parseD(t.start) <= TODAY) return 'progress'
  return 'notstarted'
}
export const STATUS_LABEL = { done: 'Hoàn thành', progress: 'Đang thực hiện', overdue: 'Trễ hạn', notstarted: 'Chưa bắt đầu' }

/* ---------- Avatar ---------- */
const AVATAR_COLORS = ['#2F5DA8', '#2f9160', '#b87a1f', '#7658c2', '#c1443c', '#0E8A82', '#c26fb0', '#6e8fd0']
export function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
export function initials(name) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/* ---------- Bình luận & @mention ---------- */
export const ME_NAME = 'Trần Anh'
export const MEMBERS = ['Trần Anh', 'Nguyễn Đức Anh', 'Lê Thị Hoa', 'Phạm Quốc Bảo', 'Đỗ Thành Long',
  'Vũ Hải Nam', 'Trịnh Xuân Sơn', 'Hoàng Gia Bảo', 'Ngô Thị Lan', 'Bùi Minh Khuê',
  'Cao Nhật Tân', 'Lý Thu Trang', 'Đặng Hữu Phúc', 'Vũ Thị Diệu', 'Ngọc Hà', 'Lê Văn']

export const INITIAL_COMMENTS = {
  t6: [
    { who: 'Nguyễn Đức Anh', time: '08:02', text: 'Team chú ý tiến độ đài móng đang chậm, cần bổ sung nhân lực ca chiều.' },
    { who: 'Ngọc Hà', time: '09:15', text: 'Dạ em đã yêu cầu thêm 2 nhân sự từ Đội thi công A, dự kiến bù kịp trong 2 ngày. @Lê Văn hỗ trợ điều phối giúp em.' },
    { who: 'Lê Văn', time: '09:20', text: 'Vâng chị, em sắp xếp ngay ạ.' },
  ],
  t3: [
    { who: 'Lê Thị Hoa', time: 'Hôm qua', text: 'Hồ sơ xin phép đã nộp Sở Xây dựng, dự kiến có kết quả trong tuần. @Nguyễn Đức Anh anh xem giúp em bản vẽ đính kèm.' },
  ],
}

export const CASHFLOW_DATA = { income: 1.85, expense: 1.42 }
export function fmtTyQ(v) { return v.toFixed(2).replace(/0$/, '').replace(/\.$/, '') + ' tỷ' }

/* ---------- Dự án ---------- */
export const PROJECT_SHORTLIST = [
  { name: 'Chung cư Riverside — Giai đoạn 2', sub: 'Chung cư · Đang thi công', hasData: true },
  { name: 'Nhà phố Lô B12 — KDC Bình Chánh', sub: 'Nhà phố · Đang thi công', hasData: false },
  { name: 'Biệt thự Song lập — Thảo Điền', sub: 'Biệt thự · Bản nháp', hasData: false },
  { name: 'Văn phòng cho thuê — Q3', sub: 'Văn phòng · Hoàn tất', hasData: false },
]

/* Danh sách dự án (tab "Danh sách dự án") */
export const PROJECT_ROWS = [
  { name: 'Chung cư Riverside — Giai đoạn 2', client: 'Công ty CP Đầu tư Riverside', type: 'Chung cư', budget: '8.50 tỷ', progress: 58, barColor: 'var(--primary)', status: 'Đang thi công', statusBg: 'var(--primary-tint)', statusColor: 'var(--primary)', goto: 'detail' },
  { name: 'Nhà phố Lô B12 — KDC Bình Chánh', client: 'Anh Quang Huy', type: 'Nhà phố', budget: '2.10 tỷ', progress: 27, barColor: 'var(--game)', status: 'Đang thi công', statusBg: 'var(--primary-tint)', statusColor: 'var(--primary)' },
  { name: 'Biệt thự Song lập — Thảo Điền', client: 'Chị Minh Thư', type: 'Biệt thự', budget: '6.80 tỷ (dự kiến)', budgetMuted: true, progress: 0, status: 'Bản nháp', statusBg: 'var(--surface-alt)', statusColor: 'var(--text-muted)' },
  { name: 'Văn phòng cho thuê — Q3', client: 'Cty TNHH ABC Logistics', type: 'Văn phòng', budget: '4.20 tỷ', progress: 100, barColor: 'var(--success)', status: 'Hoàn tất', statusBg: 'var(--success-tint)', statusColor: 'var(--success)' },
]

export const PROJ_DEPTS = [
  { value: 'general', label: 'Ban chỉ huy công trường' },
  { value: 'kinh-doanh', label: 'Kinh doanh' },
  { value: 'qs', label: 'QS' },
  { value: 'qldth', label: 'Quản lý dự án (Tiến độ)' },
  { value: 'hr', label: 'HR / Chấm công' },
  { value: 'tai-chinh', label: 'Tài chính' },
  { value: 'ban-co-van', label: 'Ban cố vấn' },
  { value: 'ban-kiem-soat', label: 'Ban kiểm soát' },
  { value: 'chu-tri', label: 'Chủ trì thiết kế' },
  { value: 'concept', label: 'Thiết kế concept' },
  { value: '3d', label: '3D' },
  { value: '2d', label: '2D' },
]
export const AUTO_INCLUDE_DEPTS = ['chat', 'nhiem-vu']

export const INITIAL_PROJECT_MEMBERS = {
  'Chung cư Riverside — Giai đoạn 2': [
    { name: 'Trần Anh', role: 'PM công trường', dept: 'general' },
    { name: 'Nguyễn Đức Anh', role: 'Chỉ huy trưởng', dept: 'qldth' },
    { name: 'Đỗ Thành Long', role: 'Tư vấn giám sát', dept: 'qldth' },
  ],
  'Nhà phố Lô B12 — KDC Bình Chánh': [
    { name: 'Trần Anh', role: 'PM công trường', dept: 'general' },
  ],
  'Biệt thự Song lập — Thảo Điền': [],
  'Văn phòng cho thuê — Q3': [
    { name: 'Trần Anh', role: 'PM công trường', dept: 'general' },
  ],
}

export const DETAIL_PROJECT_DATA = {
  'Chung cư Riverside — Giai đoạn 2': {
    status: 'Đang thi công', statusColor: 'primary',
    client: 'Công ty CP Đầu tư Riverside', contact: 'Ông Nguyễn Văn Bình', phone: '0909 123 456', email: 'contact@riverside-invest.vn',
    budget: '8.50 tỷ', hasData: true,
  },
  'Nhà phố Lô B12 — KDC Bình Chánh': {
    status: 'Đang thi công', statusColor: 'primary',
    client: 'Anh Quang Huy', contact: '—', phone: '—', email: '—',
    budget: '2.10 tỷ', hasData: false,
  },
  'Biệt thự Song lập — Thảo Điền': {
    status: 'Bản nháp', statusColor: 'muted',
    client: 'Chị Minh Thư', contact: '—', phone: '—', email: '—',
    budget: '6.80 tỷ (dự kiến)', hasData: false,
  },
  'Văn phòng cho thuê — Q3': {
    status: 'Hoàn tất', statusColor: 'success',
    client: 'Cty TNHH ABC Logistics', contact: '—', phone: '—', email: '—',
    budget: '4.20 tỷ', hasData: false,
  },
}
export const DETAIL_STATUS_COLORS = {
  primary: ['var(--primary-tint)', 'var(--primary)'],
  success: ['var(--success-tint)', 'var(--success)'],
  muted: ['var(--surface-alt)', 'var(--text-muted)'],
}

/* ---------- Sơ đồ tổ chức ---------- */
export const ORG_ICON = {
  design: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/>',
  advisory: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  control: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  concept: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  dept: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
}
export const ORG_HUB = { dept: 'chu-tri', label: 'Chủ trì thiết kế', color: 'project', icon: ORG_ICON.design }
export const INITIAL_ORG_PARALLEL = [
  { dept: 'ban-co-van', label: 'Ban cố vấn', color: 'attendance', icon: ORG_ICON.advisory, dashed: true, caption: 'Song song · không thuộc quyền', removable: false },
  { dept: 'ban-kiem-soat', label: 'Ban kiểm soát', color: 'danger', icon: ORG_ICON.control, dashed: true, caption: 'Song song · không thuộc quyền', removable: false },
]
export const INITIAL_ORG_CHILDREN = [
  { dept: 'concept', label: 'Thiết kế concept', color: 'game', icon: ORG_ICON.concept, removable: false },
  { dept: '3d', label: '3D', color: 'qs', icon: ORG_ICON.cube, removable: false },
  { dept: '2d', label: '2D', color: 'sales', icon: ORG_ICON.grid, removable: false },
]
export const ORG_EXTRA_COLORS = ['primary', 'qs', 'sales', 'game', 'finance', 'attendance', 'danger']

/* ---------- Thầu phụ ---------- */
export const INITIAL_SUBCONTRACTORS = [
  { name: 'Công ty Cơ điện Phúc An', scope: 'Thi công M&E (điện, nước, HVAC)', contact: 'Anh Hùng', phone: '0909 456 789', value: '1.850.000.000', status: 'active' },
  { name: 'Công ty Nhôm kính Sài Gòn', scope: 'Cửa nhôm kính, vách mặt dựng', contact: 'Chị Lan', phone: '0918 223 344', value: '620.000.000', status: 'active' },
  { name: 'Xưởng nội thất Gia Bảo', scope: 'Nội thất, tủ bếp gỗ', contact: 'Anh Bảo', phone: '0938 771 209', value: '980.000.000', status: 'pending' },
  { name: 'Công ty PCCC An Toàn Việt', scope: 'Hệ thống phòng cháy chữa cháy', contact: 'Anh Khoa', phone: '0912 556 880', value: '340.000.000', status: 'done' },
]
export const SUB_STATUS_LABEL = {
  active: ['Đang thi công', 'var(--project)', 'var(--project-tint)'],
  pending: ['Chờ ký hợp đồng', 'var(--overdue)', 'var(--overdue-soft)'],
  done: ['Hoàn thành', 'var(--done)', 'rgba(60,160,110,.14)'],
}

/* ---------- Nhiệm vụ & điểm thưởng ---------- */
export const LEADERBOARD = [
  { name: 'Lê Văn', team: 'Đội thi công A', color: '#0E8A82', week: 180, total: 1240 },
  { name: 'Ngọc Hà', team: 'Đội thi công B', color: '#B7791F', week: 150, total: 1180 },
  { name: 'Phạm Quốc Bảo', team: 'Đội thi công A', color: '#2F5DA8', week: 120, total: 990 },
  { name: 'Vũ Hải Nam', team: 'Đội thi công B', color: '#2F5DA8', week: 90, total: 860 },
  { name: 'Cao Nhật Tân', team: 'Mua hàng', color: '#C0392B', week: 70, total: 740 },
  { name: 'Lý Thu Trang', team: 'Cung ứng', color: '#C2618F', week: 60, total: 690 },
  { name: 'Đặng Hữu Phúc', team: 'Nhân sự', color: '#0E8A82', week: 40, total: 520 },
  { name: 'Hoàng Gia Bảo', team: 'Đội hoàn thiện', color: '#7658C2', week: 30, total: 480 },
]
export function medal(rank) {
  if (rank === 1) return { bg: 'var(--gold-tint)', color: 'var(--gold)' }
  if (rank === 2) return { bg: 'var(--silver-tint)', color: 'var(--silver)' }
  if (rank === 3) return { bg: 'var(--bronze-tint)', color: 'var(--bronze)' }
  return { bg: 'var(--surface-alt)', color: 'var(--text-muted)' }
}

export const INITIAL_STEPS = [
  { title: 'Khảo sát địa chất & hiện trạng', status: 'done', subtasks: [
    { text: 'Khảo sát địa chất', who: 'Phòng kỹ thuật', pts: 20, done: true },
    { text: 'Đo đạc hiện trạng khu đất', who: 'Phòng kỹ thuật', pts: 20, done: true },
    { text: 'Lập báo cáo khảo sát', who: 'Phòng kỹ thuật', pts: 20, done: true },
  ] },
  { title: 'Xin giấy phép xây dựng', status: 'done', subtasks: [
    { text: 'Soạn hồ sơ xin phép', who: 'Bộ phận pháp lý', pts: 20, done: true },
    { text: 'Nộp hồ sơ Sở Xây dựng', who: 'Bộ phận pháp lý', pts: 20, done: true },
    { text: 'Nhận giấy phép xây dựng', who: 'Bộ phận pháp lý', pts: 20, done: true },
  ] },
  { title: 'Chuẩn bị mặt bằng & rào chắn công trình', status: 'done', subtasks: [
    { text: 'Dọn dẹp mặt bằng', who: 'Đội thi công A', pts: 20, done: true },
    { text: 'Dựng hàng rào tôn công trình', who: 'Đội thi công A', pts: 20, done: true },
    { text: 'Lắp biển báo an toàn', who: 'Vũ Thị Diệu', pts: 20, done: true },
  ] },
  { title: 'Ép cọc / gia cố nền móng', status: 'done', subtasks: [
    { text: 'Tập kết cọc bê tông', who: 'Đội thi công A', pts: 30, done: true },
    { text: 'Ép cọc theo bản vẽ', who: 'Đội thi công A', pts: 30, done: true },
    { text: 'Nghiệm thu độ sâu ép cọc', who: 'Đỗ Thành Long', pts: 30, done: true },
  ] },
  { title: 'Đào đất, đổ bê tông lót móng', status: 'current', subtasks: [
    { text: 'Đào đất hố móng theo bản vẽ', who: 'Đội thi công A', pts: 30, done: true },
    { text: 'Kiểm tra cao độ đáy móng', who: 'Đỗ Thành Long', pts: 30, done: true },
    { text: 'Đổ bê tông lót móng mác 100', who: 'Đội thi công A', pts: 30, done: false },
  ] },
  { title: 'Thi công đài móng, giằng móng', status: 'locked', subtasks: [
    { text: 'Lắp cốt thép đài móng', who: 'Đội thi công B', pts: 30, done: false },
    { text: 'Lắp cốp pha đài, giằng móng', who: 'Đội thi công B', pts: 30, done: false },
    { text: 'Đổ bê tông đài, giằng móng', who: 'Đội thi công B', pts: 30, done: false },
  ] },
  { title: 'Thi công cột, dầm, sàn tầng trệt', status: 'locked', subtasks: [
    { text: 'Lắp cốt thép cột, dầm, sàn', who: 'Đội thi công B', pts: 40, done: false },
    { text: 'Lắp cốp pha', who: 'Đội thi công B', pts: 40, done: false },
    { text: 'Đổ bê tông, bảo dưỡng', who: 'Đội thi công B', pts: 40, done: false },
  ] },
  { title: 'Xây tường bao tầng trệt', status: 'locked', subtasks: [
    { text: 'Xây tường 200 bao ngoài', who: 'Đội thi công A', pts: 30, done: false },
    { text: 'Xây tường 100 ngăn phòng', who: 'Đội thi công A', pts: 30, done: false },
  ] },
  { title: 'Thi công cột, dầm, sàn các tầng lầu', status: 'locked', subtasks: [
    { text: 'Lắp cốt thép cột, dầm, sàn các lầu', who: 'Đội thi công C', pts: 50, done: false },
    { text: 'Lắp cốp pha các lầu', who: 'Đội thi công C', pts: 50, done: false },
    { text: 'Đổ bê tông, bảo dưỡng các lầu', who: 'Đội thi công C', pts: 50, done: false },
  ] },
  { title: 'Xây tường bao các tầng lầu', status: 'locked', subtasks: [
    { text: 'Xây tường bao ngoài các lầu', who: 'Đội thi công A', pts: 45, done: false },
    { text: 'Xây tường ngăn phòng các lầu', who: 'Đội thi công A', pts: 45, done: false },
  ] },
  { title: 'Thi công mái', status: 'locked', subtasks: [
    { text: 'Lắp cốt thép, cốp pha sàn mái', who: 'Đội thi công C', pts: 40, done: false },
    { text: 'Đổ bê tông sàn mái / lợp mái', who: 'Đội thi công C', pts: 40, done: false },
    { text: 'Chống thấm sàn mái', who: 'Đội thi công C', pts: 40, done: false },
  ] },
  { title: 'Lắp đặt điện nước âm tường (M&E thô)', status: 'locked', subtasks: [
    { text: 'Đi ống điện âm tường, âm sàn', who: 'Đội MEP', pts: 40, done: false },
    { text: 'Đi ống cấp thoát nước âm tường', who: 'Đội MEP', pts: 40, done: false },
    { text: 'Nghiệm thu M&E thô trước khi tô trát', who: 'Đỗ Thành Long', pts: 40, done: false },
  ] },
  { title: 'Tô trát, chống thấm', status: 'locked', subtasks: [
    { text: 'Tô trát tường, trần toàn bộ căn nhà', who: 'Đội hoàn thiện', pts: 45, done: false },
    { text: 'Chống thấm WC, sân thượng, ban công', who: 'Đội hoàn thiện', pts: 45, done: false },
  ] },
  { title: 'Sơn bả, lát gạch, hoàn thiện nội thất', status: 'locked', subtasks: [
    { text: 'Sơn bả toàn bộ căn nhà', who: 'Đội hoàn thiện', pts: 50, done: false },
    { text: 'Lát gạch nền, ốp gạch WC', who: 'Đội hoàn thiện', pts: 50, done: false },
    { text: 'Lắp thiết bị vệ sinh, nội thất', who: 'Đội hoàn thiện', pts: 50, done: false },
  ] },
  { title: 'Nghiệm thu & bàn giao', status: 'locked', subtasks: [
    { text: 'Vệ sinh công nghiệp toàn bộ căn nhà', who: 'Đội hoàn thiện', pts: 30, done: false },
    { text: 'Nghiệm thu tổng thể với khách hàng', who: 'Đỗ Thành Long', pts: 35, done: false },
    { text: 'Bàn giao hồ sơ, chìa khoá', who: 'Ban chỉ huy công trường', pts: 35, done: false },
  ] },
]

export const REWARDS = [
  { title: 'Phiếu ăn trưa miễn phí (1 tuần)', cost: 300, color: 'finance', icon: '<path d="M3 11l19-9-9 19-2-8-8-2z"/>' },
  { title: 'Áo đồng phục cao cấp', cost: 500, color: 'primary', icon: '<path d="M20.4 14.5 16 10 4 20"/><path d="M6 20 20.4 5.5"/>' },
  { title: 'Voucher đổ xăng 200.000đ', cost: 600, color: 'attendance', icon: '<path d="M3 12h18M6 12V8a6 6 0 0 1 12 0v4"/><path d="M5 12v7a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2h8v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-7"/>' },
  { title: 'Bộ dụng cụ bảo hộ lao động cao cấp', cost: 900, color: 'success', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  { title: 'Ngày nghỉ phép thêm (1 ngày)', cost: 1200, color: 'game', icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
]

/* ---------- Dezbot ---------- */
export const AI_KB = {
  tiendo: 'Dự án "Chung cư Riverside GĐ2" đang hoàn thành 62% khối lượng — đúng tiến độ tổng thể. Hạng mục "Hoàn thiện" có 2 đầu việc đang trễ hạn, cần ưu tiên xử lý trong tuần này.',
  chamcong: 'Hôm nay có 18/21 nhân sự đã chấm công đúng giờ, 2 người chấm công trễ và 1 người xin nghỉ phép. Tỷ lệ chuyên cần tuần này đạt 94%.',
  dongtien: 'Dòng tiền tháng này: Thu về 1.85 tỷ, Chi ra 1.42 tỷ — dương 430 triệu. Có 3 hoá đơn nhà cung cấp sắp đến hạn thanh toán trong 7 ngày tới.',
  khachhang: 'Hiện có 12 khách hàng đang trong giai đoạn đàm phán, 4 khách vừa ký hợp đồng trong tuần này. Cơ hội "Nhà phố Lô B12" có giá trị lớn nhất, đang chờ chốt hợp đồng.',
  tinnhan: 'Bạn có 6 tin nhắn chưa đọc trong Chat, tập trung ở nhóm "Dự án Riverside" và "Ban giám đốc". Muốn mình tóm tắt nội dung chính không?',
  boctach: 'Bóc tách khối lượng mới nhất từ QS ghi nhận tổng giá trị vật tư khoảng 11.93 triệu trên 5 đơn mua hàng, trong đó 2 đơn chưa đặt hàng.',
  quytrinh: 'Quy trình thi công hiện tại gồm 5 bước: Khảo sát → Thiết kế → Xin phép → Thi công → Nghiệm thu. Bước "Thi công" đang được nhiều dự án thực hiện nhất.',
  default: 'Mình đã tra trong dữ liệu workspace nhưng chưa tìm thấy câu trả lời chính xác cho câu hỏi này — bạn thử hỏi cụ thể hơn về tiến độ, chấm công, dòng tiền, khách hàng, bóc tách hoặc quy trình nhé.',
}
export const AI_TOPIC_LABELS = {
  tiendo: 'Tiến độ dự án đang thế nào?',
  chamcong: 'Tình hình chấm công hôm nay?',
  dongtien: 'Dòng tiền tháng này ra sao?',
  khachhang: 'Khách hàng nào đang tiềm năng?',
  tinnhan: 'Tôi có tin nhắn nào chưa đọc?',
}
export function matchTopic(text) {
  const t = text.toLowerCase()
  const has = (...keys) => keys.some(k => t.indexOf(k) > -1)
  if (has('tiến độ', 'tien do', 'dự án')) return 'tiendo'
  if (has('chấm công', 'nhân công', 'nhân sự', 'nghỉ phép')) return 'chamcong'
  if (has('dòng tiền', 'hoá đơn', 'hóa đơn', 'thu', 'chi')) return 'dongtien'
  if (has('khách hàng', 'hợp đồng')) return 'khachhang'
  if (has('tin nhắn', 'chat')) return 'tinnhan'
  if (has('bóc tách', 'mua hàng', 'vật tư')) return 'boctach'
  if (has('quy trình')) return 'quytrinh'
  return 'default'
}

/* Mua hàng & cung ứng — dùng chung quy trình & đơn mua hàng với Quản lý thiết kế (bảng kanban mua hàng ở tab Tiến độ) */
export { PURCHASE_PHASE_ID, INITIAL_PURCHASE_ITEMS, PO_STAGES } from './quanLyThietKeData'
