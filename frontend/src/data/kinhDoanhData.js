/* =====================================================================
   Dữ liệu trang Kinh doanh — chép nguyên văn từ <script> của kinh-doanh.html
   ===================================================================== */

/* ---------- Pipeline (Kanban) ---------- */
export const AVATAR_COLORS = ['#2F5DA8', '#2f9160', '#b87a1f', '#7658c2', '#c1443c', '#0E8A82', '#c26fb0', '#6e8fd0']

export const STAGES = ['tiep-can', 'tu-van', 'bao-gia', 'dam-phan', 'chot-hd', 'bao-gia-thi-cong', 'thiet-ke', 'thi-cong', 'truot-thau']
export const STAGE_LABEL = {
  'tiep-can': 'Tiếp cận', 'tu-van': 'Tư vấn (Concept)', 'bao-gia': 'Báo giá (Thiết kế - Khái toán)', 'dam-phan': 'Đàm phán',
  'chot-hd': 'Chốt hợp đồng', 'bao-gia-thi-cong': 'Báo giá (Thi công)', 'thiet-ke': 'Dự án (Thiết kế)', 'thi-cong': 'Dự án (Thi công)',
  'truot-thau': 'Đã trượt thầu',
}
/* Các giai đoạn được đồng bộ sang tab Dự án (localStorage siteflow-synced-projects) */
export const SYNC_STAGES = ['thiet-ke', 'thi-cong', 'tu-van', 'dam-phan']

export const DEPTS = ['du-an', 'dan-dung']
export const DEPT_LABEL = { 'du-an': 'Phòng KD Dự Án', 'dan-dung': 'Phòng KD Dân dụng' }
export const DEPT_SHORT = { 'du-an': 'Dự án', 'dan-dung': 'Dân dụng' }
export const DEPT_COLOR = { 'du-an': 'var(--primary)', 'dan-dung': 'var(--attendance)' }
export const DEPT_TINT = { 'du-an': 'var(--primary-tint)', 'dan-dung': 'var(--attendance-tint)' }

/* Người khởi tạo / quản lý lead (dữ liệu mẫu — lead mới lấy người dùng hiện tại làm người khởi tạo) */
export const KD_CURRENT_USER = 'Trần Anh'
export const KD_MANAGER = 'Trần Anh'
const DEPT_DEFAULT_CREATOR = { 'du-an': 'Đặng Quốc Cường', 'dan-dung': 'Hoàng Yến Nhi' }

export const LEADS = [
  { id: 'l1', name: 'Anh Minh Khang', type: 'Nhà phố', value: 1.8, stage: 'tiep-can', dept: 'dan-dung', createdAt: '2026-09-27' },
  { id: 'l2', name: 'Chị Lan Anh', type: 'Biệt thự', value: 5.2, stage: 'tiep-can', dept: 'dan-dung', createdAt: '2026-09-25' },
  { id: 'l3', name: 'Cty XYZ Group', type: 'Văn phòng', value: 3.5, stage: 'tiep-can', dept: 'du-an', createdAt: '2026-09-20' },
  { id: 'l4', name: 'Anh Đức Thịnh', type: 'Nhà phố', value: 2.0, stage: 'tiep-can', dept: 'dan-dung', createdAt: '2026-09-10' },
  { id: 'l5', name: 'Chị Thu Hằng', type: 'Chung cư mini', value: 4.1, stage: 'tiep-can', dept: 'dan-dung', createdAt: '2026-08-15' },
  { id: 'l6', name: 'Chị Bích Ngọc', type: 'Biệt thự', value: 6.0, stage: 'tu-van', dept: 'dan-dung', createdAt: '2026-09-22' },
  { id: 'l7', name: 'Anh Hoàng Long', type: 'Nhà phố', value: 2.3, stage: 'tu-van', dept: 'dan-dung', createdAt: '2026-09-05' },
  { id: 'l8', name: 'Cty Minh Phát', type: 'Văn phòng', value: 4.8, stage: 'tu-van', dept: 'du-an', createdAt: '2026-08-28' },
  { id: 'l9', name: 'Anh Tuấn Kiệt', type: 'Nhà phố', value: 1.9, stage: 'tu-van', dept: 'dan-dung', createdAt: '2026-07-30' },
  { id: 'l10', name: 'Chị Minh Thư', type: 'Biệt thự Song lập — Thảo Điền', value: 6.8, stage: 'bao-gia', dept: 'dan-dung', createdAt: '2026-09-18' },
  { id: 'l11', name: 'Anh Văn Sơn', type: 'Nhà phố', value: 2.2, stage: 'bao-gia', dept: 'dan-dung', createdAt: '2026-08-22' },
  { id: 'l12', name: 'Cty Đông Dương', type: 'Văn phòng', value: 5.5, stage: 'bao-gia', dept: 'du-an', createdAt: '2026-06-15' },
  { id: 'l13', name: 'BQL Riverside', type: 'Mở rộng Giai đoạn 3', value: 15.0, stage: 'dam-phan', dept: 'du-an', createdAt: '2026-09-23' },
  { id: 'l14', name: 'Chị Hải Yến', type: 'Biệt thự Nhà Bè', value: 7.2, stage: 'dam-phan', dept: 'dan-dung', createdAt: '2026-07-12' },
  { id: 'l17', name: 'Anh Phúc Nguyên', type: 'Nhà phố', value: 2.4, stage: 'chot-hd', dept: 'dan-dung', createdAt: '2026-09-01' },
  { id: 'l18', name: 'Chị Ngọc Diễm', type: 'Nhà phố', value: 2.6, stage: 'thiet-ke', sub: 'concept', dept: 'dan-dung', createdAt: '2026-05-20' },
  { id: 'l19', name: 'Anh Bảo Long', type: 'Biệt thự', value: 5.4, stage: 'thiet-ke', sub: 'review', dept: 'dan-dung', partner: true, createdAt: '2026-04-10' },
  { id: 'l15', name: 'Anh Quang Huy', type: 'Nhà phố Lô B12 — KDC Bình Chánh', value: 2.1, stage: 'thi-cong', sub: 'structure', dept: 'dan-dung', createdAt: '2026-03-15' },
  { id: 'l16', name: 'Cty TNHH ABC Logistics', type: 'Văn phòng cho thuê — Q3', value: 4.2, stage: 'thi-cong', sub: 'handover', dept: 'du-an', partner: true, createdAt: '2026-02-01' },
  { id: 'l20', name: 'Anh Trọng Tấn', type: 'Nhà phố', value: 2.7, stage: 'truot-thau', dept: 'dan-dung', createdAt: '2026-09-15' },
].map(l => ({ creator: DEPT_DEFAULT_CREATOR[l.dept], manager: KD_MANAGER, ...l }))

/* ---------- Bảng con: Thiết kế & Thi công (kiểu Lark Base/Task) ---------- */
export const DESIGN_STAGES = ['intake', 'concept', 'drafting', 'review', 'approved']
export const DESIGN_LABEL = { intake: 'Chờ tiếp nhận', concept: 'Lên concept', drafting: 'Triển khai bản vẽ', review: 'Chờ khách duyệt', approved: 'Đã duyệt' }
export const DESIGN_COLOR = { intake: 'var(--text-muted)', concept: 'var(--primary)', drafting: 'var(--finance)', review: 'var(--qs)', approved: 'var(--success)' }

export const CONSTRUCTION_STAGES = ['prep', 'structure', 'finishing', 'acceptance', 'handover']
export const CONSTRUCTION_LABEL = { prep: 'Chuẩn bị mặt bằng', structure: 'Thi công phần thô', finishing: 'Hoàn thiện', acceptance: 'Nghiệm thu', handover: 'Đã bàn giao' }
export const CONSTRUCTION_COLOR = { prep: 'var(--text-muted)', structure: 'var(--primary)', finishing: 'var(--finance)', acceptance: 'var(--qs)', handover: 'var(--success)' }

/* ---------- Bộ lọc thời gian ---------- */
export const TIME_FILTER_OPTIONS = [
  ['all', 'Tất cả thời gian'], ['today', 'Hôm nay'], ['week', 'Tuần này'], ['month', 'Tháng này'],
  ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tự chọn khoảng ngày...'],
]

/* ---------- Tab chính ---------- */
export const SALES_TABS = [
  ['overview', 'Tổng quan'], ['pipeline', 'Pipeline khách hàng'], ['design-board', 'Dự án (Thiết kế)'],
  ['construction-board', 'Dự án (Thi công)'], ['tasks', 'Nhiệm vụ'], ['nhansu', 'Cơ cấu phòng ban'],
]

/* ---------- Tổng quan (Overview dashboard) ---------- */
export const OV_TREND_CFG = {
  week: { labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], seed: 11 },
  month: { labels: ['Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9'], seed: 22 },
  year: { labels: ['2023', '2024', '2025', '2026'], seed: 33 },
}
export const OV_PERIODS = [['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']]
/* minW/minH: kích thước nhỏ nhất (số ô lưới) khi co widget, để nội dung không bị tràn khung */
export const OV_ITEM_DEFS = {
  'kpi-pipeline': { kind: 'kpi', x: 0, y: 0, w: 4, h: 2 },
  'kpi-leads': { kind: 'kpi', x: 4, y: 0, w: 4, h: 2 },
  'kpi-close-rate': { kind: 'kpi', x: 8, y: 0, w: 4, h: 2 },
  'kpi-closed-value': { kind: 'kpi', x: 0, y: 2, w: 4, h: 2 },
  'kpi-lost-rate': { kind: 'kpi', x: 4, y: 2, w: 4, h: 2 },
  'kpi-partner-rate': { kind: 'kpi', x: 8, y: 2, w: 4, h: 2 },
  'trend': { kind: 'widget', x: 0, y: 4, w: 6, h: 5, minW: 3, minH: 3, title: 'Doanh số theo thời gian' },
  'funnel': { kind: 'widget', x: 6, y: 4, w: 6, h: 3, minW: 3, minH: 3, title: 'Phễu bán hàng (Sales Funnel)' },
  'upcoming': { kind: 'widget', x: 0, y: 9, w: 12, h: 4, minW: 3, minH: 2, title: 'Cơ hội sắp chốt' },
}
export const OV_ITEM_ORDER = Object.keys(OV_ITEM_DEFS)
export const OV_LAYOUT_KEY = 'siteflow-overview-layout-v1'
export const OV_TREND_CHART_OPTIONS = [['line', 'Đường'], ['bar', 'Cột']]
export const OV_FUNNEL_CHART_OPTIONS = [['bars', 'Thanh ngang'], ['columns', 'Cột dọc'], ['donut', 'Biểu đồ tròn']]

/* ---------- Modal: Thông báo bàn giao sang phòng ban ---------- */
export const HANDOFF_CONFIG = {
  /* deptOptions: người gửi được chọn phòng nhận phiếu; {dept} trong các chuỗi được thay bằng phòng đã chọn */
  'tu-van': {
    dept: 'Thiết kế', deptOptions: ['Thiết kế', 'Thi công'],
    title: 'Phiếu yêu cầu tư vấn', subtitle: 'Chuyển khách hàng sang Phòng {dept} để tư vấn',
    dateLabel: 'Ngày giờ hẹn tư vấn (dự kiến)', assigneeLabel: 'Người phụ trách tư vấn (nếu đã biết)',
    assigneePlaceholder: 'VD: Chị Lan — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi yêu cầu đến Phòng {dept}', role: '{dept} - Tư vấn',
    selfLabel: null, selfStatus: null, pendingStatus: 'pending-handoff',
  },
  'bao-gia': {
    dept: 'QS', deptOptions: ['QS', 'Thiết kế'],
    title: 'Phiếu yêu cầu báo giá (Thiết kế - Khái toán)', subtitle: 'Chuyển dự án sang Phòng {dept} để lập báo giá thiết kế - khái toán',
    dateLabel: 'Ngày giờ hẹn báo giá (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Anh Trung — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi yêu cầu đến Phòng {dept}', role: '{dept} - Điều phối báo giá',
    selfLabel: 'Phòng KD tự đề xuất báo giá', selfStatus: 'self-quoted', pendingStatus: 'pending-qs',
  },
  'dam-phan': {
    dept: 'QS', deptOptions: ['QS', 'Thiết kế', 'Thi công'],
    title: 'Phiếu yêu cầu hỗ trợ đàm phán', subtitle: 'Gửi Phòng {dept} để hỗ trợ đàm phán với khách hàng',
    dateLabel: 'Ngày giờ hẹn đàm phán (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Anh Trung — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi yêu cầu đến Phòng {dept}', role: '{dept} - Hỗ trợ đàm phán',
    selfLabel: null, selfStatus: null, pendingStatus: 'pending-handoff',
  },
  'chot-hd': {
    dept: 'Thiết kế', deptOptions: ['Thiết kế', 'QS', 'Thi công'],
    title: 'Phiếu thông báo chốt hợp đồng', subtitle: 'Gửi Phòng {dept} để chuẩn bị tiếp nhận sau khi chốt hợp đồng',
    dateLabel: 'Ngày giờ hẹn ký hợp đồng (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Chị Lan — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi thông báo đến Phòng {dept}', role: '{dept} - Tiếp nhận hợp đồng',
    selfLabel: null, selfStatus: null, pendingStatus: 'pending-handoff',
  },
  'bao-gia-thi-cong': {
    dept: 'QS', deptOptions: ['QS', 'Thi công', 'Thiết kế'],
    title: 'Phiếu yêu cầu báo giá (Thi công)', subtitle: 'Chuyển dự án sang Phòng {dept} để lập báo giá thi công chi tiết',
    dateLabel: 'Ngày giờ hẹn báo giá (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Anh Trung — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi yêu cầu đến Phòng {dept}', role: '{dept} - Điều phối báo giá thi công',
    selfLabel: 'Phòng KD tự đề xuất báo giá', selfStatus: 'self-quoted', pendingStatus: 'pending-qs',
  },
  'thiet-ke': {
    dept: 'Thiết kế', deptOptions: ['Thiết kế', 'QS', 'Thi công'],
    title: 'Phiếu bàn giao dự án (Thiết kế)', subtitle: 'Chuyển dự án sang Phòng {dept} để triển khai thiết kế',
    dateLabel: 'Ngày giờ hẹn bàn giao (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Chị Lan — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi thông báo đến Phòng {dept}', role: '{dept} - Tiếp nhận dự án',
    selfLabel: null, selfStatus: null, pendingStatus: 'pending-handoff',
  },
  'thi-cong': {
    dept: 'Thi công', deptOptions: ['Thi công', 'Thiết kế', 'QS'],
    title: 'Phiếu bàn giao dự án (Thi công)', subtitle: 'Chuyển dự án sang Phòng {dept} để triển khai thi công',
    dateLabel: 'Ngày giờ hẹn bàn giao (dự kiến)', assigneeLabel: 'Người phụ trách bên {dept} (nếu đã biết)',
    assigneePlaceholder: 'VD: Anh Sơn — Phòng {dept}', note: 'Phòng {dept} sẽ xác nhận lại ngày giờ và người phụ trách chính xác ngay khi nhận được thông báo.',
    sendLabel: 'Gửi thông báo đến Phòng {dept}', role: '{dept} - Tiếp nhận dự án',
    selfLabel: null, selfStatus: null, pendingStatus: 'pending-handoff',
  },
}

/* ---------- Modal thêm khách hàng tiềm năng (3 cấp độ) ---------- */
export const LEAD_STEPS = ['basic', 'detail', 'advanced']
export const LEAD_STEP_TITLE = { basic: 'Cơ bản', detail: 'Chi tiết', advanced: 'Nâng cao' }
export const LEAD_STEP_TAB_LABEL = { basic: '1. Cơ bản', detail: '2. Chi tiết', advanced: '3. Nâng cao' }
export const LEAD_SOURCES = ['Giới thiệu', 'Website', 'Mạng xã hội', 'Sự kiện', 'Khác']
export const LEAD_PROJECT_TYPES = ['Nhà phố', 'Biệt thự', 'Chung cư', 'Văn phòng', 'Khác']
export const LEAD_DEPT_OPTIONS = [['dan-dung', 'Phòng KD Dân dụng'], ['du-an', 'Phòng KD Dự Án']]
export const LEAD_STAGE_OPTIONS = [
  ['tiep-can', 'Tiếp cận'], ['tu-van', 'Tư vấn (Concept)'], ['bao-gia', 'Báo giá'], ['dam-phan', 'Đàm phán'], ['chot-hd', 'Chốt hợp đồng'],
]
export const LEAD_CATEGORY_GROUPS = [
  { title: 'Thiết kế', items: ['Thiết kế kiến trúc', 'Thiết kế nội thất', 'Thiết kế cảnh quan'] },
  { title: 'Thi công', items: ['Thi công phần thô', 'Thi công phần hoàn thiện cơ bản', 'Thi công nội thất', 'Cung cấp đồ rời', 'Thi công trọn gói (chìa khóa trao tay)'] },
]
export const LEAD_CATEGORIES = LEAD_CATEGORY_GROUPS.flatMap(g => g.items)
export const BOQ_DEFAULT_LABEL = 'Kéo thả file hoặc bấm để tải lên (.xlsx, .pdf)'

/* ---------- Nhiệm vụ & điểm thưởng ---------- */
export const TASK_TABS = [['overview', 'Tổng quan'], ['mission', 'Nhiệm vụ'], ['rewards', 'Đổi quà'], ['leaderboard', 'Bảng xếp hạng']]

export const KD_LEADERBOARD = [
  { name: 'Trần Anh', team: 'Trưởng phòng KD', color: '#C2621A', week: 150, total: 1780 },
  { name: 'Đặng Quốc Cường', team: 'Phòng KD Dự Án', color: '#2F5DA8', week: 120, total: 1420 },
  { name: 'Hoàng Yến Nhi', team: 'Phòng KD Dân dụng', color: '#0E8A82', week: 110, total: 1320 },
  { name: 'Vũ Đình Khoa', team: 'Phòng KD Dự Án', color: '#B7791F', week: 80, total: 960 },
  { name: 'Lâm Bảo Ngọc', team: 'Phòng KD Dân dụng', color: '#7658C2', week: 60, total: 760 },
]

export const KD_STEPS = [
  { title: 'Tiếp cận & xác minh khách hàng tiềm năng', status: 'done', subtasks: [
    { text: 'Gọi điện xác minh nhu cầu', who: 'Đặng Quốc Cường', pts: 20, done: true },
    { text: 'Ghi nhận thông tin vào hệ thống', who: 'Đặng Quốc Cường', pts: 15, done: true },
    { text: 'Phân loại theo phòng ban phụ trách', who: 'Trần Anh', pts: 15, done: true },
  ] },
  { title: 'Tư vấn & khảo sát nhu cầu', status: 'done', subtasks: [
    { text: 'Hẹn gặp tư vấn trực tiếp', who: 'Đặng Quốc Cường', pts: 20, done: true },
    { text: 'Khảo sát hiện trạng / mặt bằng', who: 'Vũ Đình Khoa', pts: 25, done: true },
    { text: 'Ghi nhận yêu cầu thiết kế', who: 'Đặng Quốc Cường', pts: 20, done: true },
  ] },
  { title: 'Lập báo giá', status: 'current', subtasks: [
    { text: 'Bóc tách sơ bộ chi phí', who: 'Vũ Đình Khoa', pts: 25, done: true },
    { text: 'Soạn báo giá & trình duyệt', who: 'Trần Anh', pts: 20, done: true },
    { text: 'Gửi báo giá cho khách hàng', who: 'Đặng Quốc Cường', pts: 15, done: false },
  ] },
  { title: 'Đàm phán hợp đồng', status: 'locked', subtasks: [
    { text: 'Trao đổi điều khoản thanh toán', who: 'Trần Anh', pts: 20, done: false },
    { text: 'Điều chỉnh phạm vi công việc', who: 'Vũ Đình Khoa', pts: 20, done: false },
    { text: 'Thống nhất tiến độ bàn giao', who: 'Đặng Quốc Cường', pts: 20, done: false },
  ] },
  { title: 'Chốt hợp đồng & bàn giao hồ sơ', status: 'locked', subtasks: [
    { text: 'Ký kết hợp đồng', who: 'Trần Anh', pts: 25, done: false },
    { text: 'Thu tạm ứng đợt 1', who: 'Trần Anh', pts: 20, done: false },
    { text: 'Bàn giao hồ sơ sang phòng Dự án / Thi công', who: 'Đặng Quốc Cường', pts: 20, done: false },
  ] },
]
/* Bản HTML: tổng điểm tối đa tính một lần lúc tải trang (không đổi khi tạo thêm nhiệm vụ) */
export const KD_TOTAL_MAX = KD_STEPS.reduce((s, st) => s + st.subtasks.reduce((a, x) => a + x.pts, 0), 0)

export const KD_WALLET_INITIAL = 1320

/* Quà đổi điểm: icon = khoá tra trong REWARD_ICONS (components/TasksTab.jsx) */
export const KD_REWARDS = [
  { name: 'Phiếu ăn trưa miễn phí (1 tuần)', cost: 300, costLabel: '300 điểm', icon: 'coffee', bg: 'var(--finance-tint)', color: 'var(--finance)' },
  { name: 'Voucher nhà hàng 500.000đ', cost: 500, costLabel: '500 điểm', icon: 'voucher', bg: 'var(--primary-tint)', color: 'var(--primary)' },
  { name: 'Khoá học kỹ năng đàm phán', cost: 700, costLabel: '700 điểm', icon: 'course', bg: 'var(--attendance-tint)', color: 'var(--attendance)' },
  { name: 'Ngày nghỉ phép thêm (1 ngày)', cost: 1000, costLabel: '1.000 điểm', icon: 'calendar', bg: 'var(--success-tint)', color: 'var(--success)' },
  { name: 'Chuyến du lịch team quý (2 ngày 1 đêm)', cost: 2500, costLabel: '2.500 điểm', icon: 'chat', locked: true },
  { name: 'Thưởng tiền mặt 1.000.000đ', cost: 3000, costLabel: '3.000 điểm', icon: 'bag', locked: true },
]
export const KD_REDEEM_HISTORY = [
  { text: 'Hoàng Yến Nhi — Voucher nhà hàng', pts: '-500 điểm', date: '18/09' },
  { text: 'Đặng Quốc Cường — Phiếu ăn trưa miễn phí', pts: '-300 điểm', date: '10/09' },
]

/* ---------- Dezbot — trợ lý ảo ---------- */
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
export const AI_TOPIC_PROMPTS = {
  tiendo: 'Tiến độ dự án đang thế nào?', chamcong: 'Tình hình chấm công hôm nay?', dongtien: 'Dòng tiền tháng này ra sao?',
  khachhang: 'Khách hàng nào đang tiềm năng?', tinnhan: 'Tôi có tin nhắn nào chưa đọc?',
}
export const AI_SUGGESTS = ['Cơ hội nào sắp chốt hợp đồng?', 'Tóm tắt pipeline kinh doanh tuần này', 'Khách hàng nào cần chăm sóc gấp?']
