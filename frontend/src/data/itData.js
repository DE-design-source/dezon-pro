/* Hằng số trang IT (yêu cầu hỗ trợ / thiết bị lấy từ máy chủ: pages/IT/api.js) */

/* Nhóm trạng thái hiển thị trên bộ lọc: [nhãn, màu chấm] — thứ tự như danh sách */
export const TICKET_GROUPS = [
  ['dangxuly', 'Đang làm', '#0E9F9A'],
  ['moi', 'Mở', '#16A34A'],
  ['chodoi', 'Chờ', '#E04848'],
  ['hoanthanh', 'Xong', '#8B3FD9'],
  ['dong', 'Đóng', '#8A8F98'],
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
