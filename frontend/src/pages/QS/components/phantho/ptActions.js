/* Thao tác dữ liệu của bảng Phần thô (projData.phanTho / ptVat) - port PUB/phantho.js, mỗi hàm giữ đúng chữ báo của bản gốc.
   Bảng là MẢNG các hạng mục {t, mode, loai, note, up, items:[{n, dvt, kl, dt, hs, dg, dgnt, lnPct, gc}]} lưu qua setProjData
   (hàng đợi 1,2 s) + bản dự phòng localStorage pt_<maDA> như ptPersist. Mỗi lần sửa: chép mảng -> sửa bản chép bằng hàm lib
   (ptEdit / ptAddToSec_ ...) -> ghi lại, để store đổi tham chiếu và các tab khác (Bảng điều khiển, Chi phí, Báo giá) tính lại.
   Nguồn: ptAddToSec_ 1662-1677 · ptApplyMau 1679-1689 · ptAddFromLib 1690-1716 · dtSetIn / dtResetIn / dtApply / dtRemove 379-468
   ptInfoSave_ 1891-1900 · ptEnsure / ptPersist 1934-1953 · ptEdit 2017-2034 · ptAddItem..ptReset 2046-2080 · ptEditSec_ 2340-2346
   ptMoveItem_ 2354-2367 · ptSelDel_ 1403-1411 · ptBulkEditRun_ 1460-1475 · ptFillDown_ 1516-1525 · ctFav_ 663-669 · ptExportXlsx sanpham.js:1309-1323 */
import { getState } from '../../state/store'
import { projDataSet_ } from '../../state/projData'
import { congTacActions } from '../../state/useCongTac'
import { qsToast as toast, qsConfirm } from '../common/dialogs'
import { downloadPost } from '../../api/files'
import {
  DT_BO, dtKey_, dtVals_, dtInVal_, dtSync_, dtApplyToTable_, dtSecs_,
  ptEnsureVals_, ptKey, ptAddToSec_ as libAddToSec, ptFindSec_, ptNewSec_, ptMakeItem_, ptEdit as libEdit,
} from '../../lib/phantho.js'
import { ptN } from '../../lib/format.js'
import { ptBlankItem_, PT_CELL_F, ptCellEditable_, ptXlsRows_ } from './ptModel'
import { ptUi, setPtUi, ptOvrAll_, ptInfoUser_, dtSaved_ } from './ptState'
import { spPTAll_ as spPTAllSp_, spPTList_ } from '../products/pt/ptModel'
import { getU } from '../products/list/spStore'
import { getP } from '../products/pt/ptStore'

/* ctxCopy_ (PUB/boc.js:8-12): bộ nhớ tạm, trình duyệt chặn thì chép qua textarea ẩn + execCommand; cả hai hỏng thì báo lỗi */
function execCopy_(txt) {
  const t = document.createElement('textarea')
  t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0'
  const host = document.querySelector('.qs-mroot') || document.body
  host.appendChild(t); t.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch (x) { ok = false }
  t.remove()
  if (!ok) toast('Không sao chép được: trình duyệt chặn bộ nhớ tạm')
}
export function ctxCopy_(txt) {
  txt = String(txt)
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).catch(() => execCopy_(txt)); return }
  } catch (e) { /* xuống cách cũ */ }
  execCopy_(txt)
}

function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch (e) { return null } }

/* ptEnsure: bảng + VAT của dự án đang mở (bản máy chủ, không có thì bản dự phòng trong máy) */
export function ptNow() {
  const S = getState()
  const ma = S.cur ? S.cur.maDA : ''
  const k = ptKey(ma)
  const v = ptEnsureVals_(S.projData, S.cur, lsJson(k), lsGet(k + '_vat'))
  return { maDA: ma, phanTho: v.phanTho, ptVat: v.ptVat }
}
const clone = a => JSON.parse(JSON.stringify(a || []))

/* ptPersist. keepHist = ghi từ ô của bảng tính (giữ lịch sử hoàn tác); mọi thao tác khác (thêm / xoá / kéo dòng) xoá lịch sử
   như bản gốc dựng lại lưới (lịch sử của Jspreadsheet mất theo). */
export function ptPersist(arr, keepHist) {
  const { maDA, ptVat } = ptNow()
  if (!maDA) return
  let v = Number(ptVat); if (!isFinite(v)) v = 0
  try { localStorage.setItem(ptKey(maDA), JSON.stringify(arr)); localStorage.setItem(ptKey(maDA) + '_vat', String(v)) } catch (e) { /* bỏ qua */ }
  projDataSet_('phanTho', arr); projDataSet_('ptVat', v)
  if (!keepHist) histClear_(maDA)
}
/* % VAT của bảng Phần thô (ô VAT trên thanh tiêu đề Bóc tách, như các đề mục khác) */
export function ptSetVat(val) {
  const { maDA } = ptNow()
  if (!maDA) return
  let v = Number(String(val == null ? '' : val).replace(',', '.'))
  if (!isFinite(v) || v < 0) v = 0
  if (v > 100) v = 100
  try { localStorage.setItem(ptKey(maDA) + '_vat', String(v)) } catch (e) { /* bỏ qua */ }
  projDataSet_('ptVat', v)
}
function needCur_() {
  if (!getState().cur) { toast('Chọn dự án trước khi thêm công tác vào bảng'); return false }
  return true
}

/* ═══ Thêm từ thư viện ═══ */
export function ptAddToSec(tsec) {
  if (!tsec) return
  if (!needCur_()) return
  const arr = clone(ptNow().phanTho)
  const added = libAddToSec(arr, tsec, ptOvrAll_())
  ptPersist(arr)
  toast(added ? ('Đã thêm ' + added + ' công tác của "' + String(tsec.t).split('\n')[0] + '"') : 'Nhóm này đã có đủ trong bảng')
}
// Lấy nguyên 1 bộ báo giá mẫu (khái toán sơ bộ) vào bảng
export async function ptApplyMau(m, tpl) {
  if (!m) return
  const secs = tpl.filter(s => (s.loai || '') === 'kt_sobo')
  if (ptNow().phanTho.length && !await qsConfirm('Đưa bộ "' + m.ten + '" vào bảng?\nCác hạng mục đang có vẫn giữ nguyên, hạng mục trùng tên sẽ được bổ sung dòng còn thiếu.')) return
  if (!getState().cur) return
  const arr = clone(ptNow().phanTho), ovr = ptOvrAll_()
  secs.forEach(sc => { libAddToSec(arr, sc, ovr) })
  ptPersist(arr)
  const n = arr.reduce((a, x) => a + ((x.items || []).length), 0)
  toast('Đã lấy bộ báo giá mẫu — bảng đang có ' + n + ' dòng')
}
// dich = {si, at}: kéo thả vào đúng hạng mục + vị trí (chỉ khi cùng kiểu nhập)
export function ptAddFromLib(tsec, a, dich) {
  if (!tsec || !a) return
  if (!needCur_()) return
  const arr = clone(ptNow().phanTho)
  const item = ptMakeItem_(tsec, a, ptOvrAll_())
  let sec, at, lechKieu = false
  if (dich && arr[dich.si] && String((arr[dich.si] || {}).mode || '') !== String(tsec.mode || '')) { lechKieu = true; dich = null }
  if (dich && arr[dich.si]) {
    sec = arr[dich.si]
    at = Math.max(0, Math.min((sec.items || []).length, Number(dich.at) || 0))
    sec.items.splice(at, 0, item)
  } else {
    sec = ptFindSec_(arr, tsec)
    if (!sec) { sec = ptNewSec_(tsec); arr.push(sec) }
    sec.items.push(item); at = sec.items.length - 1
  }
  setPtUi({ newRow: { si: arr.indexOf(sec), ii: at, t: Date.now() } })   // cuộn tới + nháy như bảng đèn
  ptPersist(arr)
  toast(lechKieu
    ? ('Đã thêm vào "' + String(sec.t).split('\n')[0] + '" — hạng mục bạn thả vào nhập theo kiểu khác nên không chèn vào đó được')
    : ('Đã thêm: ' + String(a[0]).split('\n')[0]))
}

/* ═══ Dự toán theo định mức (DT_BO) ═══ số liệu đầu vào lưu theo dự án ở localStorage qs_dt_<maDA>_<bộ> */
export function dtValsOf(maDA, bo) { return dtVals_(bo, dtSaved_(dtKey_(maDA, bo.id))) }
// các nhóm dự toán (nhân công / vật tư) dựng theo số liệu hiện tại
function dtTpl_(maDA) { return dtSync_([], bo => dtValsOf(maDA, bo)) }
function dtAfterInput_(maDA) {
  setPtUi(s => ({ dtVer: s.dtVer + 1 }))
  const arr = clone(ptNow().phanTho)
  if (dtApplyToTable_(dtTpl_(maDA), arr)) ptPersist(arr)   // cập nhật luôn KHỐI LƯỢNG các dòng đã thêm vào bảng
}
export function dtSetIn(bo, k, val) {
  const maDA = ptNow().maDA
  const v = dtValsOf(maDA, bo)
  v[k] = dtInVal_(bo, k, val)
  try { localStorage.setItem(dtKey_(maDA, bo.id), JSON.stringify(v)) } catch (e) { /* bỏ qua */ }
  dtAfterInput_(maDA)
}
export function dtResetIn(bo) {
  const maDA = ptNow().maDA
  try { localStorage.removeItem(dtKey_(maDA, bo.id)) } catch (e) { /* bỏ qua */ }
  dtAfterInput_(maDA)
  toast('Đã trả số liệu đầu vào về mặc định')
}
// MỘT NÚT = đưa CẢ bộ dự toán (nhân công & máy + vật tư) vào bảng
export function dtApply(bo, tpl) {
  if (!getState().cur) { toast('Chọn dự án trước khi thêm công tác vào bảng'); return }
  const arr = clone(ptNow().phanTho), ovr = ptOvrAll_()
  dtSecs_(tpl, bo).forEach(t => { libAddToSec(arr, t, ovr) })
  ptPersist(arr)
  toast('Đã đưa bộ dự toán vào bảng — sửa số liệu đầu vào là bảng tự cập nhật')
}
export function dtRemove(bo, tpl) {
  const ten = {}; dtSecs_(tpl, bo).forEach(t => { ten[t.t] = 1 })
  ptPersist(clone(ptNow().phanTho).filter(s => !ten[s.t]))
  toast('Đã gỡ bộ dự toán khỏi bảng')
}
export { DT_BO }

/* ═══ Sửa ô / dòng / hạng mục ═══ */
export function ptEdit(si, ii, f, val) {
  const arr = clone(ptNow().phanTho)
  if (libEdit(arr, si, ii, f, val)) ptPersist(arr)
}
export function ptEditSec(si, f, val) {
  const arr = clone(ptNow().phanTho); const sec = arr[si]; if (!sec) return
  const v = String(val == null ? '' : val).replace(/\s+$/, '')
  if (f === 't' && !v.trim()) { toast('Tên hạng mục không được để trống'); setPtUi(s => ({ dtVer: s.dtVer + 1 })); return false }
  if (sec[f] === v) return true
  sec[f] = v; ptPersist(arr)
  return true
}
export function ptAddItem(si) {
  const arr = clone(ptNow().phanTho); const sec = arr[si]; if (!sec) return
  sec.items.push(ptBlankItem_(sec)); ptPersist(arr)
}
export function ptDupItem(si, ii) {
  const arr = clone(ptNow().phanTho); const sec = arr[si]; if (!sec || !sec.items[ii]) return
  const ban = JSON.parse(JSON.stringify(sec.items[ii]))
  ;['_kl', '_tt', '_ttnt'].forEach(k => { delete ban[k] })
  sec.items.splice(ii + 1, 0, ban); ptPersist(arr)
  toast('Đã nhân bản dòng')
}
// nhiều dòng (bảng tính): từ dưới lên để chỉ số không lệch
export function ptDupMany(list) {
  const arr = clone(ptNow().phanTho)
  list.slice().sort((a, b) => b.si - a.si || b.ii - a.ii).forEach(q => {
    const sec = arr[q.si]; if (!sec || !sec.items[q.ii]) return
    const ban = JSON.parse(JSON.stringify(sec.items[q.ii])); ['_kl', '_tt', '_ttnt'].forEach(k => { delete ban[k] })
    sec.items.splice(q.ii + 1, 0, ban)
  })
  ptPersist(arr); toast('Đã nhân bản dòng')
}
export function ptInsertItem(si, ii) {
  const arr = clone(ptNow().phanTho); const sec = arr[si]; if (!sec) return
  sec.items.splice(ii + 1, 0, ptBlankItem_(sec)); ptPersist(arr)
}
export function ptDelItem(si, ii) {
  const arr = clone(ptNow().phanTho); const sec = arr[si]; if (!sec) return
  sec.items.splice(ii, 1); ptPersist(arr)
}
export function ptAddSection() {
  const arr = clone(ptNow().phanTho)
  arr.push({ t: 'HẠNG MỤC MỚI', mode: 'item', note: '', up: 0, items: [] }); ptPersist(arr)
}
export async function ptDelSection(si) {
  if (!await qsConfirm('Xoá cả hạng mục "' + ((ptNow().phanTho[si] || {}).t || '') + '" ?')) return
  const arr = clone(ptNow().phanTho); arr.splice(si, 1); ptPersist(arr)
}
// Xoá hết bảng -> chỉ còn tên cột
export async function ptReset() {
  const n = ptNow().phanTho.reduce((s, x) => s + ((x.items || []).length), 0)
  if (n && !await qsConfirm('Xoá toàn bộ ' + n + ' dòng trong bảng? Bạn sẽ chọn lại hạng mục từ danh sách bên trái.')) return
  ptPersist([])
  toast('Đã xoá bảng — chọn hạng mục từ danh sách bên trái')
}
// chuyển 1 dòng sang vị trí khác (cùng hạng mục hoặc sang hạng mục khác)
export function ptMoveItem(fs, fi, ts, ti, before) {
  const arr = clone(ptNow().phanTho); const A = arr[fs], B = arr[ts]; if (!A || !B) return
  const it = A.items[fi]; if (!it) return
  if (fs === ts && (ti === fi || (before ? ti : ti + 1) === fi)) return
  A.items.splice(fi, 1)
  if (fs === ts && ti > fi) ti--
  if (ti == null || ti < 0 || ti > B.items.length) ti = B.items.length
  // sang hạng mục khác kiểu -> bù các trường còn thiếu để không mất ô nhập
  if (A.mode !== B.mode) { const d = ptBlankItem_(B); Object.keys(d).forEach(k => { if (it[k] == null || it[k] === '') it[k] = d[k] }) }
  ;['_kl', '_tt', '_ttnt'].forEach(k => { delete it[k] })
  B.items.splice(before ? ti : ti + 1, 0, it)
  ptPersist(arr)
  if (fs !== ts) toast('Đã chuyển sang "' + String(B.t || '').split('\n')[0] + '"')
}
// Xoá các dòng đã chọn (list [{si, ii}]); title khác nhau giữa bảng thường và bảng tính như bản gốc
export async function ptDelMany(list, opts) {
  if (!list.length) return false
  if (!await qsConfirm(opts || ('Xoá ' + list.length + ' dòng đã chọn?'))) return false
  const arr = clone(ptNow().phanTho)
  list.slice().sort((x, y) => (y.si - x.si) || (y.ii - x.ii)).forEach(x => { const sec = arr[x.si]; if (sec && sec.items) sec.items.splice(x.ii, 1) })
  ptPersist(arr); toast('Đã xoá ' + list.length + ' dòng')
  return true
}
// Sửa hàng loạt 1 cột cho các dòng đã chọn
export function ptBulkEditRun(list, key, val, nhan) {
  if (String(val).trim() === '' && key !== 'ghichu') { toast('Chưa nhập giá trị mới'); return false }
  const fld = PT_CELL_F[key]; if (!fld) { toast('Cột này không sửa được'); return false }
  const arr = clone(ptNow().phanTho); let ok = 0
  list.forEach(q => { if (!ptCellEditable_(arr, q.si, key)) return; libEdit(arr, q.si, q.ii, fld, val); ok++ })
  if (!ok) { toast('Không dòng nào sửa được cột "' + nhan + '"'); return true }
  ptPersist(arr)
  toast('Đã đặt ' + nhan + ' cho ' + ok + ' dòng')
  return true
}
// Điền giá trị ô này xuống cả cột (mọi dòng của mọi hạng mục)
export async function ptFillDown(c) {
  const f = PT_CELL_F[c.key]
  if (!f) { toast('Cột "' + c.lbl + '" là cột tự tính — không điền xuống được'); return }
  const dich = []
  ptNow().phanTho.forEach((sec, si) => { (sec.items || []).forEach((it, ii) => { if (si === c.si && ii === c.ii) return; dich.push([si, ii]) }) })
  if (!dich.length) { toast('Bảng chưa có dòng nào khác'); return }
  if (!await qsConfirm('Điền "' + String(c.text || '').slice(0, 30) + '" cho ' + dich.length + ' dòng còn lại trong cột "' + c.lbl + '"?')) return
  const arr = clone(ptNow().phanTho)
  dich.forEach(x => { libEdit(arr, x[0], x[1], f, c.text) })
  ptPersist(arr)
  toast('Đã điền xuống ' + dich.length + ' dòng')
}

/* ═══ Lịch sử hoàn tác của bảng tính (chỉ các ô người dùng gõ) ═══ */
const HIST_MAX = 100
function histClear_(maDA) {
  const h = ptUi().hist || {}
  if (!h[maDA] || (!h[maDA].past.length && !h[maDA].future.length)) return
  setPtUi({ hist: { ...h, [maDA]: { past: [], future: [] } } })
}
export function ptHistOf(maDA) { return ((ptUi().hist || {})[maDA]) || { past: [], future: [] } }
/* Ghi các ô của bảng tính: cells [{si, ii (-1 = dòng nhóm), f, val}]; trả số ô đã ghi */
export function ptSheetWrite(cells, label) {
  const { maDA, phanTho } = ptNow(); if (!maDA || !cells.length) return 0
  const before = clone(phanTho), arr = clone(phanTho); let n = 0
  cells.forEach(c => {
    if (c.ii < 0 && c.f === 't') { const v = String(c.val == null ? '' : c.val).trim(); if (!v) { toast('Tên hạng mục không được để trống'); return } arr[c.si].t = v; n++; return }
    if (libEdit(arr, c.si, c.ii, c.f, c.val)) n++
  })
  if (!n) return 0
  ptPersist(arr, true)
  const h = ptHistOf(maDA)
  const past = h.past.concat([{ label: label || 'Sửa ô', before, after: clone(arr) }]).slice(-HIST_MAX)
  setPtUi(s => ({ hist: { ...(s.hist || {}), [maDA]: { past, future: [] } } }))
  return n
}
export function ptUndo(dir) {
  const { maDA } = ptNow(); if (!maDA) return
  const h = ptHistOf(maDA)
  const from = dir === 'redo' ? h.future : h.past
  if (!from.length) return
  const e = dir === 'redo' ? from[0] : from[from.length - 1]
  ptPersist(clone(dir === 'redo' ? e.after : e.before), true)
  const nh = dir === 'redo' ? { past: h.past.concat([e]), future: h.future.slice(1) } : { past: h.past.slice(0, -1), future: [e].concat(h.future) }
  setPtUi(s => ({ hist: { ...(s.hist || {}), [maDA]: nh } }))
}

/* ═══ Thông tin công tác (panel chi tiết) ═══ dùng chung cả công ty (projData ptInfo lưu '__cty') */
export function ptInfoSave(a, o, ptInfoKey) {
  const k = ptInfoKey(String(a[0]))
  const U = { ...ptInfoUser_(getState().projData) }
  if (!o.model && !o.anh && !o.ts && !o.gc && !o.pv && !o.tl) delete U[k]; else U[k] = o
  try { localStorage.setItem('qs_ptinfo', JSON.stringify(U)) } catch (e) { /* bỏ qua */ }
  projDataSet_('ptInfo', U)
  toast('Đã lưu thông tin công tác')
}

/* ═══ Công tác CSDL: yêu thích (ctFav_) ═══ */
export async function ctFavToggle(ctr) {
  const on = !ctr.yeuThich
  try {
    await congTacActions.ctFav([ctr.id], on)
    toast(on ? 'Đã thêm vào công tác yêu thích' : 'Đã bỏ khỏi công tác yêu thích')
  } catch (e) { toast('Lỗi: ' + e.message) }
}

/* Nút Excel của thanh bảng tính Phần thô = tải danh sách công tác (ptExportXlsx(false) -> spPTList_): bản gốc lọc theo ô tìm,
   bộ lọc công tác và khung nhìn của Danh sách SP (S._spFilters / #spSearch / S._ptView, dùng chung với tab đó) */
export async function ptExportXlsx(tpl) {
  const U = getU()
  const rows = ptXlsRows_(spPTList_(spPTAllSp_(tpl, ptOvrAll_()), U.q, U.f, getP().view, ptNow().phanTho))
  if (!rows.length) { toast('Không có công tác nào để tải'); return }
  try {
    await downloadPost('/export/cong-tac', { rows }, 'cong-tac-xay-dung.xlsx')
    toast('Đã tải ' + rows.length + ' công tác ra Excel')
  } catch (e) { toast('Không tải được Excel: ' + e.message) }
}
export { ptN }
