/* Thao tác của tab Bóc tách - port các hàm ghi của bản gốc, chạy trên store QS (optimistic như bản gốc).
   Port: addProdObj boc.js:291-340 · addFloorName 192-205 · addItemToFloor 209-220 · moveFloor 657-661 · renameFloor 664-676 ·
   ctxDupRow / ctxInsertRow 33-46 · frReplaceAll 123-138 (phần bảng dòng) · tkApplyEdits_ 974-992 · tkBulkDup_ 1117-1128 ·
   tkBulkSheet_ 1775-1783 · pickProduct 732-736 · submitCreateProduct 776-797 · lnUpdApply_ 1488-1504 · giaSyncApply_ 1574-1591 ·
   setVat app.js:1950-1958 · addCustomGroup / delCustomGroup 1597-1612 · btXlsx_ bangtinh.js:928-939 · luuLoi_ sanpham.js:362-366. */
import * as api from '../../../api/qsApi'
import { downloadPost } from '../../../api/files'
import {
  getState, setState, addLine, updateLine, moveLine, reloadLines, updateProject, syncProj, newTmpId, isTmp, lineOf_,
} from '../../../state/store'
import { projDataSet_ } from '../../../state/projData'
import { qsToast as toast, qsConfirm, qsAsk } from '../../common/dialogs'
import { addProdSame_, addProdBuild_, addProdSl_, addProdFloor_, giaDongTuSP_, tkFieldsFor_ } from '../../../lib/calc.js'
import { nodeName, customGroups } from '../../../lib/tree.js'
import { FR_FIELDS, tkSheetCo_, tkSheetLbl_ } from '../../../lib/columns.js'
import { floorsList, CHUA_PHAN_TANG } from '../../../lib/sheetModel.js'

const cur = () => getState().cur
let luuLoiAt = 0
export function luuLoi_(e, viec) {
  const now = Date.now(); if (luuLoiAt && now - luuLoiAt < 4000) return; luuLoiAt = now
  try { console.error('[lưu lỗi] ' + viec, e) } catch (x) { /* bỏ qua */ }
  toast('Chưa lưu được ' + viec + ': ' + String((e && e.message) || e || '').slice(0, 80))
}
const sheetExtra = (sheet, node) => ((sheet && tkSheetCo_(node)) ? { sheet } : null)

/* Thêm 1 sản phẩm (port addProdObj): gộp số lượng khi trùng (addProdSame_), không thì dòng tạm hiện ngay rồi lưu.
   opts: {floor, sl, node, sheet}. Dòng mới luôn nằm cuối danh sách như bản gốc: thả lên 1 dòng chỉ để chọn tầng
   (tkSheetNhanTha_ bangtinh.js:625-642, thả bảng thường boc.js:625-631), không đánh lại STT cả dự án.
   Trả {lineId, merged} hoặc null. */
export async function addProdObj(p, opts = {}) {
  const S = getState()
  if (!S.cur) { toast('Chưa chọn dự án — bấm Tạo dự án +'); return null }
  const sl = addProdSl_(opts.sl)
  const floor = addProdFloor_(opts.floor, '')
  const node = opts.node || S.node
  const nd = String(node || '')
  const sheet = opts.sheet || ''
  const same = addProdSame_(S.lines, p, floor, nd, sheet, node)
  if (same) {
    updateLine(same.lineId, { soLuong: (Number(same.soLuong) || 0) + sl })
    toast('+' + sl + ' số lượng: ' + p.ten)
    return { lineId: same.lineId, merged: true }
  }
  const b = addProdBuild_(p, S.products, nd, floor, sl, sheet, node, newTmpId())
  toast('Đã thêm: ' + p.ten + (sl > 1 ? (' ×' + sl) : ''))
  const pending = addLine(b.prod, sl, b.temp)      // dòng tạm vào bảng ngay trong lần gọi này
  if (opts.onTemp) opts.onTemp(b.temp.lineId)
  const l = await pending
  if (!l) return null
  return { lineId: l.lineId, merged: false }
}

/* Thêm cả combo: SP chính + các SP đi kèm (qbPickCombo_ boc.js:406-420, pdAddCombo_) */
export async function addCombo(p, opts = {}) {
  if (!getState().cur) { toast('Chưa chọn dự án'); return }
  let list = []
  try { list = (await api.getCombo(String(p.recordId || p.ma))) || [] } catch (e) { list = [] }
  await addProdObj(p, { ...opts, sl: 1 })
  for (let k = 0; k < list.length; k++) await addProdObj(list[k], { ...opts, sl: Number(list[k].comboSL) || 1 })
  toast(list.length ? ('Đã thêm combo "' + p.ten + '": sản phẩm chính + ' + list.length + ' sản phẩm đi kèm')
    : ('Đã thêm "' + p.ten + '" — combo chưa khai báo sản phẩm đi kèm'))
}

/* "Thêm hạng mục": 1 dòng trống vào tầng (addItemToFloor) */
export async function addItemToFloor(tang, node, sheet) {
  if (!cur()) { toast('Chưa chọn dự án'); return null }
  if (tang === CHUA_PHAN_TANG) tang = ''
  const l = await addLine({ ten: 'Hạng mục mới', dvt: 'Cái', donGiaVon: 0, donGiaBan: 0, nhom: node, hangMuc: nodeName(node), loai: nodeName(node), tang,
    extra: sheetExtra(sheet, node) }, 1)
  if (l) toast('Đã thêm hạng mục' + (tang ? ' vào ' + tang : '') + ' — sửa ngay trong bảng')
  return l
}

/* "Chèn dòng trống bên dưới" (ctxInsertRow boc.js:38-46): SL 0, cùng hạng mục + tầng + sheet của dòng đó,
   rồi dời dòng mới xuống NGAY DƯỚI dòng đang chọn (bản gốc chỉ thêm vào cuối tầng). */
export async function insertRowBelow(lineId, node, sheet) {
  const c = cur(); if (!c) return null
  const l = lineOf_(lineId)
  const nd = (l && l.nhom) || node
  const tang = l ? (l.tang || '') : ''
  const nl = await addLine({ ten: 'Hạng mục mới', dvt: 'Cái', donGiaVon: 0, donGiaBan: 0, nhom: nd, loai: nodeName(nd), tang,
    extra: sheetExtra(sheet, node) }, 0)
  if (!nl) return null
  if (l && nl.lineId) await moveLine(nl.lineId, tang, lineId, false)
  toast('Đã chèn dòng trống')
  return nl
}

function dupProd_(l) {
  const prod = { ...l, ma: l.maSP }
  delete prod.lineId; delete prod.recordId; delete prod.fmt; delete prod._pending
  return prod
}
/* Nhân bản: 1 dòng không hỏi (ctxDupRow), nhiều dòng hỏi lại (tkBulkDup_) */
export async function dupRows(ids) {
  const c = cur(); const ls = ids.map(lineOf_).filter(Boolean); if (!ls.length || !c) return 0
  if (ls.length > 1 && !await qsConfirm('Nhân bản ' + ls.length + ' dòng đã chọn?')) return 0
  let loi = 0
  for (let i = 0; i < ls.length; i++) {
    const nl = await addLine(dupProd_(ls[i]), Number(ls[i].soLuong) || 1)
    if (!nl) loi++
  }
  toast(ls.length > 1 ? ('Đã nhân bản ' + (ls.length - loi) + ' dòng' + (loi ? (' · ' + loi + ' lỗi') : '')) : (loi ? 'Lỗi nhân bản' : 'Đã nhân bản dòng'))
  return ls.length - loi
}

/* Áp 1 loạt thay đổi (tkApplyEdits_): bỏ dòng tạm, gộp theo dòng, hỏi lại khi > 60 dòng, gửi theo lô 6 */
export async function applyEdits(edits, nhan) {
  let tam = 0
  edits = (edits || []).filter(e => { if (e && isTmp(e.id)) { tam++; return false } return true })
  if (tam) toast(tam + ' dòng vừa thêm đang lưu — chưa áp thay đổi cho các dòng đó, thử lại sau 1–2 giây')
  const byId = {}
  edits.forEach(e => { if (!e || !e.fields) return; byId[e.id] = { ...(byId[e.id] || {}), ...e.fields } })
  const ids = Object.keys(byId); if (!ids.length) { toast('Không có ô nào sửa được'); return 0 }
  if (ids.length > 60 && !await qsConfirm('Thao tác này sửa ' + ids.length + ' dòng. Tiếp tục?')) return 0
  let loi = 0
  for (let i = 0; i < ids.length; i += 6) {
    const rs = await Promise.all(ids.slice(i, i + 6).map(id => updateLine(id, byId[id])))
    rs.forEach(r => { if (!r) loi++ })
  }
  toast((nhan || 'Đã cập nhật') + ' · ' + ids.length + ' dòng' + (loi ? (' · ' + loi + ' dòng lỗi') : ''))
  return ids.length
}
export function bulkSheet(ids, v) {
  return applyEdits(ids.map(lineOf_).filter(Boolean).map(l => {
    const ex = { ...(l.extra || {}) }
    if (v) ex.sheet = v; else delete ex.sheet
    return { id: l.lineId, fields: { extra: ex } }
  }), v ? ('Đã đưa vào sheet ' + tkSheetLbl_(v)) : 'Đã bỏ khỏi sheet')
}

/* Thay tất cả trong các trường chữ của dòng thuộc đề mục (frReplaceAll) */
export function replaceAll(q, rep, node) {
  if (!q) { toast('Nhập từ cần tìm'); return 0 }
  const lines = getState().lines.filter(l => l.nhom === node || String(l.nhom || '').indexOf(node + '.') === 0)
  let n = 0
  lines.forEach(l => {
    const patch = {}
    FR_FIELDS.forEach(f => { const v = String(l[f] == null ? '' : l[f]); if (v.indexOf(q) >= 0) patch[f] = v.split(q).join(rep) })
    if (Object.keys(patch).length) { updateLine(l.lineId, patch); n++ }
  })
  toast(n ? ('Đã thay ở ' + n + ' dòng') : 'Không tìm thấy “' + q + '”')
  return n
}

/* ---- Tầng / phòng ---- */
export async function addFloorName(name) {
  const c = cur(); if (!c) { toast('Chưa chọn dự án'); return null }
  name = String(name || '').trim().toUpperCase(); if (!name) return null
  const list = (c.tangTuTao ? String(c.tangTuTao).split('|') : []).map(s => s.trim()).filter(Boolean)
  if (list.indexOf(name) >= 0) { toast('Tầng "' + name + '" đã có — chuyển sang đang thêm'); return name }
  list.push(name)
  try {
    await updateProject(c.maDA, { tangTuTao: list.join('|') })
    toast('Đã thêm tầng: ' + name)
    return name
  } catch (e) { toast('Lỗi: ' + e.message); return null }
}
export async function moveFloor(from, to, sau) {
  const c = cur(); if (!c) return
  const fl = floorsList(c, getState().lines).filter(t => t !== CHUA_PHAN_TANG)
  const fi = fl.indexOf(from); let ti = fl.indexOf(to); if (fi < 0 || ti < 0 || fi === ti) return
  fl.splice(fi, 1); ti = fl.indexOf(to); fl.splice(sau ? ti + 1 : ti, 0, from)
  try { await updateProject(c.maDA, { tangTuTao: fl.join('|') }); toast('Đã đổi thứ tự tầng') } catch (e) { toast('Lỗi: ' + e.message) }
}
export async function renameFloor(g, name) {
  const c = cur(); if (!c || g === CHUA_PHAN_TANG) return false
  if (name === undefined) {
    name = await qsAsk({ title: 'Đổi tên tầng', label: 'Tên tầng', value: g, confirmText: 'Lưu' })
    if (name == null) return false
  }
  name = String(name).trim(); if (!name || name === g) return false
  const fl = floorsList(c, getState().lines).filter(t => t !== CHUA_PHAN_TANG).map(t => (t === g ? name : t))
  try {
    await updateProject(c.maDA, { tangTuTao: fl.join('|') })
    const aff = getState().lines.filter(l => (l.tang || '') === g)
    await Promise.all(aff.map(l => api.updateLine(l.lineId, { tang: name })))
    await reloadLines()
    toast('Đã đổi tên tầng')
    return true
  } catch (e) { toast('Lỗi: ' + e.message); await reloadLines(); return false }
}

/* VAT dự án (setVat): VAT Phần thô đi theo VAT dự án */
export function setVat(v) {
  v = Number(v) || 0; const c = cur(); if (!c) return
  syncProj({ ...c, vat: v })
  projDataSet_('ptVat', v)
  api.updateProject(c.maDA, { vat: v }).then(p => { if (p) { syncProj({ ...p, vat: v }) } })
    .catch(e => luuLoi_(e, 'VAT của dự án'))
}

/* ---- Chọn / tạo sản phẩm cho 1 dòng ---- */
export async function pickProduct(lineId, p) {
  const g = giaDongTuSP_(p, getState().products)
  await updateLine(lineId, { ten: p.ten, thuongHieu: p.thuongHieu, ncc: p.ncc, maSP: p.ma, kichThuoc: p.kichThuoc, moTa: p.moTa, dvt: p.dvt || 'Cái',
    donGiaVon: g.donGiaVon, donGiaBan: g.donGiaBan, hinhAnh: p.hinhAnh, loai: p.hangMuc, chietKhau: g.chietKhau })
  toast('Đã chọn: ' + p.ten)
}
/* form: {ten, nhom, hangMuc, thuongHieu, ncc, ma, kichThuoc, dvt, gia, moTa, hinhAnh}; trả true khi xong (đóng hộp) */
export async function createProductFromLine(lineId, form) {
  const ten = String(form.ten || '').trim(); if (!ten) { toast('Chưa có Tên sản phẩm'); return false }
  const nhom = String(form.nhom || '').trim(); if (!nhom) { toast('Chọn/nhập Nhóm — nhóm để lọc trong danh mục'); return false }
  const t = k => String(form[k] || '').trim()
  const gia = Number(t('gia')) || 0
  const payload = { nhom, hangMuc: t('hangMuc'), ten, thuongHieu: t('thuongHieu'), ncc: t('ncc'), ma: t('ma'), moTa: t('moTa'),
    kichThuoc: t('kichThuoc'), dvt: t('dvt') || 'Cái', gia, hinhAnh: t('hinhAnh') }
  try {
    const p = await api.saveLineAsProduct(payload)
    if (p) setState(s => ({ products: [...s.products, p] }))
    await updateLine(lineId, { ten, thuongHieu: payload.thuongHieu, ncc: payload.ncc, maSP: payload.ma, moTa: payload.moTa,
      kichThuoc: payload.kichThuoc, dvt: payload.dvt, donGiaVon: gia, donGiaBan: gia, hinhAnh: payload.hinhAnh })
    toast('Đã lưu "' + ten + '" vào danh mục và điền vào dòng')
    return true
  } catch (e) {
    const msg = String((e && e.message) || '')
    if (msg.indexOf('đã có sẵn') >= 0) { toast('Sản phẩm này đã có trong danh mục'); return true }
    toast('Lỗi: ' + msg)
    return false
  }
}

/* ---- Dòng lệch danh mục / cập nhật giá ---- */
export async function lineUpdateApply(lineId, patch) {
  const l = lineOf_(lineId); if (!l) return
  if (!Object.keys(patch).length) { toast('Chưa chọn phần nào để cập nhật'); return }
  const r = await updateLine(lineId, patch)
  if (r) toast('Đã cập nhật ' + Object.keys(patch).length + ' mục cho dòng "' + (patch.ten || l.ten || '') + '"')
}
export async function giaSyncApply(ds, onProgress) {
  let ok = 0; let loi = 0
  for (let i = 0; i < ds.length; i++) {
    const r = await updateLine(ds[i].l.lineId, { donGiaVon: ds[i].von, chietKhau: ds[i].ck })
    if (r) ok++; else loi++
    if (onProgress) onProgress(i + 1)
  }
  toast('Đã cập nhật giá ' + ok + ' dòng' + (loi ? (' · ' + loi + ' dòng lỗi') : ''))
}

/* Điền 1 giá trị xuống các dòng của cột trên Bảng tính (btDien_ bangtinh.js:608-614): hỏi lại, ghi 1 lô */
export async function fillDownSheet(ids, key, text, label) {
  if (!ids.length) return 0
  if (!await qsConfirm('Điền "' + String(text).slice(0, 30) + '" cho ' + ids.length + ' dòng còn lại trong cột "' + label + '"?')) return 0
  return applyEdits(ids.map(id => { const l = lineOf_(id); return { id, fields: l && tkFieldsFor_(l, key, text) } }), 'Đã điền xuống')
}

/* ---- Hạng mục tự tạo (nhomTuTao) ---- */
export async function addCustomGroup() {
  const c = cur(); if (!c) { toast('Chưa chọn dự án'); return null }
  let name = await qsAsk({ title: 'Thêm hạng mục', label: 'Tên hạng mục / nhóm mới', placeholder: 'VD: Thiết bị vệ sinh', confirmText: 'Thêm' })
  if (name == null) return null; name = String(name).trim(); if (!name) return null
  const list = customGroups(c); if (list.indexOf(name) < 0) list.push(name)
  try { await updateProject(c.maDA, { nhomTuTao: list.join('|') }); toast('Đã thêm hạng mục: ' + name); return name } catch (e) { toast('Lỗi: ' + e.message); return null }
}
export async function delCustomGroup(code) {
  const c = cur(); if (!c) return false
  if (!await qsConfirm('Xoá hạng mục "' + code + '"?')) return false
  const list = customGroups(c).filter(s => s !== code)
  try { await updateProject(c.maDA, { nhomTuTao: list.join('|') }); toast('Đã xoá'); return true } catch (e) { toast('Lỗi: ' + e.message); return false }
}

/* ---- Xuất Excel (btXlsx_): tên file do bên gọi đặt, /export/bang luôn trả "bang.xlsx" ---- */
export async function exportXlsx(body) {
  const c = cur(); if (!c) return
  try { await downloadPost('/export/bang', body, 'boc-tach-' + c.maDA + '.xlsx') } catch (e) { toast('Lỗi xuất Excel: ' + e.message) }
}
