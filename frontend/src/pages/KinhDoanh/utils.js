import { AVATAR_COLORS } from '../../data/kinhDoanhData'

/* Hàm tiện ích — chép từ <script> của kinh-doanh.html */

export const FONT_STACK = "var(--app-font, 'Montserrat'), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}

export function fmtTy(v) { return v.toFixed(1).replace(/\.0$/, '') + ' tỷ' }

/* Chữ viết tắt trên thẻ kanban / bảng xếp hạng (chữ đầu + chữ cuối) */
export function initialsOfK(name) {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase()
}
/* Chữ viết tắt trong modal lead (2 chữ cuối) */
export function lmInitials(name) {
  return name.trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase()
}

export function medalK(rank) {
  if (rank === 1) return { bg: 'var(--gold-tint)', color: 'var(--gold)' }
  if (rank === 2) return { bg: 'var(--silver-tint)', color: 'var(--silver)' }
  if (rank === 3) return { bg: 'var(--bronze-tint)', color: 'var(--bronze)' }
  return { bg: 'var(--surface-alt)', color: 'var(--text-muted)' }
}

export function stageAccent(stageId) {
  if (stageId === 'khong-tham-gia') return { border: 'var(--gold)', bg: 'var(--gold-tint)', color: 'var(--gold)' }
  if (stageId === 'spam') return { border: 'var(--text-muted)', bg: 'var(--surface-alt)', color: 'var(--text-muted)' }
  if (stageId === 'truot-thau') return { border: 'var(--danger)', bg: 'var(--danger-tint)', color: 'var(--danger)' }
  if (stageId === 'giao-ns') return { border: 'var(--sales)', bg: 'var(--sales-tint)', color: 'var(--sales)' }
  if (stageId === 'dam-phan') return { border: 'var(--gold)', bg: 'var(--gold-tint)', color: 'var(--gold)' }
  if (stageId === 'thiet-ke') return { border: 'var(--primary)', bg: 'var(--primary-tint)', color: 'var(--primary)' }
  if (stageId === 'thi-cong' || stageId === 'tu-van') return { border: 'var(--success)', bg: 'var(--success-tint)', color: 'var(--success)' }
  return null
}

export function startOfWeek(d) {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7 // Thứ hai = 0
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}

/* filter = { time, from, to } */
export function matchesTimeFilter(lead, filter) {
  const { time, from, to } = filter
  if (time === 'all') return true
  if (!lead.createdAt) return false
  const d = new Date(lead.createdAt + 'T00:00:00')
  const now = new Date()
  if (time === 'today') return d.toDateString() === now.toDateString()
  if (time === 'week') {
    const start = startOfWeek(now)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    return d >= start && d < end
  }
  if (time === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (time === 'quarter') return d.getFullYear() === now.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3)
  if (time === 'year') return d.getFullYear() === now.getFullYear()
  if (time === 'custom') {
    if (!from && !to) return true
    if (from && lead.createdAt < from) return false
    if (to && lead.createdAt > to) return false
    return true
  }
  return true
}

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/* ---------- Đồng bộ sang tab Dự án (localStorage) ---------- */
const SYNC_KEY = 'siteflow-synced-projects'

export function pushSyncedProject(lead) {
  let arr = []
  try { arr = JSON.parse(localStorage.getItem(SYNC_KEY) || '[]') } catch { arr = [] }
  arr = arr.filter(p => p.id !== lead.id)
  arr.push({
    id: lead.id,
    name: lead.type.indexOf('—') !== -1 ? lead.type : (lead.name + ' — ' + lead.type),
    client: lead.name,
    stage: lead.stage,
    value: lead.value,
    updated: new Date().toLocaleDateString('vi-VN'),
  })
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(arr)) } catch { /* bỏ qua */ }
}

export function removeSyncedProject(id) {
  let arr = []
  try { arr = JSON.parse(localStorage.getItem(SYNC_KEY) || '[]') } catch { arr = [] }
  arr = arr.filter(p => p.id !== id)
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(arr)) } catch { /* bỏ qua */ }
}

/* ---------- Màu riêng theo nguồn khách (thẻ kanban, danh sách) ---------- */
export const noDau = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim()
const SRC_COLORS = [
  ['kien phong', '#1E8E5A'], ['decox', '#2563EB'], ['vua thau', '#B98900'], ['smart cons', '#7C3AED'],
  ['tin nghia', '#0E8A82'], ['hm cons', '#C2185B'], ['dezon', '#C2621A'], ['design', '#4F46E5'],
  ['google', '#D93025'], ['website', '#D93025'], ['hotline', '#B45309'], ['zalo', '#0068FF'], ['email', '#475569'],
]
const SRC_FALLBACK = ['#0891B2', '#9333EA', '#65A30D', '#DB2777', '#0D9488', '#EA580C', '#4338CA']
export function sourceColor(source) {
  const k = noDau(source)
  if (!k) return null
  const hit = SRC_COLORS.find(([w]) => k.indexOf(w) >= 0)
  let c = hit && hit[1]
  if (!c) { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 9973; c = SRC_FALLBACK[h % SRC_FALLBACK.length] }
  return { color: c, bg: `color-mix(in srgb, ${c} 14%, transparent)`, border: `color-mix(in srgb, ${c} 35%, transparent)` }
}

/* ---------- Phát hiện khách trùng (SĐT / email / tên) ----------
   Ô SĐT nhận nhiều số (cách nhau dấu phẩy, chấm phẩy, /, xuống dòng hoặc "hoặc"); so 9 số cuối. */
/* Độ dài 1 số theo đầu số: 0 + 9 số (di động) / 02 + 9 số (bàn); 84 thay cho 0; không rõ đầu số = 9 số */
const phoneLen = c => (c.startsWith('84') ? (c[2] === '2' ? 12 : 11) : c.startsWith('0') ? (c[1] === '2' ? 11 : 10) : 9)
/* Tách các số trong ô SĐT ('090 326 09 87', '+84 903 260 987', '0903260987 0912345678', '0903... (ext 12)'),
   ghép các nhóm chữ số liền nhau tới đủ độ dài 1 số; trả về dạng chuẩn bắt đầu bằng 0 */
export function phoneNorms(s) {
  const out = []
  let cur = ''
  const flush = () => { if (cur.length >= 9) out.push(cur.startsWith('84') && cur.length >= 11 ? '0' + cur.slice(2) : cur); cur = '' }
  String(s || '').split(/[,;/|\n]|ho[aặ]c|\bor\b/i).forEach(part => {
    ;(part.match(/\d+/g) || []).forEach(g => {
      if (!cur && g.length <= 2 && !/^(0|84)/.test(g)) return   // số lẻ như "SĐT 1:", "lần 2"
      cur += g
      while (cur.length >= phoneLen(cur)) { const n = phoneLen(cur); const x = cur.slice(0, n); cur = cur.slice(n); const keep = cur; cur = x; flush(); cur = keep }
    })
    flush()
  })
  return [...new Set(out)]
}
export function phoneKeys(s) {
  return [...new Set(phoneNorms(s).map(x => x.slice(-9)))]
}
export function emailKeys(s) {
  return [...new Set(String(s || '').toLowerCase().split(/[\s,;/|]+/).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))]
}
const NAME_PREFIX = /^(anh|chi|a\.|c\.|mr\.?|mrs\.?|ms\.?|co|chu|ong|ba|em|bac|di|cau|thay)\s+/
export function nameKey(s) {
  let k = noDau(s).replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 2; i++) k = k.replace(NAME_PREFIX, '')
  return k.split(' ').length >= 2 && k.length >= 6 ? k : ''
}
/* Khách trùng với thông tin đang nhập: [{lead, by: ['phone'|'email'|'name']}]; phone/email = chắc chắn, name = có thể */
export function findDuplicates({ phone, email, name }, leads, excludeId) {
  const ps = phoneKeys(phone), es = emailKeys(email), nk = nameKey(name)
  const res = []
  ;(leads || []).forEach(l => {
    if (excludeId != null && String(l.id) === String(excludeId)) return
    const by = []
    if (ps.length && phoneKeys(l.phone).some(x => ps.indexOf(x) >= 0)) by.push('phone')
    if (es.length && emailKeys(l.email).some(x => es.indexOf(x) >= 0)) by.push('email')
    if (nk && nameKey(l.name) === nk) by.push('name')
    if (by.length) res.push({ lead: l, by })
  })
  return res.sort((a, b) => (b.by.some(x => x !== 'name') - a.by.some(x => x !== 'name')))
}
/* Chỉ mục trùng chắc chắn (SĐT / email) cho cả danh sách: {id: [lead khác trùng]} */
export function duplicateIndex(leads) {
  const m = new Map(), idx = {}
  const add = (k, l) => { if (!m.has(k)) m.set(k, []); m.get(k).push(l) }
  ;(leads || []).forEach(l => { phoneKeys(l.phone).forEach(k => add('p' + k, l)); emailKeys(l.email).forEach(k => add('e' + k, l)) })
  m.forEach(arr => {
    if (arr.length < 2) return
    arr.forEach(l => { const id = String(l.id); const cur = idx[id] || []; arr.forEach(o => { if (o !== l && cur.indexOf(o) < 0) cur.push(o) }); idx[id] = cur })
  })
  return idx
}

/* File BOQ của khách (cột boq_file_name): bản cũ chỉ là tên tệp (mô phỏng, không có file); từ 2026-11-22 tải file thật lên
   /upload/file và lưu "<url>#<tên gốc>". Trả {name, url} (url rỗng = bản cũ chỉ có tên) hoặc null. */
export function boqOf(s) {
  const v = String(s || '').trim()
  if (!v) return null
  if (!/^(\/files\/|https?:\/\/)/i.test(v)) return { name: v, url: '' }
  const i = v.indexOf('#')
  const url = i >= 0 ? v.slice(0, i) : v
  const base = decodeURIComponent((url.split('/').pop() || '').replace(/^\d+-/, '')) || 'BOQ'
  return { name: (i >= 0 ? v.slice(i + 1).trim() : '') || base, url }
}
