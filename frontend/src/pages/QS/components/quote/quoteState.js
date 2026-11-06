/* Trạng thái giao diện của tab Xuất báo giá (S.bg* / S.cover* của bản gốc), giữ ở cấp module để rời /qs rồi quay lại vẫn còn.
   Port: bgCfgSave_ / bgCfgLoad_ PUB/baogia.js:383-394 (localStorage qs_bgdoc {per, zoom, w, ord, sec}) · setCoverMau 33
   (qs_covermau) · bgSetView / bgGoPage 129-130 · bgSetPer_ / bgSetZoom_ 396-397 · bgColReset_ 358 · bgColTuyBien_ 359 ·
   bgSelToggle_ / bgSelAll_ 1000-1010 · bgTogglePerSec_ 1013 · coverLuu_ 38-47 · renderExport 794-806 (tải tờ bìa). */
import { useSyncExternalStore } from 'react'
import * as api from '../../api/qsApi'
import { isAbort } from '../../api/http'
import { getState } from '../../state/store'
import { qsToast as toast } from '../common/dialogs'

function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }

function loadCfg() {
  const o = { bgPer: 0, bgZoom: 'fit', bgColW: {}, bgColOrder: null, bgPerSec: true }
  let s = null
  try { s = JSON.parse(lsGet('qs_bgdoc') || 'null') } catch (e) { s = null }
  if (!s) return o
  if (s.per != null) o.bgPer = Number(s.per) || 0
  if (s.zoom) o.bgZoom = ['fit', '75', '100', '125'].indexOf(String(s.zoom)) >= 0 ? String(s.zoom) : 'fit'
  if (s.sec === false) o.bgPerSec = false
  if (s.w && typeof s.w === 'object') o.bgColW = s.w
  if (Array.isArray(s.ord) && s.ord.length) o.bgColOrder = s.ord
  return o
}

let Q = null
const subs = new Set()
function init() {
  Q = {
    bgView: 'doc', bgPage: 1, coverMau: 'm2', bgNodes: {},
    areaOpen: false, tkOpen: false, colMo: false,
    cover: { maDA: '', rows: [], status: 'idle', error: '' },
    exporting: false,
    ...loadCfg(),
  }
}
function cur() { if (!Q) init(); return Q }
export function setQ(patch) { Q = { ...cur(), ...(typeof patch === 'function' ? patch(cur()) : patch) }; subs.forEach(fn => fn()) }
export const getQ = cur
export function useQuoteUi() { return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, cur, cur) }

function cfgSave() {
  const q = cur()
  lsSet('qs_bgdoc', JSON.stringify({ per: Number(q.bgPer) || 0, zoom: q.bgZoom || 'fit', w: q.bgColW || {}, ord: q.bgColOrder || null, sec: q.bgPerSec !== false }))
}
export function bgSetView(v) { setQ({ bgView: v, bgPage: 1 }) }
export function bgGoPage(n) { setQ({ bgPage: n }) }
export function bgSetPer_(v) { setQ({ bgPer: Number(v) || 0, bgPage: 1 }); cfgSave() }
export function bgSetZoom_(v) { setQ({ bgZoom: v }); cfgSave() }
export function bgTogglePerSec_() { setQ(q => ({ bgPerSec: !(q.bgPerSec !== false), bgPage: 1 })); cfgSave() }
/* chỉ còn 1 bố cục tờ bìa (Mẫu 2 cũ): mọi lời gọi đều về 'm2' */
export function setCoverMau() { lsSet('qs_covermau', 'm2'); setQ({ coverMau: 'm2' }) }
export function bgColReset_() { setQ({ bgColW: {}, bgColOrder: null }); cfgSave(); toast('Đã trả cột về mặc định') }
export function bgColTuyBien_(q) { return !!(q.bgColOrder && q.bgColOrder.length) || Object.keys(q.bgColW || {}).length > 0 }
export function setColW(w, save) { setQ({ bgColW: w }); if (save) cfgSave() }
export function setColOrder(ord) { setQ({ bgColOrder: ord }); cfgSave() }
export function bgSelToggle_(code) {
  const sel = { ...cur().bgNodes }
  if (sel[code]) delete sel[code]; else sel[code] = 1
  setQ({ bgNodes: sel, bgPage: 1 })
}
export function bgSelAll_(codes) {
  const sel = {}; (codes || []).forEach(c => { sel[c] = 1 })
  setQ({ bgNodes: sel, bgPage: 1 })
}

/* ---- Tờ bìa (S.cover / S._coverDA) ---- */
const coverOf = () => cur().cover
export function setCoverRows(maDA, rows) { setQ({ cover: { maDA, rows, status: 'ok', error: '' } }) }
/* renderExport: tờ bìa chưa nạp cho dự án đang mở -> getCoverOrInit */
let loadSeq = 0
export async function coverEnsure(maDA, force) {
  const c = coverOf()
  if (!maDA) return
  if (!force && c.maDA === maDA && (c.status === 'ok' || c.status === 'loading')) return
  const seq = ++loadSeq
  setQ({ cover: { maDA, rows: [], status: 'loading', error: '' } })
  /* Bỏ kết quả (đã đổi dự án / bị huỷ) mà vẫn là lần tải mới nhất: trả về 'idle', không để kẹt 'loading' - bản gốc chỉ nhớ
     _coverDA khi tải xong (renderExport 797-803) nên quay lại dự án là tải lại */
  const boQua = () => { if (seq === loadSeq) setQ({ cover: { maDA: '', rows: [], status: 'idle', error: '' } }) }
  try {
    const cv = (await api.getCoverOrInit(maDA)) || []
    if (seq !== loadSeq || !getState().cur || getState().cur.maDA !== maDA) { boQua(); return }     // đã đổi dự án trong lúc chờ
    setCoverRows(maDA, cv)
  } catch (e) {
    if (seq !== loadSeq) return
    if (isAbort(e)) { boQua(); return }
    setQ({ cover: { maDA, rows: [], status: 'error', error: e.message } })
  }
}
/* coverLuu_: gom thay đổi trong 0,6 s; mỗi lúc CHỈ 1 lần ghi (máy chủ "chèn mới rồi xoá cũ" - 2 lần ghi chồng nhau làm
   tờ bìa nhân đôi); đang ghi mà có thay đổi mới thì ghi tiếp 1 lần khi xong. Nhớ đúng dự án lúc sửa.
   Mỗi lần ghi (tự lưu, nút Lưu, xuất Excel) có số thứ tự `lan` (coverBatDauGhi_); sửa nào trước lúc lần ghi bắt đầu thì nằm
   trong lần ghi đó (gửi trọn bảng đang hiện).
   xong(maDA, ok, lan, conCho): gọi sau MỖI lần tự lưu; conCho = còn sửa mới chờ ghi (lần ghi sau gửi lại trọn bảng).
   Lưu lỗi mà không còn sửa mới chờ ghi: báo lỗi rồi ô quay về bản đã lưu trên máy chủ (coverVeBanLuu_). */
let cvT = null; let cvCho = null; let cvDang = 0; let cvXong = null; let cvLan = 0; let cvVeSau = ''
export function coverBatDauGhi_() { return ++cvLan }
export const coverLanGhi_ = () => cvLan
/* số thứ tự lần tự lưu đang gửi lên máy chủ, 0 = không có */
export const coverLanDang_ = () => cvDang
export function coverLuu_(xong) {
  const ma = getState().cur && getState().cur.maDA; if (!ma) return
  cvCho = ma; clearTimeout(cvT)
  if (xong) cvXong = xong
  cvT = setTimeout(function chay() {
    if (cvDang) { cvT = setTimeout(chay, 300); return }
    const m = cvCho; cvCho = null
    const c = getState().cur
    if (!m || !c || c.maDA !== m || coverOf().maDA !== m) return
    const lan = coverBatDauGhi_(); cvDang = lan; cvVeSau = ''
    api.saveCover(m, coverOf().rows).then(() => true, e => { toast('Lỗi lưu tờ bìa: ' + e.message); return false }).then(ok => {
      cvDang = 0
      const conCho = !!cvCho
      if (cvXong) cvXong(m, ok, lan, conCho)
      if (conCho) return // còn sửa mới chờ ghi: lần ghi sau quyết định ô
      const ve = !ok || cvVeSau === m; cvVeSau = ''
      if (ve) coverVeBanLuu_(m)
    })
  }, 600)
}
/* coverVeBanLuu_: lưu tờ bìa lỗi -> nạp lại bản đã lưu trên máy chủ (chưa lưu lần nào thì là bản dựng từ mẫu, như lúc mở tab)
   để ô không giữ số vừa bị từ chối. Đang có lần tự lưu gửi đi (vd nút Lưu lỗi lúc tự lưu đang chạy) thì hẹn nạp lại khi lần đó
   xong. Bỏ khi đã đổi dự án hoặc có sửa mới chờ ghi (kể cả sửa trong lúc đang nạp) - lần ghi sau gửi lại trọn bảng. */
export async function coverVeBanLuu_(maDA) {
  const dungDA = () => getState().cur && getState().cur.maDA === maDA && coverOf().maDA === maDA
  if (cvDang && !cvCho && dungDA()) { cvVeSau = maDA; return false }
  const conDung = () => !cvCho && !cvDang && dungDA()
  if (!conDung()) return false
  try {
    const cv = (await api.getCoverOrInit(maDA)) || []
    if (!conDung()) return false
    setCoverRows(maDA, cv)
    return true
  } catch (e) { return false }
}
/* coverSave / doExport: huỷ lần lưu đang chờ trước khi ghi tay */
export function coverCancelPending() { clearTimeout(cvT); cvCho = null }
export const coverBusy = () => !!cvDang
