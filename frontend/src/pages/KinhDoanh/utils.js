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
  if (stageId === 'truot-thau') return { border: 'var(--danger)', bg: 'var(--danger-tint)', color: 'var(--danger)' }
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
