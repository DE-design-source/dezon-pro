/* Hàm thuần cho ma trận phân quyền 3 cấp (N21, AccessMatrix.jsx). "Tập quyền" = {module: {tab: [thao tác]}} đã mở rộng
   (không có "*", theo thứ tự danh mục, bỏ ô rỗng). Danh mục: GET /api/v1/access/catalog
   (backend/internal/modules/access/catalog.json). Bản máy chủ: access/grants.go (expand, legacyCompany, legacyStaff). */
import { GRANT_TABS } from '../../state/store'

const TAB_ALL = '*'
// Module khoá theo tính năng công ty (grants.go legacyFeatureModules) + module QS (mỗi tab = 1 khoá cũ)
const FEATURE_MODULES = { kinhdoanh: 1, thietke: 1, thicong: 1, hr: 1, muahang: 1 }
const QS = 'qs'

const arr = v => (Array.isArray(v) ? v : [])

/* Chuẩn hoá theo danh mục: bỏ module / tab / thao tác lạ, giữ thứ tự danh mục, bỏ ô rỗng */
export function normSet(s, cat) {
  const out = {}
  if (!s || !cat) return out
  cat.modules.forEach(m => {
    const sm = s[m.key]
    if (!sm) return
    const mo = {}
    m.tabs.forEach(t => {
      const have = arr(sm[t.key])
      const acts = t.actions.filter(a => have.indexOf(a) >= 0)
      if (acts.length) mo[t.key] = acts
    })
    if (Object.keys(mo).length) out[m.key] = mo
  })
  return out
}

/* grants đã lưu ({module: {tab | "*": [...]}}) -> tập quyền; "*" áp cho mọi tab, trừ thao tác tab không có */
export function expandGrants(raw, cat) {
  const out = {}
  if (!raw || typeof raw !== 'object' || !cat) return out
  cat.modules.forEach(m => {
    const g = raw[m.key]
    if (!g || typeof g !== 'object') return
    const star = arr(g[TAB_ALL])
    const mo = {}
    m.tabs.forEach(t => {
      const have = star.concat(arr(g[t.key]))
      const acts = t.actions.filter(a => have.indexOf(a) >= 0)
      if (acts.length) mo[t.key] = acts
    })
    if (Object.keys(mo).length) out[m.key] = mo
  })
  return out
}

export const setHas = (s, m, t, a) => !!(s && s[m] && arr(s[m][t]).indexOf(a) >= 0)

/* Giao với trần (ceil null = không giới hạn) */
export function clipSet(s, ceil, cat) {
  const n = normSet(s, cat)
  if (!ceil) return n
  const out = {}
  Object.keys(n).forEach(m => {
    const mo = {}
    Object.keys(n[m]).forEach(t => {
      const acts = n[m][t].filter(a => setHas(ceil, m, t, a))
      if (acts.length) mo[t] = acts
    })
    if (Object.keys(mo).length) out[m] = mo
  })
  return out
}

/* Đếm số ô (tab x thao tác) */
export function countSet(s) {
  let n = 0
  Object.keys(s || {}).forEach(m => Object.keys(s[m]).forEach(t => { n += arr(s[m][t]).length }))
  return n
}

/* Số module có ít nhất 1 tab được xem */
export const countModules = s => Object.keys(s || {}).filter(m => Object.keys(s[m]).some(t => setHas(s, m, t, 'view'))).length

export function sameSet(a, b, cat) {
  if (a == null || b == null) return a == null && b == null
  return JSON.stringify(normSet(a, cat)) === JSON.stringify(normSet(b, cat))
}

export function fullSet(cat) {
  const out = {}
  if (!cat) return out
  cat.modules.forEach(m => { out[m.key] = {}; m.tabs.forEach(t => { out[m.key][t.key] = t.actions.slice() }) })
  return out
}

/* Tập quyền -> grants gửi máy chủ. wildcard: module đủ mọi thao tác ở mọi tab ghi gọn {"*": [...]}
   (tab thêm vào danh mục sau này tự có) - dùng cho trần công ty */
export function toGrants(s, cat, wildcard = false) {
  const n = normSet(s, cat)
  if (!wildcard || !cat) return n
  cat.modules.forEach(m => {
    const mo = n[m.key]
    if (!mo || !m.tabs.every(t => arr(mo[t.key]).length === t.actions.length)) return
    const acts = cat.actions.map(a => a.key).filter(a => m.tabs.some(t => t.actions.indexOf(a) >= 0))
    n[m.key] = { [TAB_ALL]: acts }
  })
  return n
}

/* Trần công ty khi chưa đặt riêng: suy từ tính năng công ty (grants.go legacyCompany). Rỗng = mọi thứ */
export function legacyCompanySet(feats, cat) {
  const list = arr(feats).filter(Boolean)
  if (!list.length) return fullSet(cat)
  const out = {}
  if (!cat) return out
  cat.modules.forEach(m => {
    const mo = {}
    m.tabs.forEach(t => {
      const ok = m.key === QS ? list.indexOf(t.key) >= 0 : (!FEATURE_MODULES[m.key] || list.indexOf(m.key) >= 0)
      if (ok) mo[t.key] = t.actions.slice()
    })
    if (Object.keys(mo).length) out[m.key] = mo
  })
  return out
}

/* Quyền nhân viên khi chưa đặt riêng: suy từ users.perms (grants.go legacyStaff) */
export function legacyStaffSet(perms, cat) {
  const out = {}
  if (!cat) return out
  const ks = arr(perms)
  cat.modules.forEach(m => {
    const mo = {}
    m.tabs.forEach(t => {
      const ok = m.key === QS ? ks.indexOf(t.key) >= 0 : ks.indexOf(m.key) >= 0
      if (ok) mo[t.key] = t.actions.slice()
    })
    if (Object.keys(mo).length) out[m.key] = mo
  })
  return out
}

/* Khoá quyền cũ (users.perms) suy từ tập quyền, để các cổng cũ (canTab / canPage, máy chủ) vẫn chạy:
   tab QS được xem -> khoá tab; module khác có tab được xem -> khoá module; 'muahang' = tab Mua hàng QS hoặc trang Mua hàng */
export function legacyKeys(s) {
  const on = {}
  Object.keys(s || {}).forEach(m => {
    Object.keys(s[m]).forEach(t => {
      if (!setHas(s, m, t, 'view')) return
      on[m === QS ? t : m] = 1
    })
  })
  return GRANT_TABS.map(t => t[0]).filter(k => on[k])
}
