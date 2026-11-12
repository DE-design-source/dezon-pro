/* Trạng thái giao diện của Phần thô (thay các biến S._pt* của bản gốc), giữ ở cấp module để thư viện bên trái,
   panel chi tiết và bảng bên phải dùng chung, còn nguyên khi đổi tab.
   Nguồn: S._ptContractor (ptSetContractor phantho.js:1650) · S._ptLibCol (ptLibToggle 1651) · S._ptDetail / S._ptInfoEdit (1890-1932)
   S._dtIn (dtVals_ 369-378, nay đọc lại theo dự án) · S.ptCf qs_ptcf (308-309, 1536-1539) · S._ptCols / _ptOrder / _ptColW / _ptSort /
   _ptSortDir / _ptFilter / _ptFreeze / _ptFrzRows / _ptSel / _ptAnchor / _ptNew (renderPhanTho 2154-2328 và các hàm quanh nó). */
import { useSyncExternalStore } from 'react'
import { PT_COLS } from './ptModel'

function lsJson(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v } catch (e) { return d } }

const allCols = () => { const o = {}; PT_COLS.forEach(c => { o[c[0]] = true }); return o }

let st = {
  contractor: '', vtCat: '', favOnly: false, sidePop: null, libCol: {}, detail: null, infoEdit: false, dtVer: 0,
  cf: lsJson('qs_ptcf', {}) || {},
  cols: allCols(), order: PT_COLS.map(c => c[0]), colW: {}, sort: '', sortDir: 'asc', filter: {},
  freeze: 0, frzRows: 0, sel: {}, anchor: null, newRow: null, libDrag: null, hist: {},
  colEdit: null, prefVer: 0,   // chế độ sửa bộ cột (ptPresets.js) · tăng mỗi lần ghi bộ cột để khung vẽ lại
}
const subs = new Set()
export function ptUi() { return st }
export function setPtUi(patch) {
  const p = typeof patch === 'function' ? patch(st) : patch
  if (!p) return
  st = { ...st, ...p }
  subs.forEach(fn => fn())
}
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }
export function usePtUi(sel) {
  return useSyncExternalStore(subscribe, () => (sel ? sel(st) : st), () => (sel ? sel(st) : st))
}

/* Giá sửa tay của thư viện mẫu (qs_ptovr, phantho.js:1169-1180) - do Danh sách SP (chế độ Phần thô) ghi; ở đây chỉ đọc */
export function ptOvrAll_() { return lsJson('qs_ptovr', {}) || {} }
/* Thông tin công tác người dùng tự nhập: bản trên máy chủ (projData.ptInfo, dùng chung cả công ty), dự phòng bản trong máy */
export function ptInfoUser_(projData) {
  const d = projData && projData.ptInfo
  if (d && typeof d === 'object') return d
  return lsJson('qs_ptinfo', {}) || {}
}
/* Số liệu đầu vào của bộ dự toán theo dự án (dtKey_), đọc lại mỗi lần để đổi dự án không dùng nhầm số của dự án trước */
export function dtSaved_(key) { return lsJson(key, null) }
