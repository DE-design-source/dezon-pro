/* Thao tác ghi của tab Danh sách sản phẩm - port PUB/sanpham.js (spFav/spFavBulk 378-397, spExportXlsx 434-455,
   spDuyet/spDuyetBulk 466-508, hoàn tác 520-552, spInlineSave 561-600, spAddManyToProject_/spAddToProject/spRemoveFromProject 140-158,
   spBulkApply/spBulkDelete/spBulkRequest 1779-1826, spDelete 2516-2522) và addProdObj (boc.js:291-342) khi thêm từ tab này.
   Sửa SP trong store: tạo object mới (bản gốc sửa tại chỗ S.products). Lỗi luôn báo bằng toast / hộp báo, không nuốt. */
import * as api from '../../../api/qsApi'
import { downloadPost } from '../../../api/files'
import {
  getState, setState, subscribe, addLine, updateLine, deleteLines, reloadProducts, refreshNotifCount, newTmpId,
} from '../../../state/store'
import { qsToast as toast, qsConfirm, qsAlert, qsAsk } from '../../common/dialogs'
import { money } from '../../../lib/format.js'
import { addProdSame_, addProdBuild_, addProdSl_, addProdFloor_, prodNode_ } from '../../../lib/calc.js'
import { floorsList } from '../../../lib/sheetModel.js'
import { spKey_, spPatchLocal_, spNhomBienThe_ } from './spModel'
import { LY_DO_MAX } from '../../admin/adminUtil'

const S = () => getState()
const errMsg = e => String((e && e.message) || e || '')

/* Thay các SP có khoá trong keys bằng fn(p) (giữ thứ tự danh mục) */
export function patchProducts(keys, fn) {
  const m = {}; keys.forEach(k => { m[k] = 1 })
  setState(s => ({ products: s.products.map(p => (m[spKey_(p)] ? fn(p) : p)) }))
}

/* ---------- Yêu thích (lạc quan: đổi trước, lỗi thì trả lại) ---------- */
function spFavChk_(r) {
  if (r && r.ok === 0 && r.errors && r.errors.length) throw new Error(r.errors[0].error)
  return r
}
export async function spFav(p, on) {
  const k = spKey_(p); if (!k) return
  patchProducts([k], x => ({ ...x, yeuThich: !!on }))
  try { spFavChk_(await api.setYeuThich([k], !!on)) } catch (e) {
    patchProducts([k], x => ({ ...x, yeuThich: !on })); toast(errMsg(e)); return
  }
  toast(on ? 'Đã thêm vào sản phẩm yêu thích' : 'Đã bỏ khỏi sản phẩm yêu thích')
}
export async function spFavBulk(prods, on) {
  if (!prods.length) return
  const keys = prods.map(spKey_).filter(Boolean)
  patchProducts(keys, x => ({ ...x, yeuThich: !!on }))
  try { spFavChk_(await api.setYeuThich(keys, !!on)) } catch (e) {
    patchProducts(keys, x => ({ ...x, yeuThich: !on })); toast(errMsg(e)); return
  }
  toast('Đã lưu ' + keys.length + ' sản phẩm vào Yêu thích')
}

/* ---------- Duyệt: dòng đại diện của nhóm biến thể = cả nhóm ---------- */
export async function spDuyet(p, approve) {
  const nhom = spNhomBienThe_(S().products, p).filter(x => !x.spChung)
  if (!nhom.length) { toast('Sản phẩm kho chung Dezon — không đổi được trạng thái duyệt'); return }
  try {
    const r = await api.setSpDuyet(nhom.map(x => String(x.recordId || x.ma)), !!approve)
    if (r && r.errors && r.errors.length) {
      await qsAlert({ title: 'Không đổi được trạng thái duyệt', ok: 'Đã hiểu',
        note: 'Sản phẩm "' + (p.ten || p.ma) + '":\n' + String(r.errors[0].error || '').slice(0, 160) })
      return
    }
    if (!(r && ((Number(r.ok) || 0) + (Number(r.daDung) || 0)))) {
      await qsAlert({ title: 'Không đổi được trạng thái duyệt', ok: 'Đã hiểu',
        note: 'Máy chủ không tìm thấy dòng nào để đổi cho sản phẩm "' + (p.ten || p.ma) + '". Thử tải lại trang rồi làm lại.' })
      return
    }
    const user = (S().me || {}).username || ''
    const now = new Date().toISOString()
    patchProducts(nhom.map(spKey_), x => ({ ...x, daDuyet: !!approve, nguoiDuyet: approve ? user : '', ngayDuyet: approve ? now : '' }))
    toast((approve ? 'Đã duyệt "' : 'Đã bỏ duyệt "') + (p.ten || p.ma) + '"' + (nhom.length > 1 ? (' · ' + nhom.length + ' biến thể') : ''))
  } catch (e) { toast('Lỗi: ' + errMsg(e).slice(0, 110)) }
}
export async function spDuyetBulk(nhomSel, approve) {
  const prods = nhomSel.filter(p => !p.spChung)
  if (!prods.length) { toast('Chưa chọn sản phẩm nào'); return }
  try {
    const r = await api.setSpDuyet(prods.map(p => String(p.recordId || p.ma)), !!approve)
    patchProducts(prods.map(spKey_), x => ({ ...x, daDuyet: !!approve }))
    await reloadProducts()
    if (r && r.errors && r.errors.length) {
      await qsAlert({ title: (r.errors.length) + ' sản phẩm không đổi được trạng thái', ok: 'Đã hiểu',
        note: (approve ? 'Đã duyệt ' : 'Đã bỏ duyệt ') + ((r && r.ok) || 0) + ' sản phẩm. Các sản phẩm dưới đây thì không:',
        dong: r.errors.map(e => e.key + ' — ' + e.error) })
    } else toast((approve ? 'Đã duyệt ' : 'Đã bỏ duyệt ') + ((r && r.ok) || 0) + ' sản phẩm'
      + ((r && r.ok === 0) ? ' (các sản phẩm chọn đã ở đúng trạng thái)' : ''))
  } catch (e) { toast('Lỗi: ' + errMsg(e).slice(0, 110)) }
}

/* ---------- Hoàn tác (Ctrl+Z): kho cấp module, tối đa 50 bước; xoá SP không hoàn tác được ---------- */
let undoSt = []
const undoSubs = new Set()
const undoEmit = () => undoSubs.forEach(fn => fn())
export const undoSubscribe = fn => { undoSubs.add(fn); return () => undoSubs.delete(fn) }
/* Đổi phiên (đăng xuất / tài khoản khác / công ty xem): bỏ hết bước hoàn tác, như bản gốc nạp lại trang khi đăng xuất,
   để người sau không hoàn tác thay đổi của người trước dưới tài khoản mình */
let undoKey = getState().key
subscribe(() => {
  const k = getState().key
  if (k === undoKey) return
  undoKey = k
  if (undoSt.length) { undoSt = []; undoEmit() }
})
export const undoGet = () => undoSt
export function spUndoPush_(changes, label) {
  if (!changes || !changes.length) return
  undoSt = undoSt.concat([{ items: changes, label: label || 'sửa' }])
  if (undoSt.length > 50) undoSt = undoSt.slice(1)
  undoEmit()
}
export async function spUndo_() {
  if (!undoSt.length) { toast('Không còn thao tác nào để hoàn tác'); return }
  const step = undoSt[undoSt.length - 1]
  undoSt = undoSt.slice(0, -1); undoEmit()
  let ok = 0, err = ''
  for (let i = 0; i < step.items.length; i++) {
    const it = step.items[i]
    try {
      const d = {}; if (it.lark !== 'MÃ SẢN PHẨM') d['MÃ SẢN PHẨM'] = it.ma
      d[it.lark] = it.old
      await api.updateDbProductTracked(String(it.key), d)
      patchProducts([String(it.key)], p => spPatchLocal_(p, it.lark, it.col, it.old))
      ok++
    } catch (e) { if (!err) err = errMsg(e) }
  }
  if (ok && !err) toast('↶ Đã hoàn tác: ' + step.label)
  else if (ok) toast('Hoàn tác ' + ok + '/' + step.items.length + ' — lỗi: ' + err.slice(0, 70))
  else { undoSt = undoSt.concat([step]); undoEmit(); toast('Không hoàn tác được: ' + err.slice(0, 90)) }
}

/* ---------- Sửa 1 ô ngay trên bảng (spInlineSave). Trả 'same' | 'ok' | 'err' ---------- */
export async function spInlineSave(p, e, raw, oldShown) {
  const lark = e.lark, col = e.col || '', isMoney = !!e.money
  let v = String(raw).trim()
  if (isMoney) v = v.replace(/[^\d]/g, '')                       // "930.000 đ" -> "930000"
  const shown = isMoney ? (v === '' ? '' : money(v)) : v
  if (oldShown != null && oldShown === shown) return { st: 'same', shown }
  const oldRaw = (col && p.raw && p.raw[col] != null) ? String(p.raw[col]) : (isMoney ? String(oldShown || '').replace(/[^\d]/g, '') : String(oldShown || ''))
  const d = {}
  if (lark !== 'MÃ SẢN PHẨM') d['MÃ SẢN PHẨM'] = p.ma           // khoá tra cứu, trừ khi đang sửa chính nó
  d[lark] = v
  try {
    const key = String(p.recordId || p.ma)
    const res = await api.updateDbProductTracked(key, d)
    if (res && res.updated === false) {
      toast('Máy chủ báo không có gì thay đổi nên chưa lưu. Tải lại trang (Ctrl/⌘+Shift+R) rồi thử lại — nếu vẫn vậy, báo lại để kiểm tra bản ghi.')
      return { st: 'err', shown: String(oldShown == null ? '' : oldShown), revert: true }
    }
    spUndoPush_([{ key, ma: p.ma, lark, col, old: oldRaw }], lark + ' của "' + (p.ten || p.ma || '') + '"')
    const daDuyetLai = !!(res && res.daDuyet === false && p.daDuyet)   // sửa nội dung -> phải duyệt lại
    patchProducts([spKey_(p)], x => {
      const n = spPatchLocal_(x, lark, col, v)
      if (daDuyetLai) { n.daDuyet = false; n.nguoiDuyet = ''; n.ngayDuyet = '' }
      return n
    })
    return { st: 'ok', shown }
  } catch (er) {
    toast('Lỗi lưu: ' + errMsg(er).slice(0, 110))
    return { st: 'err', shown: null }
  }
}

/* ---------- Tải Excel: có tick -> đúng các dòng đó, không thì toàn bộ danh sách đang lọc ---------- */
export async function spExportXlsx(keys) {
  if (!keys.length) { toast('Không có sản phẩm nào để tải'); return }
  try {
    const r = await downloadPost('/export/san-pham', { keys }, 'danh-sach-san-pham-' + new Date().toISOString().slice(0, 10) + '.xlsx')
    const so = r && r.rowCount != null ? r.rowCount : keys.length    // X-Row-Count
    toast('Đã tải ' + so + ' sản phẩm ra Excel')
  } catch (err) {
    if (err && err.name === 'QsAuthError') return
    toast('Lỗi tải Excel: ' + errMsg(err))
  }
}

/* ---------- Ghi danh vào dự án ---------- */
/* addProdObj từ tab Danh sách SP: đề mục theo ngành của SP (prodNode_ khi không ở Bóc tách). Tầng = S.selFloor của bản gốc:
   chưa chọn thì renderFloors gán tầng đầu của floorsList (boc.js:151). Tầng bấm ở Bóc tách = getState().selFloor (null = chưa chọn);
   tầng không còn trong dự án đang mở (vd vừa đổi dự án) thì về tầng đầu. Trả Promise. */
export function addProdObj(p, sl) {
  const st = S()
  if (!st.cur) { toast('Chưa chọn dự án — bấm Tạo dự án +'); return Promise.resolve(null) }
  sl = addProdSl_(sl)
  const fl = floorsList(st.cur, st.lines)
  const sf = st.selFloor
  const floor = addProdFloor_(undefined, (sf != null && (sf === '' || fl.indexOf(sf) >= 0)) ? sf : (fl[0] || ''))
  const nd = String(prodNode_(p, st.node, false) || st.node || '')
  const same = addProdSame_(st.lines, p, floor, nd, '', st.node)
  if (same) {
    toast('+' + sl + ' số lượng: ' + p.ten)
    return updateLine(same.lineId, { soLuong: (Number(same.soLuong) || 0) + sl })
  }
  const b = addProdBuild_(p, st.products, nd, floor, sl, '', st.node, newTmpId())
  toast('Đã thêm: ' + p.ten + (sl > 1 ? (' ×' + sl) : ''))
  return addLine(b.prod, sl, b.temp)
}
export function spAddManyToProject_(list) {
  const cur = S().cur
  if (!cur) { toast('Chưa chọn dự án'); return }
  list.forEach(p => { addProdObj(p) })
  toast(list.length > 1 ? ('Đã thêm ' + list.length + ' sản phẩm vào "' + cur.ten + '"')
    : ('Đã thêm "' + (list[0].ten || '') + '" vào dự án'))
}
export async function spAddToProject(p) {
  if (!S().cur) { toast('Chưa chọn dự án'); return }
  await addProdObj(p)
}
/* Ghi danh 1 sản phẩm vào nhiều dự án một lần (hộp "Ghi danh vào nhiều dự án" của modal Thông tin sản phẩm).
   Dự án đang mở: qua addProdObj (bảng cập nhật ngay). Dự án khác: đọc dòng của dự án đó, trùng SP cùng tầng / đề mục thì cộng
   số lượng, không thì thêm dòng mới ở "Chưa phân tầng" (giống addProdObj khi chưa chọn tầng). Trả {ok, fail}. */
export async function spAddToProjects(p, maDAs, sl) {
  sl = addProdSl_(sl)
  const st = S(), curMa = st.cur ? st.cur.maDA : ''
  let ok = 0
  const fail = []
  for (const maDA of maDAs) {
    try {
      if (maDA === curMa) { await addProdObj(p, sl); ok++; continue }
      const lines = (await api.getLines(maDA)) || []
      const nd = String(prodNode_(p, st.node, false) || st.node || '')
      const same = addProdSame_(lines, p, '', nd, '', st.node)
      if (same) await api.updateLine(same.lineId, { soLuong: (Number(same.soLuong) || 0) + sl })
      else await api.addLine(maDA, addProdBuild_(p, st.products, nd, '', sl, '', st.node, newTmpId()).prod, sl)
      ok++
    } catch (e) {
      if (e && e.name === 'QsAuthError') throw e
      const pj = (st.projects || []).find(x => x.maDA === maDA)
      fail.push(((pj && pj.ten) || maDA) + ': ' + errMsg(e))
    }
  }
  if (fail.length) qsAlert('Ghi danh "' + (p.ten || '') + '": xong ' + ok + ' dự án, lỗi ' + fail.length + ':\n' + fail.join('\n'))
  else toast('Đã ghi danh "' + (p.ten || '') + '"' + (sl > 1 ? ' ×' + sl : '') + ' vào ' + ok + ' dự án')
  return { ok, fail: fail.length }
}
export async function spRemoveFromProject(l) {
  const cur = S().cur
  if (!await qsConfirm('Bỏ "' + ((l && l.ten) || 'sản phẩm này') + '" khỏi dự án ' + ((cur && cur.ten) || '') + '? Dòng bóc tách của nó sẽ bị xoá.')) return
  await deleteLines([l.lineId], { confirm: false })
}
/* Thêm combo: SP chính + mọi SP đi kèm, số lượng × số bộ (pdAddCombo_ khi đang ở tab Danh sách SP) */
export async function spAddCombo(chinh, list, bo) {
  if (!S().cur) { toast('Chưa chọn dự án'); return }
  await addProdObj(chinh, bo)
  for (let k = 0; k < list.length; k++) {
    const x = list[k]
    await addProdObj(x, (Number(x.comboSL) || 1) * bo)
  }
  toast('Đã thêm ' + (bo > 1 ? (bo + ' bộ combo') : 'combo') + ': sản phẩm chính + ' + list.length + ' sản phẩm đi kèm')
}

/* ---------- Sửa / xoá hàng loạt ---------- */
export async function spBulkApply(all, lark, val, label, col, onProgress) {
  val = String(val == null ? '' : val).trim()
  if (!lark) return false
  if (val === '') { toast('Chưa nhập giá trị mới'); return false }
  if (!all.length) return false
  const prods = all.filter(p => !p.spChung), bo = all.length - prods.length
  if (!prods.length) { toast('Các sản phẩm đã chọn đều thuộc kho chung của Dezon — không sửa được'); return false }
  if (!await qsConfirm('Đặt "' + label + '" = "' + val + '" cho ' + prods.length + ' sản phẩm đã chọn?'
    + (bo ? '\n(Bỏ qua ' + bo + ' sản phẩm kho chung Dezon)' : ''))) return false
  let ok = 0
  const errs = [], undo = []
  if (onProgress) onProgress(0, prods.length)
  for (let i = 0; i < prods.length; i++) {
    if (i && onProgress) onProgress(i, prods.length)
    const d = { 'MÃ SẢN PHẨM': prods[i].ma }; d[lark] = val
    const truoc = (col && prods[i].raw && prods[i].raw[col] != null) ? String(prods[i].raw[col]) : ''
    try {
      await api.updateDbProductTracked(String(prods[i].recordId || prods[i].ma), d); ok++
      undo.push({ key: String(prods[i].recordId || prods[i].ma), ma: prods[i].ma, lark, col, old: truoc })
    } catch (e) { if (errs.length < 3) errs.push((prods[i].ma || '?') + ': ' + errMsg(e).slice(0, 60)) }
  }
  spUndoPush_(undo, 'sửa hàng loạt ' + label + ' cho ' + ok + ' SP')
  if (onProgress) onProgress(prods.length, prods.length)
  await reloadProducts()
  if (errs.length) toast('Cập nhật ' + ok + '/' + prods.length + ' — lỗi: ' + errs.join(' | '))
  else toast('Đã đặt ' + label + ' = "' + val + '" cho ' + ok + ' sản phẩm')
  return true
}
/* Admin: xoá thật. selCount = số dòng đang tick (để báo số SP kho chung bị bỏ qua) */
export async function spBulkDelete(sel, selCount, onProgress) {
  const prods = sel.filter(p => !p.spChung)
  const keys = prods.map(p => String(p.recordId || p.ma || '')).filter(Boolean)
  if (!keys.length) { toast('Không có sản phẩm nào xoá được (kho chung Dezon chỉ xem)'); return false }
  const bo = selCount - keys.length
  if (!await qsConfirm('Xóa ' + keys.length + ' sản phẩm khỏi danh mục? Không thể hoàn tác.'
    + (bo ? '\n(Bỏ qua ' + bo + ' sản phẩm kho chung Dezon)' : ''))) return false
  let ok = 0, err = ''
  for (let i = 0; i < keys.length; i++) {
    if (onProgress) onProgress(i, keys.length)
    try { await api.deleteDbProduct(keys[i]); ok++ } catch (e) { if (!err) err = errMsg(e) }
  }
  if (onProgress) onProgress(keys.length, keys.length)
  await reloadProducts()
  // bản gốc chỉ báo số đã xoá; lỗi từng SP thì nói thêm thay vì nuốt
  toast('Đã xóa ' + ok + ' sản phẩm' + (err ? (' · ' + (keys.length - ok) + ' lỗi: ' + err.slice(0, 70)) : ''))
  return true
}
/* Nhân viên không có quyền xoá: gửi yêu cầu cho Admin. selKeys = khoá đang tick.
   Hỏi lý do (tuỳ chọn, ≤500 ký tự, M15.2) - Huỷ thì không gửi; quá dài thì mở lại hộp với nội dung đã gõ. */
export async function spBulkRequest(selKeys) {
  const byKey = {}; (S().products || []).forEach(p => { byKey[spKey_(p)] = p })
  const items = selKeys.map(k => { const p = byKey[k] || {}; return { maSP: p.ma || k, id: p.recordId || '', ten: p.ten || '' } })
  if (!items.length) return false
  let lyDo = ''
  for (;;) {
    lyDo = await qsAsk({
      title: 'Gửi yêu cầu xóa ' + items.length + ' sản phẩm',
      note: 'Admin sẽ duyệt trước khi xóa. Lý do (nếu có, tối đa ' + LY_DO_MAX + ' ký tự) được gửi kèm thông báo.',
      label: 'Lý do xóa (tuỳ chọn)', value: lyDo, placeholder: 'VD: trùng mã, ngừng kinh doanh…', required: false, confirmText: 'Gửi yêu cầu',
    })
    if (lyDo == null) return false
    if ([...lyDo].length <= LY_DO_MAX) break
    toast('Lý do tối đa ' + LY_DO_MAX + ' ký tự (đang có ' + [...lyDo].length + ')')
  }
  try {
    const r = await api.requestDeleteProducts(items, lyDo)
    refreshNotifCount()
    toast('Đã gửi yêu cầu xóa ' + ((r && r.count) != null ? r.count : items.length) + ' sản phẩm tới Admin')
    return true
  } catch (e) { toast('Lỗi: ' + errMsg(e)); return false }
}
export async function spDelete(p) {
  if (!await qsConfirm('Xoá sản phẩm "' + p.ten + '" khỏi danh mục?')) return
  try {
    await api.deleteDbProduct(String(p.recordId || p.ma))
    await reloadProducts()
    toast('Đã xoá: ' + p.ten)
  } catch (e) { toast('Lỗi xoá: ' + errMsg(e)) }
}

/* ---------- Tạo bản sao riêng từ kho chung Dezon (M10.1) ----------
   Hỏi lại -> route chỉ bản Go -> tải lại danh mục -> trả SP bản sao (bản riêng che bản kho chung) để mở; huỷ -> null.
   Lỗi -> vẫn tải lại danh mục; lỗi trùng mà tìm được đúng 1 bản riêng cùng mã + trục biến thể thì trả bản đó để mở, không thì null. */
const pcBusy = {}
export async function spPrivateCopy(p) {
  if (!p || !p.spChung) return null
  const key = String(p.recordId || '')
  if (!key) { toast('Sản phẩm kho chung chưa có ID dòng — không tạo được bản sao'); return null }
  if (pcBusy[key]) return null
  if (!await qsConfirm({
    title: 'Tạo bản sao riêng cho công ty bạn?',
    note: '"' + (p.ten || p.ma || '') + '"' + (p.ma ? ' (mã ' + p.ma + ')' : '') + ' sẽ được chép sang danh mục của công ty bạn:'
      + ' giữ mã, tên, thông số, ảnh, tài liệu; trạng thái Chưa duyệt; không kèm sản phẩm đi kèm (combo) hay biến thể.'
      + ' Bản sao sửa được và thay cho bản kho chung trong danh sách.',
    ok: 'Tạo bản sao',
  })) return null
  pcBusy[key] = 1
  try {
    const r = await api.privateCopyProduct(key)
    await reloadProducts()
    const id = r && r.id != null ? String(r.id) : ''
    const np = id ? (S().products || []).filter(x => String(x.recordId || '') === id)[0] : null
    toast('Đã tạo bản sao riêng: ' + ((r && (r.ten || r.ma)) || p.ten || ''))
    return np || null
  } catch (e) {
    const msg = errMsg(e)
    // Danh mục có thể đã cũ (bản sao vừa được tạo ở nơi khác): tải lại để dòng kho chung bị che biến mất
    try { await reloadProducts() } catch (e2) { /* giữ danh sách cũ */ }
    if (/^Công ty bạn đã có sản phẩm mã /.test(msg)) {
      const truc = x => [x.ma, x.congSuat, x.nhietDo, x.gocChieu, x.mauSac, x.kichThuocVS].map(v => String(v == null ? '' : v)).join('|')
      const k = truc(p)
      const own = (S().products || []).filter(x => !x.spChung && truc(x) === k)
      if (own.length === 1) {
        toast(msg + ' — mở bản riêng đã có')
        return own[0]
      }
    }
    toast('Không tạo được bản sao: ' + msg)
    return null
  } finally { delete pcBusy[key] }
}

/* Quyền sửa / duyệt (spLoadPerm_): lỗi -> coi như được cả hai, như bản gốc */
export async function spLoadPerm_(signal) {
  try { return (await api.spMyPerms(signal)) || { edit: true, duyet: true } } catch (e) {
    if (e && e.name === 'QsAbortError') throw e
    return { edit: true, duyet: true }
  }
}

/* Combo của 1 SP (dùng chung cho dòng mở combo và modal chi tiết) */
const cbCache = {}
export const cbGet = k => cbCache[k]
export async function cbLoad(k) {
  try { cbCache[k] = (await api.getCombo(k)) || [] } catch (e) { cbCache[k] = []; toast('Không tải được sản phẩm đi kèm: ' + errMsg(e)) }
  return cbCache[k]
}
