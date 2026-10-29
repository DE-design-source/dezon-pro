/* Phần còn lại của nghiệp vụ tab Nhập dữ liệu (port PUB/nhap.js): đổi ngành hàng, combo trong form, chữ xem trước biến thể,
   nhập hàng loạt từ file Excel. Spec ngành là tham số specs = {VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC}. */
import * as api from '../../api/qsApi'
import { qsToast, qsConfirm } from '../common/dialogs'
import { coSpec_, specNganh_, nganhCuaSP_ } from '../../lib/productFields'
import { impGet, impSet, impForm, emptyForm_, pendingAdd_, waitUploads_, bulkCleared_ } from './importStore'
import { pendNganhLoai_, pendFormOf_, varCombos_, varList_, btLabel_ } from './importLogic'
import { readB64_ } from './imgUpload'

const toast = qsToast

/* ===== Đổi ngành hàng (impSetLoai -> renderImport, nhap.js:721, 808-814): form vẽ lại trống;
   đang sửa 1 dòng chờ thì chỉ giữ chế độ sửa khi dòng đó đúng ngành mới (nạp lại dữ liệu dòng). Phần thô không đụng form SP. ===== */
export function impSetLoai_(v, specs) {
  if (v === 'pt') { impSet(s => ({ loai: v, bulk: bulkCleared_(s.bulk) })); return }
  const st = impGet()
  const it = st.pendEdit ? (st.pending || []).filter(x => x.uid === st.pendEdit)[0] : null
  if (it && pendNganhLoai_(it) === v) impSet(s => ({ loai: v, form: pendFormOf_(it, v, specs), bulk: bulkCleared_(s.bulk) }))
  else impSet(s => ({ loai: v, pendEdit: null, form: emptyForm_(), bulk: bulkCleared_(s.bulk) }))
}
/* Huỷ sửa dòng chờ (pendingEditCancel_) và Xoá form (renderImport) đều dựng lại form trống */
export function pendingEditCancel_() { impSet(s => ({ pendEdit: null, form: emptyForm_(), bulk: bulkCleared_(s.bulk) })) }

/* ===== COMBO trong form (impCbAdd_ / impCbDel_ / impCbSL_ / impCbSearch_, nhap.js:767-807; cbLbl_ sanpham.js:2029-2032) ===== */
export function cbLbl_(p, specs) {
  const ng = nganhCuaSP_(p, specs), SP = coSpec_(ng) ? specNganh_(ng, specs) : null
  return coSpec_(ng)
    ? [(SP && SP.chuanHM(p.hangMuc)) || p.hangMuc, p.mauSac].filter(Boolean).join(' · ')
    : [p.congSuat, p.nhietDo].filter(Boolean).join(' · ')
}
export function impCbAdd_(p) {
  const cb = impGet().form.combo || []
  if (cb.some(x => String(x.recordId) === String(p.recordId))) { toast('Sản phẩm này đã có trong combo'); return false }
  impForm(f => ({ combo: (f.combo || []).concat({ recordId: p.recordId, ma: p.ma, ten: p.ten, hinhAnh: p.hinhAnh, donGiaBan: p.donGiaBan, comboSL: 1 }) }))
  return true
}
export function impCbDel_(i) { impForm(f => ({ combo: (f.combo || []).filter((x, k) => k !== i) })) }
export function impCbSL_(i, v) { impForm(f => ({ combo: (f.combo || []).map((x, k) => (k === i ? { ...x, comboSL: Math.max(1, Number(v) || 1) } : x)) })) }
/* Gợi ý: gõ chữ -> tìm theo tên / mã / thương hiệu (cùng ngành lên trước); ô trống + vệ sinh -> các hạng mục "kem" của hạng mục
   đang chọn. Trả null khi không hiện hộp gợi ý, ngược lại {tieuDe, hit}. */
export function impCbSearch_(q, loai, hmVal, combo, products, specs) {
  q = String(q || '').trim().toLowerCase()
  const ng = coSpec_(loai) ? loai : 'den', chon = {}
  ;(combo || []).forEach(x => { chon[String(x.recordId)] = 1 })
  let hit, tieuDe = ''
  if (!q) {
    const VS = specs && specs.VS_SPEC, h = (ng === 'vs' && VS) ? VS.hmOf(hmVal || '') : null
    if (!h || !h.kem.length) return null
    hit = (products || []).filter(p => !chon[String(p.recordId)] && nganhCuaSP_(p, specs) === 'vs' && h.kem.indexOf(VS.chuanHM(p.hangMuc)) >= 0).slice(0, 8)
    tieuDe = 'Gợi ý đi kèm: ' + h.kem.join(', ')
  } else {
    hit = (products || []).filter(p => !chon[String(p.recordId)] && ((p.ten || '') + ' ' + (p.ma || '') + ' ' + (p.thuongHieu || '')).toLowerCase().indexOf(q) >= 0)
    hit.sort((a, b) => (nganhCuaSP_(a, specs) === ng ? 0 : 1) - (nganhCuaSP_(b, specs) === ng ? 0 : 1))
    hit = hit.slice(0, 8)
  }
  return { tieuDe, hit }
}

/* ===== BIẾN THỂ: chữ xem trước (varPreview_, nhap.js:1315-1331); null = "Bỏ trống = chỉ tạo 1 sản phẩm..." ===== */
export function varPreview_(vars) {
  const c = varCombos_(vars); if (!c.length) return null
  const K = varList_(vars.varKelvin), W = varList_(vars.varWatt), A = varList_(vars.varAngle), C = varList_(vars.varColor), Z = varList_(vars.varSize)
  const parts = []
  if (K.length) parts.push(K.length + ' nhiệt độ')
  if (W.length) parts.push(W.length + ' công suất')
  if (A.length) parts.push(A.length + ' góc')
  if (C.length) parts.push(C.length + ' màu')
  if (Z.length) parts.push(Z.length + ' kích thước')
  return { parts, total: c.length, chips: c.slice(0, 8).map(btLabel_), more: c.length > 8 ? c.length - 8 : 0 }
}

/* ===== NHẬP HÀNG LOẠT TỪ FILE (impPick / impShow / impVsCheck_ / impCommit, nhap.js:1147-1296) =====
   impGet().bulk = {products (dòng đọc từ file, sửa thẳng p._raw như bản gốc), headers, nganh, res, msg, ver, fileSeq} */
function bulkSet_(patch) { impSet(s => ({ bulk: { ...s.bulk, ...(typeof patch === 'function' ? patch(s.bulk) : patch) } })) }
export function bulkBump_() { bulkSet_(b => ({ ver: (b.ver || 0) + 1 })) }
export function impSpec_(nganh, specs) { return specNganh_(coSpec_(nganh) ? nganh : 'vs', specs) }
/* Kiểm tra 1 dòng theo hạng mục của nó -> {hm, loi:[...], na:{nhãn:1}, thieu:{nhãn:1}} */
export function impVsCheck_(p, nganh, specs) {
  const SP = impSpec_(nganh, specs)
  const raw = p._raw || {}, out = { hm: SP ? SP.chuanHM(raw['HẠNG MỤC']) : '', loi: [], na: {}, thieu: {} }
  if (!SP) { out.loi.push('Không tải được thông số ngành'); return out }
  const hm = out.hm
  if (!hm) { out.loi.push(raw['HẠNG MỤC'] ? ('Hạng mục "' + raw['HẠNG MỤC'] + '" không hợp lệ') : 'Chưa có hạng mục'); return out }
  const cho = SP.labelsOf(hm)
  Object.keys(SP.METRIC).forEach(lb => { if (cho.indexOf(lb) < 0) out.na[lb] = 1 })
  SP.HM[hm].req.forEach(lb => { if (!String(raw[lb] || '').trim()) { out.thieu[lb] = 1; out.loi.push('thiếu ' + SP.METRIC[lb][1]) } })
  return out
}
export async function impParseFile_(f, specs) {
  const ext = (f.name.split('.').pop() || '').toLowerCase()
  bulkSet_({ products: [], headers: [], res: null, msg: { kind: 'wait', text: 'Đang đọc file "' + f.name + '"…' } })
  let b64
  try { b64 = String(await readB64_(f)).split(',')[1] } catch (e) { bulkSet_({ msg: { kind: 'err', text: 'Không đọc được file.' } }); return }
  try {
    const l0 = impGet().loai
    let nganh = coSpec_(l0) ? l0 : ''
    const res = await api.importParse(b64, ext, nganh)
    // File vệ sinh / sơn nước / công tắc mà ô Ngành hàng đang để Thiết bị đèn -> tự nhận theo cột HẠNG MỤC
    if (!nganh && specs && specs.VS_SPEC) {
      const ps = res.products || [], hmRaw = p => (p._raw || {})['HẠNG MỤC'] || p.hangMuc
      const doan = [['vs', specs.VS_SPEC, 'THIẾT BỊ VỆ SINH', 'Thiết bị vệ sinh'], ['son', specs.SON_SPEC, 'SƠN NƯỚC', 'Sơn nước'], ['ct', specs.CT_SPEC, 'CÔNG TẮC - Ổ CẮM', 'Công tắc - ổ cắm'], ['dl', specs.DL_SPEC, 'ĐIỆN LẠNH', 'Điện lạnh']]
        .filter(x => x[1] && ps.length && ps.filter(p => x[1].chuanHM(hmRaw(p)) || (x[1].laChung && x[1].laChung(hmRaw(p)))).length * 2 >= ps.length)[0]
      if (doan) {
        nganh = doan[0]
        ps.forEach(p => { p._nganh = doan[0] })
        impSetLoai_(doan[0], specs)
        bulkSet_(b => ({ fileSeq: (b.fileSeq || 0) + 1 }))     // renderImport của bản gốc dựng lại ô chọn file
        toast('File là ' + doan[2] + ' (theo cột Hạng mục) — đã tự chuyển ngành hàng sang ' + doan[3])
      }
    }
    const products = res.products || []
    // Ảnh KHÔNG lấy từ file: người dùng tự tải ảnh chính / chi tiết cho từng SP sau khi đọc file
    products.forEach(p => { p.hinhAnh = '' })
    if (!res.count) {
      bulkSet_({ products, headers: res.headers || [], nganh, res, msg: { kind: 'err', text: 'Không đọc được sản phẩm nào (kiểm tra cột Tên sản phẩm).' } })
      return
    }
    bulkSet_(b => ({ products, headers: res.headers || [], nganh, res, msg: null, ver: (b.ver || 0) + 1 }))
  } catch (e) { bulkSet_({ msg: { kind: 'err', text: 'Lỗi đọc file: ' + e.message } }) }
}
export function impImgs_(p) { return String(p.hinhAnh || '').split('\n').map(s => s.trim()).filter(Boolean) }
export async function impCommitBulk_(setBtn) {
  const b = impGet().bulk, ps = b.products || []
  if (!ps.length) { toast('Chưa có dữ liệu'); return }
  if ((impGet().imgUploading || 0) > 0) {
    toast('Đang tải ảnh lên, đợi chút…')
    setBtn(true, '⏳ Đợi tải ảnh…')
    try { await waitUploads_(20000) } finally { setBtn(false, '') }
  }
  const missing = ps.filter(p => !p.hinhAnh).length
  if (missing > 0 && !await qsConfirm('Còn ' + missing + ' sản phẩm CHƯA có ảnh.\nBạn nên bấm ô ＋ ở cột Ảnh để tải hình cho từng SP.\n\nVẫn tiếp tục?')) return
  // KHÔNG lưu ngay: đưa cả lô vào danh sách CHỜ LƯU — bấm "Thêm sản phẩm" ở panel phải mới ghi vào Database
  const ng = coSpec_(b.nganh) ? b.nganh : ''
  pendingAdd_(ps.map(p => {
    if (ng) p._nganh = ng   // máy chủ đóng dấu ngành + lọc thông số theo hạng mục
    return { kind: 'file', prod: p, ten: p.ten, ma: p.ma, thuongHieu: p.thuongHieu, ncc: p.ncc, hinhAnh: p.hinhAnh, nganh: ng || 'den' }
  }))
  toast('Đã đưa ' + ps.length + ' sản phẩm vào danh sách chờ — bấm "Thêm sản phẩm" để lưu vào Database')
  bulkSet_(x => ({ products: [], headers: [], res: null, msg: null, fileSeq: (x.fileSeq || 0) + 1 }))
}
