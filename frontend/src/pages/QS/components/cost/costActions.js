/* Thao tác ghi dùng chung của Chi phí / Dự án (không React). Ghi qua store như bảng Bóc tách (optimistic, tkApplyEdits_ theo lô)
   và vẫn ghi 1 bước hoàn tác cho các trường đã đổi (D12).
   Port: tkApplyEdits_ PUB/boc.js:974-992 (qua bocActions.applyEdits) · btLineGhiO_ bangtinh.js:676-690 (dán / xoá nhiều ô) ·
   btDoiHang_ bangtinh.js:506-524 (kéo dòng / tầng) · taiFile_ app.js:48-54 (POST /export/bang, tên file do bên gọi đặt). */
import { getState, histOf, setHist, isTmp, lineOf_ } from '../../state/store'
import { updateLine, moveLine } from '../../state/qsGuard'
import { downloadPost } from '../../api/files'
import { tkFieldsFor_, recalcLine_ } from '../../lib/calc.js'
import { floorsList, CHUA_PHAN_TANG } from '../../lib/sheetModel.js'
import { moveFloor } from '../breakdown/sheet/bocActions'
import { lineText, tkSheetSua_ } from '../breakdown/sheet/tkModel'
import { qsToast as toast, qsConfirm } from '../common/dialogs'

function record(label, patches, moves) {
  const S = getState()
  if (!S.cur || (!patches.length && !(moves && moves.length))) return
  const h = histOf(S.cur.maDA)
  setHist(S.cur.maDA, { past: [...h.past, { label, patches, moves: moves || [] }], future: [] })
}
/* Bước hoàn tác ghi cả giá bán / % lợi nhuận tự tính lại theo recalcLine_ (đặt % LN đổi giá bán): hoàn tác chỉ trả % LN
   thì máy chủ tính lại giá bán từ % LN, không về đúng giá bán cũ */
function patchesOf(edits) {
  const by = {}
  edits.forEach(x => { if (x && x.fields && !isTmp(x.id)) by[x.id] = { ...(by[x.id] || {}), ...x.fields } })
  const out = []
  Object.keys(by).forEach(id => {
    const l = lineOf_(id)
    if (!l) return
    const n = { ...l, ...by[id] }
    recalcLine_(n, by[id])
    const ks = Object.keys(by[id]); ['donGiaBan', 'lnPct'].forEach(k => { if (ks.indexOf(k) < 0) ks.push(k) })
    ks.forEach(f => { if (l[f] !== n[f]) out.push({ lineId: id, field: f, old: l[f], new: n[f] }) })
  })
  return out
}

/* tkApplyEdits_ PUB/boc.js:974-992 (như bocActions.applyEdits: bỏ dòng tạm, gộp theo dòng, hỏi lại khi > 60 dòng, gửi theo lô 6)
   nhưng trả về id các dòng máy chủ đã lưu, để bước hoàn tác chỉ gồm thay đổi đã lưu thật */
async function applyEditsOk_(edits, nhan) {
  let tam = 0
  edits = (edits || []).filter(e => { if (e && isTmp(e.id)) { tam++; return false } return true })
  if (tam) toast(tam + ' dòng vừa thêm đang lưu — chưa áp thay đổi cho các dòng đó, thử lại sau 1–2 giây')
  const byId = {}
  edits.forEach(e => { if (!e || !e.fields) return; byId[e.id] = { ...(byId[e.id] || {}), ...e.fields } })
  const ids = Object.keys(byId); if (!ids.length) { toast('Không có ô nào sửa được'); return [] }
  if (ids.length > 60 && !await qsConfirm('Thao tác này sửa ' + ids.length + ' dòng. Tiếp tục?')) return []
  const ok = []
  let loi = 0
  for (let i = 0; i < ids.length; i += 6) {
    const part = ids.slice(i, i + 6)
    const rs = await Promise.all(part.map(id => updateLine(id, byId[id])))
    rs.forEach((r, j) => { if (r) ok.push(part[j]); else loi++ })
  }
  toast((nhan || 'Đã cập nhật') + ' · ' + ids.length + ' dòng' + (loi ? (' · ' + loi + ' dòng lỗi') : ''))
  return ok
}
/* Sửa nhiều dòng một lượt + 1 bước hoàn tác chỉ cho các dòng đã lưu. edits [{id, fields}] -> số dòng đã lưu */
export async function applyEditsRec(edits, nhan, label) {
  const patches = patchesOf(edits)
  const ok = new Set(await applyEditsOk_(edits, nhan))
  record(label || nhan, patches.filter(p => ok.has(p.lineId)))
  return ok.size
}

/* Dán / xoá / điền nhiều ô từ SheetBody (onApplyEdits): ô tự tính bị bỏ qua */
export function applyCells(info, cells, plain) {
  const edits = []
  cells.forEach(c => { const l = lineOf_(c.id); const f = l && tkFieldsFor_(l, c.key, c.text); if (f) edits.push({ id: c.id, fields: f }) })
  if (!edits.length) {
    if (plain) toast(info.kind === 'paste' ? 'Vùng dán không có ô nào sửa được' : 'Vùng chọn không có ô nào sửa được')
    return
  }
  if (!plain && edits.length === 1) {
    const patches = patchesOf(edits)
    updateLine(edits[0].id, edits[0].fields).then(r => { if (r) record(info.label, patches) })
    return
  }
  const nhan = !plain ? 'Đã sửa'
    : info.kind === 'paste' ? 'Đã dán ' + edits.length + ' ô vào'
      : info.kind === 'clear' ? 'Đã xoá nội dung' : 'Đã điền “' + String(info.value == null ? '' : info.value).slice(0, 24) + '”'
  applyEditsRec(edits, nhan, info.label)
}

/* Xuất Excel qua /export/bang; server luôn trả "bang.xlsx" nên tên file do bên gọi đặt. Trả true khi tải xong */
export async function exportBang(body, fileName) {
  try { await downloadPost('/export/bang', body, fileName); return true } catch (e) {
    if (!(e && e.name === 'QsAuthError')) toast('Lỗi xuất Excel: ' + e.message)
    return false
  }
}

/* Kéo dòng / tầng (btDoiHang_). k = 'cp' | 'da'; by = cách gom của Chi phí. src/dst = {kind, id, g} của SheetGrid.
   Dòng đổi chỗ trong CẢ dự án (tkMoveLine_) và ghi 1 bước hoàn tác. */
export function dropRow(k, by, src, dst, before) {
  if (!src || !dst) return
  const S = getState()
  if (src.kind === 'group') {
    if (k !== 'da') return
    const fl = floorsList(S.cur, S.lines)
    const den = dst.kind === 'group' ? dst.id : ((lineOf_(dst.id) || {}).tang || '')
    if (!den || den === src.id) return
    if (fl.indexOf(den) < 0 || den === CHUA_PHAN_TANG) { toast('Thả lên một tầng / phòng khác để đổi thứ tự'); return }
    moveFloor(src.id, den, fl.indexOf(src.id) < fl.indexOf(den))
    return
  }
  let run
  if (dst.kind === 'group') {
    if (k === 'cp' && by !== 'tang') { toast('Thả lên một dòng sản phẩm để đổi chỗ (nhóm đang gom theo ' + (by === 'ncc' ? 'NCC' : 'hạng mục') + ')'); return }
    const g = k === 'cp' ? (dst.g && dst.g.k === '__k' ? '' : (dst.g && dst.g.k) || '') : dst.id
    run = moveLine(src.id, g, null, false)
  } else {
    if (dst.id === src.id) return
    const t = lineOf_(dst.id); const me = lineOf_(src.id)
    // Chi phí đang gom theo hạng mục / NCC: kéo chỉ để đổi thứ tự, giữ nguyên tầng của dòng
    const tg = (k === 'cp' && by !== 'tang') ? ((me && me.tang) || '') : ((t && t.tang) || '')
    run = moveLine(src.id, tg, dst.id, before)
  }
  Promise.resolve(run).then(moves => { if (moves && moves.length) record('Di chuyển dòng', [], moves) })
}

/* Sao chép vùng đang chọn (btCopy_ bangtinh.js:235-238): gửi Ctrl+C cho lưới trong khung box, SheetBody tự chép đúng vùng */
export function copySel(box) {
  const g = box && box.querySelector('.qs-bd-grid')
  if (!g) return
  g.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
  toast('Đã sao chép vùng chọn')
}
/* Điền xuống (btDienVung_ bangtinh.js:229-234): ô của dòng đầu vùng chọn -> các dòng chọn bên dưới, từng cột trong keys */
export function fillDown(keys, ids) {
  const ls = (ids || []).map(lineOf_).filter(Boolean)
  if (ls.length < 2) { toast('Chọn vùng từ ô nguồn kéo xuống các ô cần điền'); return }
  const edits = []
  ;[].concat(keys || []).filter(tkSheetSua_).forEach(key => {
    const v = lineText(ls[0], key, '')
    ls.slice(1).forEach(l => { const f = tkFieldsFor_(l, key, v); if (f) edits.push({ id: l.lineId, fields: f }) })
  })
  if (!edits.length) { toast('Vùng chọn không có ô sửa được'); return }
  applyEditsRec(edits, 'Đã điền xuống ' + edits.length + ' ô')
}
/* Thay mọi chỗ khớp (không phân biệt hoa thường) trong các ô SỬA ĐƯỢC của bảng đang xem (btThay_ bangtinh.js:908-914).
   lines = dòng đang hiện, keys = cột đang hiện */
export function replaceAll(q, rep, lines, keys) {
  q = String(q || '').trim()
  if (!q) { toast('Nhập từ cần tìm'); return }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const edits = []
  let n = 0
  lines.forEach(l => keys.forEach(k => {
    if (!tkSheetSua_(k)) return
    const v = String(lineText(l, k, '') || '')
    re.lastIndex = 0
    if (v.indexOf('<') >= 0 || !re.test(v)) return
    re.lastIndex = 0
    const f = tkFieldsFor_(l, k, v.replace(re, rep))
    if (f) { edits.push({ id: l.lineId, fields: f }); n++ }
  }))
  if (!n) { toast('Không có ô sửa được nào chứa "' + q + '"'); return }
  applyEditsRec(edits, 'Đã thay ' + n + ' ô')
}
