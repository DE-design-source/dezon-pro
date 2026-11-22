/* Phân quyền 3 cấp (N21) cho trang QS: can('qs', tab, thao tác) của services/accessService.js, quy đổi tab của trang QS.
   - Trang phụ dùng chung quyền tab: Danh sách dự án / Đơn vị thiết kế -> Dự án, Nhà cung cấp -> Danh sách sản phẩm (như canTab cũ).
   - Không nạp được /access/me (máy chủ cũ, lỗi mạng): theo quyền cũ canTab cho mọi thao tác (máy chủ vẫn kiểm lại).
   - Duyệt sản phẩm (M14.6) và duyệt sửa dự án không thuộc ma trận này.
   useQsCan() -> (tab, action = 'view') => bool (vẽ lại khi quyền đổi); qsCan(tab, action) dùng ngoài React;
   denyQs(tab, action) báo "chưa được cấp quyền" (gộp các lần báo trùng) và trả true khi bị chặn. */
import { useEffect } from 'react'
import { can as accCan, getAccess, loadAccessCatalog, useAccess } from '../../../services/accessService'
import { canTab, getState, PERM_TABS, toast } from './store'

// Quyền cũ (chưa nạp được quyền thực): trang phụ dùng chung quyền tab như tabAlias của store
const TAB_OF = { dsduan: 'duan', dsntk: 'duan', dsncc: 'sanpham' }
export const qsTabOf = tab => TAB_OF[tab] || tab
const EXTRA_LABEL = { dsduan: 'Danh sách dự án', dsncc: 'Nhà cung cấp', dsntk: 'Đơn vị thiết kế' }

const ACTION_LABEL = { view: 'Xem', create: 'Thêm', edit: 'Sửa', delete: 'Xoá', approve: 'Duyệt', export: 'Xuất' }
const tabLabel = t => { const x = PERM_TABS.find(p => p[0] === t); return x ? x[1] : (EXTRA_LABEL[t] || t) }

export function qsCan(tab, action = 'view') {
  const a = getAccess()
  if (!a.ready && a.error) return !!canTab(qsTabOf(tab))
  return !!accCan('qs', tab, action)
}

/* Thao tác tab hỗ trợ (danh mục máy chủ, nạp 1 lần); chưa nạp xong = null */
let support = null
function loadSupport() {
  if (support) return
  loadAccessCatalog().then(c => {
    const m = ((c && c.modules) || []).find(x => x.key === 'qs')
    const out = {}
    if (m) (m.tabs || []).forEach(t => { out[t.key] = t.actions || [] })
    support = out
  }, () => { /* thử lại lần sau */ })
}
const supports = (tab, action) => !!(support && support[tab] && support[tab].indexOf(action) >= 0)

/* Thao tác trên dòng bóc tách (thêm / sửa / xoá / đổi chỗ) tính theo tab đang mở khi tab đó có thao tác này,
   ngược lại theo tab fallback (mặc định Bóc tách: vd thêm SP vào dự án từ Danh sách sản phẩm).
   Danh mục chưa nạp xong: tab đang mở có quyền thao tác này thì tính theo tab đó (không tự rơi về Bóc tách). */
const LINE_TABS = { boc: 1, chiphi: 1, export: 1, muahang: 1, duan: 1 }
export function lineTab(action, fallback = 'boc') {
  loadSupport()
  const t = qsTabOf(getState().tab)
  if (!LINE_TABS[t]) return fallback
  if (!support) return qsCan(t, action) ? t : fallback
  return supports(t, action) ? t : fallback
}

let lastMsg = ''
let lastAt = 0
export function denyQs(tab, action) {
  if (qsCan(tab, action)) return false
  const t = qsTabOf(tab)
  const msg = 'Bạn chưa được cấp quyền ' + (ACTION_LABEL[action] || action) + ' ở QS > ' + tabLabel(t)
  const now = Date.now()
  if (msg !== lastMsg || now - lastAt > 2000) toast(msg)
  lastMsg = msg
  lastAt = now
  return true
}

export function useQsCan() {
  const acc = useAccess()   // vẽ lại khi quyền / phiên đổi
  useEffect(() => { if (acc.ready) loadSupport() }, [acc.ready])
  return qsCan
}
