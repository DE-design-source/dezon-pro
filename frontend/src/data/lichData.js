/* Dữ liệu trang Lịch — lấy nguyên từ lich.html (dữ liệu mẫu tuần 20 – 26/9/2026) */

/* Màu theo từng lịch: [màu chính, màu nền nhạt] (giống CAL_COLOR_VARS) */
export const CAL_COLOR_VARS = {
  me: ['var(--primary)', 'var(--primary-tint)'],
  qs: ['var(--qs)', 'var(--qs-tint)'],
  finance: ['var(--finance)', 'var(--finance-tint)'],
  project: ['var(--attendance)', 'var(--attendance-tint)'],
  hr: ['var(--success)', 'var(--success-tint)'],
}

export const DAYCOL_ROW_HEIGHT = 40 // px mỗi giờ
export const GRID_START = 0 // lưới đủ 24 giờ: 0:00 - 24:00
export const GRID_HEIGHT = 24 * DAYCOL_ROW_HEIGHT

/* Người đang đăng nhập (chủ sự kiện). avatar = đường dẫn ảnh, để trống thì hiện chữ viết tắt */
export const CURRENT_USER = { name: 'Chu Quang Thành', color: 'var(--primary)', avatar: '' }

/* Danh bạ đồng nghiệp; thêm avatar: '/duong-dan-anh.jpg' cho từng người nếu có ảnh */
export const COLLEAGUE_DIRECTORY = [
  { name: 'Cao Hưng (CEO)', color: '#E07B39' },
  { name: 'Lê Trung Kiên', color: '#4F86C6' },
  { name: 'Nguyễn Trung Thành', color: '#9B5DE5' },
  { name: 'Ngô Mỹ Duyên', color: '#2EC4B6' },
]

/* Lịch bận mẫu của đồng nghiệp, dùng để cảnh báo trùng giờ */
export const COLLEAGUE_SCHEDULE = {
  'Cao Hưng (CEO)': [
    { day: 2, start: 9, end: 10, title: 'họp nội bộ' },
    { day: 3, start: 12.5, end: 13.5, title: 'họp BOD' },
    { day: 3, start: 14, end: 15, title: 'tiếp khách' },
    { day: 3, start: 15.5, end: 17.5, title: 'duyệt hồ sơ thầu' },
    { day: 4, start: 10, end: 11.5, title: 'họp cổ đông' },
  ],
  'Lê Trung Kiên': [
    { day: 4, start: 13.5, end: 15, title: 'công tác' },
    { day: 3, start: 10, end: 11, title: 'họp tài chính' },
    { day: 3, start: 16, end: 17, title: 'khảo sát công trình' },
    { day: 2, start: 14, end: 15.5, title: 'nghiệm thu' },
  ],
  'Nguyễn Trung Thành': [
    { day: 1, start: 16, end: 17, title: 'họp khách hàng' },
    { day: 3, start: 9, end: 10.5, title: 'họp thiết kế' },
    { day: 3, start: 13, end: 14, title: 'gặp nhà cung cấp' },
    { day: 5, start: 14, end: 16, title: 'họp vua thầu' },
  ],
  'Ngô Mỹ Duyên': [
    { day: 5, start: 9.5, end: 11, title: 'đào tạo' },
    { day: 3, start: 11, end: 12, title: 'phỏng vấn' },
    { day: 3, start: 15, end: 16, title: 'họp nhân sự' },
    { day: 2, start: 10, end: 11, title: 'onboarding' },
  ],
}

/* Khung giờ bận mẫu khi thêm đồng nghiệp để so sánh lịch */
export const COLLEAGUE_DEMO_SLOTS = [
  { day: 2, start: 9, end: 10, title: 'Lịch bận — họp nội bộ' },
  { day: 4, start: 13.5, end: 15, title: 'Lịch bận — công tác' },
  { day: 1, start: 16, end: 17, title: 'Lịch bận — họp khách hàng' },
  { day: 5, start: 9.5, end: 11, title: 'Lịch bận — đào tạo' },
]

/* Khách mời hiển thị trong popover chi tiết sự kiện */
export const EVD_GUESTS = [
  { name: 'Cao Hưng (CEO)', color: '#E07B39', status: 'yes' },
  { name: 'BOD Thi Công', color: '#12161F', status: 'pending', count: 3 },
  { name: 'Lê Trung Kiên', color: '#4F86C6', status: 'yes' },
]

export const CAL_DOW = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
export const CAL_DOW_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const WEEK_DATES = ['20', '21', '22', '23', '24', '25', '26']
export const DAY_DATE_LABELS = ['20/09', '21/09', '22/09', '23/09', '24/09', '25/09', '26/09']
export const TODAY_IDX = 3 // Thứ Tư 23/09 = "hôm nay" trong dữ liệu mẫu

/* Nhãn giờ ở cột bên trái lưới tuần/ngày: [top px, nhãn] */
export const HOUR_LABELS = Array.from({ length: 24 - GRID_START }, (_, i) => {
  const h = GRID_START + i
  return [i * DAYCOL_ROW_HEIGHT - 6, (h % 12 || 12) + (h < 12 ? ' SA' : ' CH')]
})

/* Sự kiện mẫu trong tuần (day = chỉ số cột 0..6); top tính từ 8:00, đổi sang lưới 24h ở INITIAL_EVENTS */
const RAW_EVENTS = [
  { day: 1, cal: 'finance', top: 80, height: 20, compact: true, title: 'Họp nhanh tài chính', sub: '10:00' },
  { day: 1, cal: 'qs', top: 100, height: 20, compact: true, title: 'Check-in ứng dụng', sub: '10:30' },
  { day: 1, cal: 'project', top: 280, height: 40, title: 'Họp Vua Thầu', sub: '15:00 - 16:00' },
  { day: 2, cal: 'me', top: 240, height: 20, compact: true, title: 'Dashboard MKT', sub: '14:00' },
  { day: 2, cal: 'qs', top: 360, height: 40, title: 'Check-in Alpha', sub: '17:00 - 18:00' },
  { day: 3, cal: 'finance', top: 80, height: 40, title: 'Họp tài chính & Review', sub: '10:00 - 11:00' },
  { day: 3, cal: 'qs', top: 140, height: 40, title: 'Họp bóc tách thi công', sub: '11:30 - 12:30' },
  { day: 3, cal: 'me', top: 220, height: 60, title: 'Review App', sub: '13:30 - 15:00' },
  { day: 3, cal: 'qs', top: 320, height: 40, title: 'Check-in QS', sub: '16:00 - 17:00' },
  { day: 3, cal: 'hr', top: 520, height: 40, title: 'Học online với thầy Tài', sub: '21:00 - 22:00' },
  { day: 4, cal: 'project', top: 160, height: 20, compact: true, title: 'Họp team Dự án (Nội bộ)', sub: '12:00' },
  { day: 4, cal: 'hr', top: 180, height: 20, compact: true, title: 'Họp kế hoạch nhân sự', sub: '12:30' },
  { day: 4, cal: 'me', top: 340, height: 40, title: 'Họp kinh doanh tổng', sub: '16:30 - 17:30' },
  { day: 5, cal: 'project', top: 240, height: 40, title: 'Họp vua thầu', sub: '14:00 - 15:00' },
  { day: 5, cal: 'me', top: 280, height: 40, title: 'Họp RnD tuần', sub: '15:00 - 16:00' },
  { day: 5, cal: 'project', top: 320, height: 80, title: 'Tham quan nhà mẫu dự án Bđs Q7', sub: '16:00 - 18:00' },
]

export const INITIAL_EVENTS = RAW_EVENTS.map((e, i) => ({
  id: 'e' + i,
  compact: false,
  allday: false,
  dim: false,
  color: CAL_COLOR_VARS[e.cal][0],
  tint: CAL_COLOR_VARS[e.cal][1],
  ...e,
  top: e.top + (8 - GRID_START) * DAYCOL_ROW_HEIGHT,
}))

/* Lịch nhỏ tháng 9/2026: [ngày, trạng thái] — muted / in-week / today */
export const MINI_CAL_DAYS = [
  ['30', 'muted'], ['31', 'muted'], ['1'], ['2'], ['3'], ['4'], ['5'],
  ['6'], ['7'], ['8'], ['9'], ['10'], ['11'], ['12'],
  ['13'], ['14'], ['15'], ['16'], ['17'], ['18'], ['19'],
  ['20', 'in-week'], ['21', 'in-week'], ['22', 'in-week'], ['23', 'today'], ['24', 'in-week'], ['25', 'in-week'], ['26', 'in-week'],
  ['27'], ['28'], ['29'], ['30'], ['1', 'muted'], ['2', 'muted'], ['3', 'muted'],
]

/* Danh sách "Đang theo dõi": cal = khóa lịch gắn với sự kiện (null nếu không có sự kiện) */
export const FOLLOWED_CALENDARS = [
  { key: 'qs', cal: 'qs', color: 'var(--qs)', label: 'Lịch QS', checked: true },
  { key: 'finance', cal: 'finance', color: 'var(--finance)', label: 'Lịch Tài chính', checked: true },
  { key: 'project', cal: 'project', color: 'var(--attendance)', label: 'Lịch Dự án', checked: true },
  { key: 'hr', cal: 'hr', color: 'var(--success)', label: 'Lịch nhân sự', checked: true },
  { key: 'congtac', cal: null, color: '#C2618F', label: 'Lịch Công tác', checked: false },
  { key: 'tangca', cal: null, color: '#4F86C6', label: 'Lịch Tăng ca', checked: false },
  { key: 'haumai', cal: null, color: '#E07B39', label: 'Lịch hậu mãi', checked: false },
  { key: 'nghiphep', cal: null, color: 'var(--danger)', label: 'Nghỉ phép / WFH', checked: false },
  { key: 'lab', cal: null, color: '#8892A6', label: 'Phòng Lab vật liệu B123', checked: false },
  { key: 'b122', cal: null, color: '#8892A6', label: 'Phòng họp 1 — B122', checked: false },
  { key: 'b123', cal: null, color: '#8892A6', label: 'Phòng họp 2 — B123', checked: false },
]

/* Lưới tháng 9/2026 (tĩnh như bản HTML). gotoday = chỉ số ngày trong tuần đang xem */
const chip = (label, color) => ({ label, color })
export const MONTH_CELLS = [
  { d: '30', muted: true }, { d: '31', muted: true }, { d: '1' },
  { d: '2', chips: [chip('Họp phòng ban', 'var(--success)')] },
  { d: '3' }, { d: '4' }, { d: '5' },
  { d: '6' }, { d: '7' }, { d: '8' },
  { d: '9', chips: [chip('Review thiết kế', 'var(--attendance)')] },
  { d: '10' }, { d: '11' }, { d: '12' },
  { d: '13' }, { d: '14' },
  { d: '15', chips: [chip('Khách hàng ABC ghé thăm', 'var(--qs)')] },
  { d: '16' }, { d: '17' }, { d: '18' }, { d: '19' },
  { d: '20', gotoday: 0 },
  { d: '21', gotoday: 1, chips: [chip('Họp nhanh tài chính', 'var(--finance)'), chip('Check-in ứng dụng', 'var(--qs)'), chip('Họp Vua Thầu', 'var(--attendance)')] },
  { d: '22', gotoday: 2, chips: [chip('Dashboard MKT', 'var(--primary)'), chip('Check-in Alpha', 'var(--qs)')] },
  { d: '23', gotoday: 3, today: true, chips: [chip('Họp tài chính & Review', 'var(--finance)'), chip('Họp bóc tách thi công', 'var(--qs)')], more: '+3 khác' },
  { d: '24', gotoday: 4, chips: [chip('Họp team Dự án', 'var(--attendance)'), chip('Họp kế hoạch nhân sự', 'var(--success)')], more: '+1 khác' },
  { d: '25', gotoday: 5, chips: [chip('Họp vua thầu', 'var(--attendance)'), chip('Họp RnD tuần', 'var(--primary)')], more: '+1 khác' },
  { d: '26', gotoday: 6 },
  { d: '27' }, { d: '28' },
  { d: '29', chips: [chip('Chốt báo cáo tháng', 'var(--finance)')] },
  { d: '30', chips: [chip('Tổng kết tháng 9', 'var(--primary)')] },
  { d: '1', muted: true }, { d: '2', muted: true }, { d: '3', muted: true },
]

/* Tab "Nhiệm vụ" */
export const MINI_TASKS = [
  { text: 'Chuẩn bị slide họp Vua Thầu', meta: '15:00 · Họp Vua Thầu' },
  { text: 'Gửi bảng bóc tách cho QS', meta: '11:30 · Họp bóc tách thi công' },
  { text: 'Xác nhận phòng họp B122', meta: 'Hoàn thành', done: true },
  { text: 'Review App trước 13:30', meta: '13:30 · Review App' },
]

/* Tab "Chat" */
export const MINI_CHATS = [
  { initials: 'VT', color: 'var(--attendance)', name: 'Đội thi công A', preview: 'Đã xác nhận phòng cho 15h chiều nay' },
  { initials: 'QS', color: 'var(--qs)', name: 'Nhóm QS — Vua Thầu', preview: 'Gửi lại file bóc tách bản mới nhé' },
  { initials: 'TC', color: 'var(--finance)', name: 'Tài chính tuần này', preview: 'Họp nhanh 10 phút trước buổi review' },
]

/* Tab "Tài liệu" */
export const MINI_DOCS = [
  { name: 'Bảng bóc tách Vua Thầu.xlsx', meta: 'Cập nhật 2 giờ trước' },
  { name: 'Ghi chú họp tài chính', meta: 'Cập nhật hôm qua' },
]

/* Màu sự kiện trong modal tạo sự kiện ('' = theo lịch) */
export const EVENT_COLORS = [
  { color: '', dot: 'var(--primary)', title: 'Theo lịch' },
  { color: '#C0392B', title: 'Đỏ' },
  { color: '#B7791F', title: 'Cam' },
  { color: '#D4AC0D', title: 'Vàng' },
  { color: '#1E8E5A', title: 'Xanh lá' },
  { color: '#0E8A82', title: 'Ngọc lam' },
  { color: '#2F5DA8', title: 'Xanh dương' },
  { color: '#6D4FC2', title: 'Tím' },
  { color: '#8892A6', title: 'Xám' },
]

export const DATE_OPTIONS = [
  ['0', 'CN — 20/09'], ['1', 'T2 — 21/09'], ['2', 'T3 — 22/09'], ['3', 'T4 — 23/09 (hôm nay)'],
  ['4', 'T5 — 24/09'], ['5', 'T6 — 25/09'], ['6', 'T7 — 26/09'],
]

export const CAL_OPTIONS = [
  ['me', 'Chu Quang Thành'], ['qs', 'Lịch QS'], ['finance', 'Lịch Tài chính'], ['project', 'Lịch Dự án'], ['hr', 'Lịch nhân sự'],
]

export const ROOMS = [
  { room: 'Phòng họp 1 — B122', status: 'free', statusLabel: 'Trống', equip: 'Sức chứa 8 · TV 55" · Video conference' },
  { room: 'Phòng họp 2 — B123', status: 'busy', statusLabel: 'Đang dùng đến 15:00', equip: 'Sức chứa 12 · Bảng trắng · Loa họp' },
  { room: 'Phòng Lab vật liệu B123', status: 'free', statusLabel: 'Trống', equip: 'Sức chứa 20 · Máy chiếu · Mẫu vật liệu' },
]

/* ---- Hàm tiện ích (giống script trong lich.html) ---- */
export function decHourToLabel(h) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
}

export function initialsOf(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('')
}

export function timeToDecimalHour(str) {
  const parts = str.split(':')
  return parseInt(parts[0], 10) + parseInt(parts[1], 10) / 60
}

export function cellMinutesFromTop(px) { return Math.round(px / DAYCOL_ROW_HEIGHT * 60) + GRID_START * 60 }

export function fmtHM(totalMin) {
  const hh = Math.floor(totalMin / 60), mm = totalMin % 60
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
}

export function evdRandomLink() { return 'vc-sg.larksuite.com/j/' + Math.floor(400000000 + Math.random() * 99999999) }

export function randCode() {
  return Math.random().toString(36).slice(2, 5) + '-' + Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 5)
}
