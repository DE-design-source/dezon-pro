/* Hằng số trang IT (yêu cầu hỗ trợ / thiết bị lấy từ máy chủ: pages/IT/api.js) */

/* Nhóm trạng thái hiển thị trên bộ lọc: [nhãn, màu chấm] — thứ tự như danh sách */
export const TICKET_GROUPS = [
  ['dangxuly', 'Đang làm', '#0E9F9A'],
  ['moi', 'Mở', '#16A34A'],
  ['chodoi', 'Chờ', '#E04848'],
  ['hoanthanh', 'Xong', '#8B3FD9'],
  ['dong', 'Đóng', '#8A8F98'],
]

/* Ghi chú cập nhật các hệ thống nội bộ do IT vận hành */
export const RELEASES = [
  { version: 'SiteFlow 2.4.1', date: '24/09/2026', improvements: [
    'Bảng mua hàng: giao nhiều người & phòng ban phụ trách mỗi bước, gửi thông báo khi chuyển bước.',
    'Sơ đồ tổ chức hiển thị theo tập đoàn — công ty thành viên — phòng ban.',
  ], fixes: [
    'Sửa lỗi thanh cuộn ngang của Pipeline khách hàng nằm khuất cuối trang.',
    'Sửa lỗi màu phân bổ kiêm nhiệm trùng nhau trong hồ sơ nhân sự.',
    'Sửa lỗi đồng bộ lịch Outlook bị lệch múi giờ.',
  ] },
  { version: 'VPN & Mạng nội bộ — bản vá 09/2026', date: '15/09/2026', improvements: [
    'Nâng cấp firmware router UniFi Dream Machine lên 4.0.6.',
    'Tách mạng khách (Guest) tại văn phòng HCM.',
  ], fixes: [
    'Sửa lỗi VPN ngắt kết nối sau 30 phút không hoạt động.',
    'Sửa lỗi camera công trường mất kết nối khi đổi IP động.',
  ] },
]

export const PRIO_LABEL = { urgent: 'Khẩn cấp', high: 'Quan trọng', medium: 'Bình thường', low: 'Thấp' }
export const PRIO_COLOR = { urgent: '#C2185B', high: 'var(--danger)', medium: 'var(--warn)', low: 'var(--text-muted)' }
/* Hạng mục yêu cầu */
export const TICKET_CATEGORIES = [['hardware', 'Phần cứng'], ['software', 'Phần mềm'], ['network', 'Mạng & kết nối'], ['account', 'Tài khoản & quyền'], ['other', 'Khác']]

/* [nhãn, màu chữ, màu nền] */
export const TICKET_STATUS = {
  moi: ['Mới', 'var(--primary)', 'var(--primary-tint)'],
  dangxuly: ['Đang xử lý', 'var(--warn)', 'var(--warn-tint)'],
  chodoi: ['Chờ linh kiện', 'var(--danger)', 'var(--danger-tint)'],
  hoanthanh: ['Hoàn thành', 'var(--success)', 'var(--success-tint)'],
  dong: ['Đóng', 'var(--text-muted)', 'var(--surface-alt)'],
}

export const ASSET_STATUS = {
  active: ['Đang hoạt động', 'var(--success)', 'var(--success-tint)'],
  maintenance: ['Cần bảo trì', 'var(--warn)', 'var(--warn-tint)'],
  broken: ['Hỏng, chờ sửa', 'var(--danger)', 'var(--danger-tint)'],
}

export const isOpenTicket = t => t.status !== 'hoanthanh' && t.status !== 'dong'

/* ---------- Trang yêu cầu (kanban quy trình xử lý) ---------- */
const st = (key, label, color, depts, owners, extra = {}) => ({ key, label, color, depts, owners, ...extra })
export const IT_STAGES = [
  st('tiepnhan', 'Tiếp nhận', '#8A8F98', ['IT'], []),
  st('chandoan', 'Chẩn đoán & phân loại', '#3B82F6', ['IT'], []),
  st('xuly', 'Đang xử lý', '#F59E0B', ['IT'], []),
  st('cho', 'Chờ linh kiện / phản hồi', '#E04848', ['Mua hàng'], []),
  st('kiemtra', 'Kiểm tra & bàn giao', '#8B5CF6', ['IT'], []),
  st('xong', 'Hoàn thành', '#16A34A', [], [], { done: true }),
  st('huy', 'Hủy', '#64748B', [], [], { closed: true }),
]
export const IT_FLOW_TEMPLATES = [
  { key: 'standard', label: 'Tiêu chuẩn', desc: 'Tiếp nhận → chẩn đoán → xử lý → chờ → kiểm tra → hoàn thành', stages: IT_STAGES },
  { key: 'quick', label: 'Xử lý nhanh', desc: 'Yêu cầu đơn giản (mật khẩu, quyền truy cập): bỏ chẩn đoán & chờ', stages: [
    st('tiepnhan', 'Tiếp nhận', '#8A8F98', ['IT'], []),
    st('xuly', 'Đang xử lý', '#F59E0B', ['IT'], []),
    st('xong', 'Hoàn thành', '#16A34A', [], [], { done: true }),
    st('huy', 'Hủy', '#64748B', [], [], { closed: true }),
  ] },
  { key: 'purchase', label: 'Cần mua thiết bị', desc: 'Có đề xuất mua: duyệt chi phí → mua hàng → lắp đặt', stages: [
    st('tiepnhan', 'Tiếp nhận', '#8A8F98', ['IT'], []),
    st('chandoan', 'Khảo sát & đề xuất', '#3B82F6', ['IT'], []),
    st('duyet', 'Duyệt chi phí', '#D9822B', ['Khối vận hành (COO)', 'Tài chính - Kế toán'], []),
    st('cho', 'Mua hàng', '#E04848', ['Mua hàng'], []),
    st('xuly', 'Lắp đặt & cấu hình', '#F59E0B', ['IT'], []),
    st('kiemtra', 'Kiểm tra & bàn giao', '#8B5CF6', ['IT'], []),
    st('xong', 'Hoàn thành', '#16A34A', [], [], { done: true }),
    st('huy', 'Hủy', '#64748B', [], [], { closed: true }),
  ] },
]

/* Hạng mục của yêu cầu cũ (chưa có trường category) — suy ra từ nội dung */
export function categoryOf(t) {
  if (t.category) return t.category
  const x = String(t.issue || '').toLowerCase()
  if (/wifi|vpn|mạng|camera|tín hiệu|router/.test(x)) return 'network'
  if (/mật khẩu|tài khoản|quyền|chữ ký|dung lượng|khoá sau/.test(x)) return 'account'
  if (/cài|license|phần mềm|excel|outlook|teams|autocad|revit|chạy chậm|email/.test(x)) return 'software'
  return 'hardware'
}
const TASKS_BY_CATEGORY = {
  hardware: ['Kiểm tra hiện trạng thiết bị', 'Xác định linh kiện / nguyên nhân hỏng', 'Đặt linh kiện thay thế', 'Thay thế & cấu hình lại', 'Bàn giao & hướng dẫn người dùng'],
  software: ['Xác nhận lỗi / yêu cầu với người dùng', 'Kiểm tra bản quyền & cấu hình máy', 'Cài đặt / cập nhật phần mềm', 'Kiểm thử chức năng', 'Bàn giao & hướng dẫn sử dụng'],
  network: ['Khảo sát tín hiệu tại vị trí', 'Kiểm tra thiết bị mạng & cấu hình', 'Bổ sung / thay thiết bị phát', 'Đo kiểm tốc độ & độ ổn định', 'Bàn giao cho người dùng'],
  account: ['Xác minh danh tính người yêu cầu', 'Cấp / khôi phục tài khoản & quyền', 'Thông báo & hướng dẫn người dùng'],
  other: ['Tiếp nhận & làm rõ yêu cầu', 'Xử lý yêu cầu', 'Bàn giao kết quả'],
}
/* Công việc của 1 yêu cầu — sinh từ hạng mục & trạng thái hiện tại */
export function buildTicketTasks(t, executors = []) {
  const titles = TASKS_BY_CATEGORY[categoryOf(t)] || TASKS_BY_CATEGORY.other
  const n = titles.length
  const exec = executors.length ? executors : [t.assignee].filter(Boolean)
  const stageOf = i => {
    if (t.status === 'hoanthanh') return 'xong'
    if (t.status === 'dong') return i === 0 ? 'xong' : 'huy'
    if (t.status === 'moi') return 'tiepnhan'
    if (t.status === 'chodoi') return i < Math.ceil(n / 2) - 1 ? 'xong' : i === Math.ceil(n / 2) - 1 ? 'cho' : 'tiepnhan'
    return i < 1 ? 'xong' : i === 1 ? 'xuly' : i === 2 ? 'chandoan' : 'tiepnhan' // đang xử lý
  }
  return titles.map((title, i) => ({
    id: `${t.id}-${i + 1}`, code: `#${t.id}.${i + 1}`, title, sub: '', due: i === n - 1 ? (t.deadline || '') : '',
    assignees: i === 0 ? [t.assignee].filter(Boolean) : exec, dept: 'IT', stage: stageOf(i),
  }))
}
/* Trạng thái yêu cầu suy ra từ công việc trên bảng */
export function statusFromTasks(tasks, stages, fallback) {
  const k = Object.fromEntries(stages.map(x => [x.key, x]))
  const live = tasks.filter(x => !k[x.stage]?.closed)
  if (!tasks.length) return fallback
  if (!live.length) return 'dong'
  if (live.every(x => k[x.stage]?.done)) return 'hoanthanh'
  if (live.some(x => /cho/.test(x.stage) || /chờ|mua hàng|duyệt/i.test(k[x.stage]?.label || ''))) return 'chodoi'
  if (live.some(x => !k[x.stage]?.done && x.stage !== 'tiepnhan')) return 'dangxuly'
  return live.some(x => k[x.stage]?.done) ? 'dangxuly' : 'moi'
}
