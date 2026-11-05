/* =====================================================================
   Dữ liệu trang Marketing — chép nguyên từ <script> của marketing.html.
   Lưu ý: bản HTML ghi "&amp;" trong groupLabel nhóm A vì chèn qua innerHTML;
   ở React hiển thị dạng text nên dùng thẳng ký tự "&".
   ===================================================================== */

/* ---------- Danh mục hạng mục chi phí ---------- */
const LABEL_A = 'Nhân sự (đã gồm BH & KPCĐ DN đóng)'
const LABEL_C = 'Công cụ & phần mềm'
const LABEL_D = 'Thiết bị quay, chụp, dựng (khấu hao)'
const LABEL_F = 'Quảng cáo fanpage'
const LABEL_G = 'Sản xuất nội dung'
const LABEL_H = 'Tổ chức sự kiện'
const LABEL_I = 'Chi phí khác'

export const CATALOG = [
  { id: 'a1', group: 'A', groupLabel: LABEL_A, name: 'Head Marketing', unit: 'người-tháng', price: 21870000 },
  { id: 'a2', group: 'A', groupLabel: LABEL_A, name: 'Graphic Designer', unit: 'người-tháng', price: 18225000 },
  { id: 'a3', group: 'A', groupLabel: LABEL_A, name: 'Media (quay, dựng video)', unit: 'người-tháng', price: 19440000 },
  { id: 'a4', group: 'A', groupLabel: LABEL_A, name: 'Content Creator', unit: 'người-tháng', price: 17010000 },
  { id: 'a5', group: 'A', groupLabel: LABEL_A, name: 'Intern dựng video', unit: 'người-tháng', price: 3000000 },
  { id: 'a6', group: 'A', groupLabel: LABEL_A, name: 'Intern content', unit: 'người-tháng', price: 3500000 },
  { id: 'c1', group: 'C', groupLabel: LABEL_C, name: 'Adobe Creative Cloud', unit: 'tháng', price: 133333 },
  { id: 'c2', group: 'C', groupLabel: LABEL_C, name: 'CapCut Pro / phần mềm dựng khác', unit: 'tháng', price: 93333 },
  { id: 'c3', group: 'C', groupLabel: LABEL_C, name: 'Render video AI', unit: 'tháng', price: 780000 },
  { id: 'd1', group: 'D', groupLabel: LABEL_D, name: 'Máy quay / máy ảnh Sony a73', unit: 'tháng', price: 944444 },
  { id: 'd2', group: 'D', groupLabel: LABEL_D, name: 'Máy quay / máy ảnh Sony a7s3', unit: 'tháng', price: 2083333 },
  { id: 'd3', group: 'D', groupLabel: LABEL_D, name: 'Lens FE 1.8/50', unit: 'tháng', price: 166667 },
  { id: 'd4', group: 'D', groupLabel: LABEL_D, name: 'Lens Tamron 17-28mm F/2.8', unit: 'tháng', price: 444444 },
  { id: 'd5', group: 'D', groupLabel: LABEL_D, name: 'Tripod', unit: 'tháng', price: 83333 },
  { id: 'd6', group: 'D', groupLabel: LABEL_D, name: 'Đèn ZSYB 500GRB', unit: 'tháng', price: 72222 },
  { id: 'd7', group: 'D', groupLabel: LABEL_D, name: 'Đèn YZYB Y500S', unit: 'tháng', price: 111111 },
  { id: 'd8', group: 'D', groupLabel: LABEL_D, name: 'Softbox', unit: 'tháng', price: 83333 },
  { id: 'd9', group: 'D', groupLabel: LABEL_D, name: 'Mic DJI', unit: 'tháng', price: 47222 },
  { id: 'd10', group: 'D', groupLabel: LABEL_D, name: 'MIC RODE', unit: 'tháng', price: 208333 },
  { id: 'd11', group: 'D', groupLabel: LABEL_D, name: 'Mic chân Podcast', unit: 'tháng', price: 194444 },
  { id: 'd12', group: 'D', groupLabel: LABEL_D, name: 'Ổ cứng HDD Synology 12TB', unit: 'tháng', price: 916667 },
  { id: 'f1', group: 'F', groupLabel: LABEL_F, name: 'Decox', unit: 'tháng', price: 55000000 },
  { id: 'f2', group: 'F', groupLabel: LABEL_F, name: 'Decox Design', unit: 'tháng', price: 15000000 },
  { id: 'f3', group: 'F', groupLabel: LABEL_F, name: 'Kiến Phong Legend (Studio network)', unit: 'tháng', price: 3000000 },
  { id: 'f4', group: 'F', groupLabel: LABEL_F, name: 'Mas Architect (Studio network)', unit: 'tháng', price: 3000000 },
  { id: 'f5', group: 'F', groupLabel: LABEL_F, name: 'Quảng cáo Web (Google Ads, SEO)', unit: 'tháng', price: 35000000 },
  { id: 'g1', group: 'G', groupLabel: LABEL_G, name: 'Đi lại quay / chụp công trình', unit: 'tháng', price: 500000 },
  { id: 'g2', group: 'G', groupLabel: LABEL_G, name: 'In ấn ấn phẩm (profile, brochure, catalogue)', unit: 'lần', price: 2400000 },
  { id: 'g3', group: 'G', groupLabel: LABEL_G, name: 'Thuê ngoài / freelancer', unit: 'tháng', price: 5000000 },
  { id: 'h1', group: 'H', groupLabel: LABEL_H, name: 'Ngân sách sự kiện (mở bán, tri ân KH...)', unit: 'sự kiện', price: 15000000 },
  { id: 'i1', group: 'I', groupLabel: LABEL_I, name: 'Văn phòng phẩm, vật tư', unit: 'tháng', price: 300000 },
  { id: 'i2', group: 'I', groupLabel: LABEL_I, name: 'Dự phòng phát sinh', unit: 'tháng', price: 2000000 },
]
export const GROUP_ORDER = ['A', 'C', 'D', 'F', 'G', 'H', 'I']

/* ---------- Hàm tính toán (catalog là state nên truyền vào) ---------- */
export function catalogItem(catalog, id) { return catalog.find(c => c.id === id) }
export function fmt(n) { return Math.round(n).toLocaleString('vi-VN') + ' đ' }
export function monthsBetween(start, end) {
  if (!start || !end) return 1
  const s = new Date(start), e = new Date(end)
  const m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1
  return Math.max(1, m)
}
export function unitScales(unit) { return unit === 'tháng' || unit === 'người-tháng' }
export function lineTotal(item, qty, months) {
  return qty * item.price * (unitScales(item.unit) ? months : 1)
}
export function campaignTotal(catalog, camp) {
  const months = monthsBetween(camp.start, camp.end)
  return camp.items.reduce((sum, li) => {
    const it = catalogItem(catalog, li.id)
    return it ? sum + lineTotal(it, li.qty, months) : sum
  }, 0)
}
export function campaignGroupTotals(catalog, camp) {
  const months = monthsBetween(camp.start, camp.end)
  const totals = {}
  camp.items.forEach(li => {
    const it = catalogItem(catalog, li.id)
    if (!it) return
    totals[it.group] = (totals[it.group] || 0) + lineTotal(it, li.qty, months)
  })
  return totals
}

/* ---------- Dữ liệu chiến dịch (mẫu) ---------- */
export const CAMPAIGNS = [
  {
    id: 'camp1', name: 'Ra mắt Riverside Giai đoạn 3', type: 'Ra mắt dự án', client: 'BQL Riverside', owner: 'Trần Anh',
    start: '2026-09-01', end: '2026-10-31', status: 'active', notes: 'Mục tiêu 40 KHTN, chốt tối thiểu 3 căn trong GĐ3.',
    items: [{ id: 'f1', qty: 1 }, { id: 'f5', qty: 1 }, { id: 'a4', qty: 2 }, { id: 'g3', qty: 1 }, { id: 'h1', qty: 1 }],
  },
  {
    id: 'camp2', name: 'Truyền thông thương hiệu Quý 4', type: 'Truyền thông thương hiệu', client: '— Không gắn dự án cụ thể —', owner: 'Trần Anh',
    start: '2026-10-01', end: '2026-12-31', status: 'draft', notes: 'Tăng nhận diện thương hiệu trên các kênh mạng xã hội chính.',
    items: [{ id: 'a1', qty: 1 }, { id: 'a3', qty: 1 }, { id: 'c1', qty: 1 }, { id: 'd1', qty: 1 }, { id: 'f2', qty: 1 }],
  },
]

export const STATUS_LABEL = { active: 'Đang chạy', draft: 'Bản nháp', done: 'Đã hoàn tất' }
export const STATUS_COLOR = { active: 'var(--success)', draft: 'var(--finance)', done: 'var(--text-muted)' }
export const STATUS_TINT = { active: 'var(--success-tint)', draft: 'var(--finance-tint)', done: 'var(--surface-alt)' }

/* ---------- Tab chính ---------- */
export const MAIN_TABS = [
  { id: 'campaigns', label: 'Chiến dịch' },
  { id: 'catalog', label: 'Danh mục' },
  { id: 'quote', label: 'Báo giá' },
  { id: 'tasks', label: 'Nhiệm vụ' },
  { id: 'staff', label: 'Cơ cấu phòng ban' },
  { id: 'ads', label: 'Chi tiêu quảng cáo' },
]

/* ---------- Mẫu báo giá ---------- */
export function buildQuoteData(catalog, camp, vatOn) {
  const months = monthsBetween(camp.start, camp.end)
  const lines = camp.items.filter(li => li.qty > 0).map(li => {
    const it = catalogItem(catalog, li.id)
    return { id: li.id, name: it.name, unit: it.unit, price: it.price, qty: li.qty, group: it.group, groupLabel: it.groupLabel, scales: unitScales(it.unit), total: lineTotal(it, li.qty, months) }
  })
  const groupTotals = {}
  lines.forEach(l => { groupTotals[l.group] = (groupTotals[l.group] || 0) + l.total })
  const subtotal = lines.reduce((s, l) => s + l.total, 0)
  const vat = vatOn ? subtotal * 0.08 : 0
  return { months, lines, groupTotals, subtotal, vat, grand: subtotal + vat }
}
export function quoteNumber(camp) {
  const n = (camp.id.match(/\d+/) || ['0'])[0]
  return 'BG-' + n.padStart(3, '0') + '-' + new Date().getFullYear()
}
export function todayStr() {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

export const QUOTE_TEMPLATES = [
  { id: 'modern', label: 'Hiện đại', swatch: 'linear-gradient(135deg,#1F5FBF,#12314f)' },
  { id: 'classic', label: 'Cổ điển', swatch: '#1C1F26' },
  { id: 'minimal', label: 'Tối giản', swatch: 'linear-gradient(135deg,#F3F4F7,#DADFE8)' },
  { id: 'detailed', label: 'Chi tiết', swatch: 'linear-gradient(135deg,#1F5FBF,#B7791F)' },
  { id: 'elegant', label: 'Sang trọng', swatch: 'linear-gradient(135deg,#1C1B18,#B7791F)' },
  { id: 'compact', label: 'Gọn nhẹ', swatch: 'linear-gradient(135deg,#DADFE8,#8A8F9C)' },
]
export const TEMPLATE_ACCENT = { modern: '#1F5FBF', classic: '#1C1F26', minimal: '#1F5FBF', detailed: '#1F5FBF', elegant: '#B7791F', compact: '#1C1F26' }

/* ---------- Modal: Tạo chiến dịch ---------- */
export const CAMP_STEPS = ['basic', 'items', 'quote']
export const CAMP_STEP_TITLE = { basic: 'Thông tin chiến dịch', items: 'Chọn hạng mục chi phí', quote: 'Báo giá & xác nhận' }
export const CAMP_TYPES = ['Ra mắt dự án', 'Truyền thông thương hiệu', 'Tuyển khách hàng tiềm năng (Lead gen)', 'Sự kiện', 'Khác']
export const CAMP_CLIENTS = ['— Không gắn dự án cụ thể —', 'BQL Riverside', 'Chị Hải Yến — Biệt thự Nhà Bè', 'Chị Minh Thư — Biệt thự Thảo Điền', 'Cty Đông Dương', 'Khác']

/* ---------- Nhiệm vụ & điểm thưởng ---------- */
export const M_LEADERBOARD = [
  { name: 'Đỗ Thảo Vy', team: 'Head Marketing', color: '#C23B78', week: 140, total: 1580 },
  { name: 'Minh Quân', team: 'Media', color: '#2F5DA8', week: 110, total: 1320 },
  { name: 'Ngọc Hà', team: 'Thiết kế', color: '#B7791F', week: 90, total: 1150 },
  { name: 'Thuỳ Dương', team: 'Content', color: '#1E8E5A', week: 80, total: 980 },
  { name: 'Nhật Minh', team: 'Intern content', color: '#0E8A82', week: 50, total: 520 },
  { name: 'Gia Bảo', team: 'Intern dựng video', color: '#7658C2', week: 40, total: 430 },
]
export function initialsOfM(name) {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}
export function medalM(rank) {
  if (rank === 1) return { bg: 'var(--gold-tint)', color: 'var(--gold)' }
  if (rank === 2) return { bg: 'var(--silver-tint)', color: 'var(--silver)' }
  if (rank === 3) return { bg: 'var(--bronze-tint)', color: 'var(--bronze)' }
  return { bg: 'var(--surface-alt)', color: 'var(--text-muted)' }
}

export const M_STEPS = [
  { title: 'Lên kế hoạch & duyệt ngân sách', status: 'done', subtasks: [
    { text: 'Xác định mục tiêu & KPI chiến dịch', who: 'Đỗ Thảo Vy', pts: 20, done: true },
    { text: 'Lập ngân sách & chọn hạng mục chi phí', who: 'Đỗ Thảo Vy', pts: 20, done: true },
    { text: 'Trình duyệt ngân sách', who: 'Trần Anh', pts: 15, done: true },
  ] },
  { title: 'Sản xuất nội dung', status: 'done', subtasks: [
    { text: 'Viết kịch bản & content', who: 'Thuỳ Dương', pts: 20, done: true },
    { text: 'Quay, dựng video giới thiệu dự án', who: 'Minh Quân', pts: 30, done: true },
    { text: 'Thiết kế hình ảnh & ấn phẩm quảng cáo', who: 'Ngọc Hà', pts: 25, done: true },
  ] },
  { title: 'Setup quảng cáo', status: 'current', subtasks: [
    { text: 'Setup tài khoản quảng cáo Decox / Decox Design', who: 'Đỗ Thảo Vy', pts: 20, done: true },
    { text: 'Setup landing page & form thu lead', who: 'Minh Quân', pts: 25, done: true },
    { text: 'Chạy thử nghiệm A/B creative', who: 'Thuỳ Dương', pts: 20, done: false },
  ] },
  { title: 'Chạy chiến dịch & tối ưu', status: 'locked', subtasks: [
    { text: 'Theo dõi ngân sách & hiệu suất hàng ngày', who: 'Đỗ Thảo Vy', pts: 20, done: false },
    { text: 'Tối ưu targeting theo dữ liệu', who: 'Minh Quân', pts: 25, done: false },
    { text: 'Trả lời tin nhắn / bình luận khách hàng tiềm năng', who: 'Nhật Minh', pts: 20, done: false },
  ] },
  { title: 'Đo lường & báo cáo', status: 'locked', subtasks: [
    { text: 'Tổng hợp số liệu KHTN / lead theo kênh', who: 'Gia Bảo', pts: 20, done: false },
    { text: 'Tính chi phí trên mỗi lead (CPL)', who: 'Đỗ Thảo Vy', pts: 20, done: false },
    { text: 'Báo cáo tổng kết chiến dịch', who: 'Đỗ Thảo Vy', pts: 25, done: false },
  ] },
]
export function stepPointsM(step) { return step.subtasks.reduce((s, x) => s + x.pts, 0) }
export function stepEarnedM(step) { return step.subtasks.reduce((s, x) => s + (x.done ? x.pts : 0), 0) }
/* Bản HTML tính tổng điểm tối đa MỘT lần lúc tải trang (không cộng nhiệm vụ tạo thêm) */
export const M_TOTAL_MAX = M_STEPS.reduce((s, st) => s + stepPointsM(st), 0)

export const MKT_WALLET_START = 860
