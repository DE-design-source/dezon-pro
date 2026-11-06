import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../../api/qsApi'
import { getState, isAdminRole_ } from '../../state/store'
import { qsToast } from '../common/dialogs'

/* Nhân sự phụ trách từng dự án, dùng chung cho cột "Phụ trách" (Danh sách dự án) và mục "Nhân sự dự án" (hộp Thông tin dự án):
   dữ liệu công ty '__cty' khoá daPhuTrach {mã bản nháp đầu của dự án: {ql, dp, th}} - mỗi vai trò 1 mảng tên đăng nhập:
   ql = Quản lý (cột "Phụ trách" của Danh sách dự án), dp = Người điều phối, th = Người thực hiện. Bản cũ lưu mảng = Quản lý.
   users = tài khoản công ty (chỉ quản trị đọc được).
   Giữ ở cấp module như pcSlot.js để 2 nơi luôn khớp nhau sau mỗi lần giao. */
let snap = { map: {}, users: [] }
let mapLoaded = false
let usersLoaded = false
const subs = new Set()
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }
const set = p => { snap = { ...snap, ...p }; subs.forEach(fn => fn()) }

function load_(admin) {
  if (!mapLoaded) {
    mapLoaded = true
    api.getProjData('__cty').then(d => set({ map: (d && d.daPhuTrach) || {} }), () => { mapLoaded = false })
  }
  if (admin && !usersLoaded) {
    usersLoaded = true
    api.adminListUsers().then(r => set({ users: (Array.isArray(r) ? r : (r && r.users) || []).filter(u => u && u.username) }), () => { usersLoaded = false })
  }
}

/* -> {map, users, canEdit}; canEdit = quản trị (giao / bỏ nhân sự), người khác chỉ xem */
export function usePhuTrach() {
  const canEdit = isAdminRole_(getState().me)
  useEffect(() => { load_(canEdit) }, [canEdit])
  const s = useSyncExternalStore(subscribe, () => snap, () => snap)
  return { map: s.map, users: s.users, canEdit }
}

export const PT_ROLES = [['ql', 'Quản lý'], ['dp', 'Người điều phối'], ['th', 'Người thực hiện']]
/* {ql, dp, th} của 1 dự án (đọc được cả dạng mảng cũ = Quản lý) */
export function ptRoles_(v) {
  if (Array.isArray(v)) return { ql: v, dp: [], th: [] }
  const o = v || {}
  return { ql: Array.isArray(o.ql) ? o.ql : [], dp: Array.isArray(o.dp) ? o.dp : [], th: Array.isArray(o.th) ? o.th : [] }
}
/* Giao danh sách nhân sự của 1 vai trò cho dự án (key = mã bản nháp đầu), ghi ngay */
export async function setPhuTrach(key, list, role) {
  const r = ptRoles_(snap.map[key])
  r[role || 'ql'] = list
  const n = { ...snap.map }
  if (r.ql.length || r.dp.length || r.th.length) n[key] = r; else delete n[key]
  set({ map: n })
  try { await api.setProjData('__cty', 'daPhuTrach', n) } catch (e) { qsToast('Lỗi lưu nhân sự phụ trách: ' + ((e && e.message) || e)) }
}
