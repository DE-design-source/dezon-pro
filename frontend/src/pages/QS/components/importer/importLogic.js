/* Nghiệp vụ tab Nhập dữ liệu (port nguyên văn PUB/nhap.js): bộ trường theo ngành, lưu form vào danh sách chờ (tdSave),
   sửa dòng chờ (pendItemData_ / pendFillForm_), biến thể (varCombos_), lưu danh sách chờ vào Database (pendingCommit_),
   đồng bộ danh sách "vừa nhập" sau khi sửa (impSyncSession_). Spec ngành là tham số specs = {VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC}. */
import * as api from '../../api/qsApi'
import { getState, subscribe, reloadProducts, reloadLines } from '../../state/store'
import { qsToast, qsConfirm, qsAlert } from '../common/dialogs'
import { coSpec_, specNganh_, groupsOfNganh_, flat_, IMP_TRUC, impGon_ } from '../../lib/productFields'
import { tkNum_ } from '../../lib/format'
import { nodeName } from '../../lib/tree'
import { impGet, impSet, emptyForm_, pendingAdd_, pendUid_, sessionAdd_, waitUploads_, nowIsoClient_, bulkCleared_ } from './importStore'

const toast = qsToast

/* Ngành đang chọn -> bộ nhóm trường (impGroups_); 'sp' = đèn */
export function impGroups_(loai, specs) { return groupsOfNganh_(coSpec_(loai) ? loai : 'den', specs || {}) }
export function impFlat_(loai, specs) { return flat_(impGroups_(loai, specs)) }

/* vsApplyHM_ (PUB/nhap.js:261-278) ở dạng tính toán: hạng mục -> {SPEC, hm, cho} — ô thông số nào hiện, thứ tự, dấu *, gợi ý chọn */
export function vsApply_(hmRaw, loai, specs) {
  if (!specs || !specs.SON_SPEC) return { SPEC: null, hm: '', cho: [] }
  const SPEC = specs.SON_SPEC.chuanHM(hmRaw) ? specs.SON_SPEC : (specs.CT_SPEC.chuanHM(hmRaw) ? specs.CT_SPEC
    : (specs.DL_SPEC && specs.DL_SPEC.chuanHM(hmRaw) ? specs.DL_SPEC : specNganh_(loai, specs)))
  const hm = SPEC.chuanHM(hmRaw)
  return { SPEC, hm, cho: hm ? SPEC.labelsOf(hm) : [] }
}

/* Giá đại lý tự tính = Giá bán lẻ × (1 − %CK) (dbCalcDaiLy, nhap.js:280-284) */
export function dbCalcDaiLy_(vals) {
  const g = Number(vals['GIÁ BÁN LẺ']) || 0, ck = Number(vals['CHIẾT KHẤU ĐẠI LÝ (%)']) || 0
  return g ? Math.round(g * (1 - ck / 100)) : ''
}

/* ===== BIẾN THỂ (nhap.js:1298-1314) ===== */
export function varList_(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean) }
export function varCombos_(vars) {
  const K = varList_(vars.varKelvin), W = varList_(vars.varWatt), A = varList_(vars.varAngle), C = varList_(vars.varColor), Z = varList_(vars.varSize)
  if (!K.length && !W.length && !A.length && !C.length && !Z.length) return []
  const out = []
  ;(K.length ? K : [null]).forEach(k => {
    (W.length ? W : [null]).forEach(w => {
      (A.length ? A : [null]).forEach(a => {
        (C.length ? C : [null]).forEach(c => {
          (Z.length ? Z : [null]).forEach(z => { out.push({ k, w, a, c, z }) })
        })
      })
    })
  })
  return out
}
// Chỉ lấy ô biến thể đang hiện theo ngành (bản gốc đọc theo id ô có trong DOM)
export function varsOfLoai_(vars, loai) {
  const v = { varKelvin: '', varWatt: '', varAngle: '', varColor: vars.varColor || '', varSize: '' }
  if (loai === 'ct' || loai === 'dl') return v
  if (loai === 'son' || loai === 'vs') return { ...v, varSize: vars.varSize || '' }
  return { ...v, varKelvin: vars.varKelvin || '', varWatt: vars.varWatt || '', varAngle: vars.varAngle || '' }
}
export const btLabel_ = x => [x.w ? x.w + 'W' : '', x.k ? x.k + 'K' : '', x.a ? x.a + '°' : '', x.c || '', x.z || ''].filter(Boolean).join(' · ')

/* "Xoá form" / form mới (renderImport) */
export function resetForm_() { impSet(s => ({ form: emptyForm_(), bulk: bulkCleared_(s.bulk) })) }

/* ===== Dòng chờ -> dữ liệu form (pendItemData_ / pendNganhLoai_, nhap.js:540-549) ===== */
export function pendItemData_(it) {
  if (it.kind === 'form') return Object.assign({}, it.data)
  const d = Object.assign({}, (it.prod && it.prod._raw) || {}), p = it.prod || {}
  const fill = (k, v) => { if (!String(d[k] || '').trim() && v) d[k] = v }
  fill('TÊN SẢN PHẨM', p.ten); fill('MÃ SẢN PHẨM', p.ma); fill('THƯƠNG HIỆU', p.thuongHieu); fill('NHÀ CUNG CẤP', p.ncc)
  fill('HẠNG MỤC', p.hangMuc); fill('GIÁ BÁN LẺ', p.gia ? String(p.gia) : ''); fill('ĐƠN VỊ TÍNH', p.dvt)
  if (p.hinhAnh) d['ẢNH SẢN PHẨM'] = p.hinhAnh
  return d
}
export function pendNganhLoai_(it) { const n = it.nganh || pendItemData_(it)['NGÀNH HÀNG']; return coSpec_(n) ? n : 'sp' }

/* pendFillForm_ (nhap.js:560-578): nạp dòng chờ vào form */
export function pendFormOf_(it, loai, specs) {
  const d = pendItemData_(it), form = emptyForm_(), vals = {}
  impFlat_(loai, specs).forEach(f => {
    let v = d[f[0]]
    if (f[0] === 'HẠNG MỤC' && coSpec_(loai)) { const SP = specNganh_(loai, specs); v = (SP && SP.chuanHM(v)) || v }
    if (v != null && v !== '' && f[2] === 'num') v = tkNum_(v)   // "1.200.000" / "12,5" -> ô kiểu số nhận được
    if (v != null && v !== '') {
      // ô chọn hạng mục: giá trị ngoài danh sách thì ô hiện trống, như <select> của bản gốc
      if (f[2] === 'hm' && (f[4] || []).indexOf(String(v)) < 0) return
      vals[f[0]] = String(v)
    }
  })
  form.vals = vals
  form.combo = (it.combo || []).map(x => Object.assign({}, x))
  const imgs = String(d['ẢNH SẢN PHẨM'] || it.hinhAnh || '').split('\n').map(x => x.trim()).filter(Boolean)
  form.imgMain = imgs[0] || ''; form.imgList = imgs.slice(1)
  if (it.ghi) form.ghi = { on: true, maDA: it.ghi.maDA, qty: String(it.ghi.qty) }
  return form
}

/* ===== tdSave (nhap.js:1332-1401): form -> danh sách chờ ===== */
export async function tdSave_(specs, setBtn) {
  const st = impGet(), F = st.form, ngIn = st.loai, laVS = coSpec_(ngIn), SPEC = laVS ? specNganh_(ngIn, specs) : null
  const data = {}
  const hmVS = laVS ? SPEC.chuanHM(F.vals['HẠNG MỤC'] || '') : ''
  impFlat_(ngIn, specs).forEach(f => {
    if (f[2] === 'calc') return              // ô tự tính, bị bỏ trước khi lưu
    if (laVS && f[6] === 'vs' && SPEC.labelsOf(hmVS).indexOf(f[0]) < 0) return   // thông số của hạng mục khác
    const v = String(F.vals[f[0]] || '').trim(); if (v) data[f[0]] = v
  })
  data['NGÀNH HÀNG'] = laVS ? ngIn : 'den'   // đóng dấu ngành -> SP về đúng đề mục trên cây
  const ten = String(data['TÊN SẢN PHẨM'] || '').trim(); if (!ten) { toast('Nhập Tên sản phẩm'); return }
  const vars = varsOfLoai_(F.vars, ngIn)
  if (laVS) {
    if (!hmVS) { toast('Chọn Hạng mục ' + (ngIn === 'son' ? 'sơn nước' : (ngIn === 'ct' ? 'công tắc - ổ cắm' : (ngIn === 'dl' ? 'điện lạnh' : 'thiết bị vệ sinh')))); return }
    let thieu = SPEC.HM[hmVS].req.filter(lb => !data[lb])
    // biến thể theo màu / kích thước điền ở khối Biến thể thì không tính là thiếu
    if (varList_(vars.varColor).length) thieu = thieu.filter(lb => lb !== 'MÀU SẮC')
    if (varList_(vars.varSize).length) thieu = thieu.filter(lb => lb !== 'KÍCH THƯỚC')
    if (thieu.length) { toast(hmVS + ' cần nhập: ' + thieu.map(lb => SPEC.METRIC[lb][1]).join(', ')); return }
  }
  delete data['GIÁ ĐẠI LÝ']
  if (!data['ĐƠN VỊ TÍNH']) data['ĐƠN VỊ TÍNH'] = (ngIn === 'son' ? 'Thùng' : 'Cái')
  if (!data['TRẠNG THÁI']) data['TRẠNG THÁI'] = 'Đang kinh doanh'
  setBtn(true, '')
  try {
    if ((impGet().imgUploading || 0) > 0) { setBtn(true, '⏳ Đợi tải ảnh…'); await waitUploads_(15000) }
    const F2 = impGet().form
    const imgs = [F2.imgMain].concat(F2.imgList || []).filter(Boolean).filter(v => v.indexOf('data:') !== 0)   // bỏ ảnh tạm chưa tải xong
    if (imgs.length) data['ẢNH SẢN PHẨM'] = imgs.join('\n')
    const meta = { thuongHieu: data['THƯƠNG HIỆU'] || '', ncc: data['NHÀ CUNG CẤP'] || '', hinhAnh: data['ẢNH SẢN PHẨM'] || '', nganh: data['NGÀNH HÀNG'] }
    const combos = varCombos_(vars), items = []
    if (combos.length) {
      // BIẾN THỂ: 1 sản phẩm cho mỗi tổ hợp (cùng mã SP, khác nhiệt độ/công suất/góc/màu/kích thước)
      combos.forEach(c => {
        const d2 = Object.assign({}, data)
        if (c.k) d2['NHIỆT ĐỘ MÀU (K)'] = c.k
        if (c.w) d2['CÔNG SUẤT (W)'] = c.w
        if (c.a) d2['GÓC CHIẾU (°)'] = c.a
        if (c.c) d2['MÀU SẮC'] = c.c
        if (c.z) d2['KÍCH THƯỚC'] = c.z
        items.push(Object.assign({ kind: 'form', data: d2, ten, bienThe: btLabel_(c), ma: data['MÃ SẢN PHẨM'] || '' }, meta))
      })
    } else items.push(Object.assign({ kind: 'form', data, ten, ma: data['MÃ SẢN PHẨM'] || '' }, meta))
    const cbo = (F2.combo || []).map(x => Object.assign({}, x))
    if (cbo.length) items.forEach(x => { x.combo = cbo })          // mỗi biến thể cùng bộ đi kèm
    const g = F2.ghi, cur = getState().cur
    const maDA = g.maDA == null ? ((cur && cur.maDA) || '') : g.maDA
    // Tick ghi danh mà chưa chọn dự án -> báo ngay
    if (g.on && !maDA) { toast('Đã tick "Thêm vào dự án" nhưng chưa chọn dự án — chọn dự án ở ô bên cạnh'); return 'focusProj' }
    if (g.on && maDA) {
      const gia = Number(data['GIÁ BÁN LẺ']) || 0, qty = Math.max(1, Number(g.qty) || 1)
      // Đề mục theo NGÀNH đang nhập: sơn 3.2.2, công tắc 3.2.6.2, điện lạnh 3.2.7, vệ sinh 3.2.5, đèn 3.2.6.1
      const ndGhi = ngIn === 'son' ? '3.2.2' : (ngIn === 'ct' ? '3.2.6.2' : (ngIn === 'dl' ? '3.2.7' : (ngIn === 'vs' ? '3.2.5' : '3.2.6.1')))
      items[0].ghi = { maDA, qty, prod: { ten, ma: data['MÃ SẢN PHẨM'] || '', thuongHieu: data['THƯƠNG HIỆU'] || '', ncc: data['NHÀ CUNG CẤP'] || '',
        moTa: data['MÔ TẢ'] || '', kichThuoc: data['KÍCH THƯỚC'] || '', dvt: data['ĐƠN VỊ TÍNH'] || 'Cái', hinhAnh: data['ẢNH SẢN PHẨM'] || '',
        donGiaVon: gia, donGiaBan: gia, nhom: ndGhi, hangMuc: nodeName(ndGhi), loai: nodeName(ndGhi), tang: '', extra: { nganh: data['DÒNG SẢN PHẨM'] || '' } } }
    }
    const st2 = impGet(), dangSua = st2.pendEdit, viTri = (st2.pending || []).map(x => x.uid).indexOf(dangSua)
    if (dangSua && viTri >= 0) {
      // SỬA: thay đúng dòng đang sửa (giữ vị trí)
      items.forEach(x => { x.uid = pendUid_() })
      const p = st2.pending.slice(); p.splice(viTri, 1, ...items)
      impSet(s => ({ pending: p, pendEdit: null, form: emptyForm_(), bulk: bulkCleared_(s.bulk) }))
      toast('Đã cập nhật "' + ten + '" trong danh sách chờ')
    } else {
      impSet({ pendEdit: null })
      pendingAdd_(items)
      impSet(s => ({ form: emptyForm_(), bulk: bulkCleared_(s.bulk) }))
      toast('Đã đưa ' + (items.length > 1 ? (items.length + ' biến thể của ') : '') + '"' + ten + '" vào danh sách chờ — bấm "Thêm sản phẩm" để lưu vào Database')
    }
    return 'ok'
  } finally { setBtn(false, '') }
}

/* ===== DANH SÁCH CHỜ (nhap.js:532-559, 587-663) ===== */
export async function pendingDel_(it) {
  if (!await qsConfirm('Xoá "' + it.ten + '" khỏi danh sách chờ?\n(Sản phẩm chưa được lưu vào Database nên sẽ mất hẳn.)')) return
  const st = impGet(), j = st.pending.indexOf(it); if (j < 0) return
  const p = st.pending.slice(); p.splice(j, 1)
  if (st.pendEdit === it.uid) impSet(s => ({ pending: p, pendEdit: null, form: emptyForm_(), bulk: bulkCleared_(s.bulk) }))
  else impSet({ pending: p })
}
export async function pendingEdit_(it, specs) {
  const st = impGet()
  if (st.committing) { toast('Đang lưu vào Database — đợi xong rồi sửa'); return false }
  if (st.pendEdit && st.pendEdit !== it.uid && !await qsConfirm('Đang sửa một sản phẩm khác — bỏ các thay đổi chưa cập nhật?')) return false
  const loai = pendNganhLoai_(it)
  impSet(s => ({ pendEdit: it.uid, loai, form: pendFormOf_(it, loai, specs), bulk: bulkCleared_(s.bulk) }))
  toast('Đã mở "' + it.ten + '" trong form — sửa xong bấm "Cập nhật vào danh sách chờ"')
  return true
}

/* Trùng mã + thông số biến thể với SP đã có -> máy chủ sẽ cập nhật đè (impTrungSP_, nhap.js:601-608) */
export function impTrungSP_(it, products) {
  const o = it.data || it.prod || {}, ma = String(o['MÃ SẢN PHẨM'] || o.ma || it.ma || '').trim(); if (!ma) return null
  return (products || []).filter(p => {
    if (String(p.ma || '').trim().toLowerCase() !== ma.toLowerCase() || p.spChung) return false
    return IMP_TRUC.every(t => {
      let v = o[t[0]]; if (v == null) v = o[t[1]]
      if (v == null || v === '') return true   // ô bỏ trống: không tính khác
      return impGon_(v) === impGon_(p.raw && p.raw[t[2]])
    })
  })[0] || null
}

export async function pendingCommit_() {
  const st = impGet()
  if (st.committing) return                          // đang lưu -> bỏ qua lần bấm thứ 2
  const ds = (st.pending || []).slice(); if (!ds.length) { toast('Chưa có sản phẩm nào chờ lưu'); return }
  if (st.pendEdit && !await qsConfirm('Bạn đang sửa 1 sản phẩm trong form nhưng chưa bấm "Cập nhật".\nLưu luôn bản CŨ của sản phẩm đó?')) return
  if (impGet().pendEdit) impSet(s => ({ pendEdit: null, form: emptyForm_(), bulk: bulkCleared_(s.bulk) }))
  impSet({ committing: true, commitText: '' })
  try { await pendingCommitRun_(ds) } finally { impSet({ committing: false, commitText: '' }) }
}

async function pendingCommitRun_(ds) {
  const trung = ds.map(it => { const p = impTrungSP_(it, getState().products); return p ? (it.ten + ' (mã ' + p.ma + ')') : null }).filter(Boolean)
  if (trung.length && !await qsConfirm({ title: trung.length + ' sản phẩm đã có sẵn', ok: 'Vẫn lưu (cập nhật đè)', huy: 'Xem lại',
    note: 'Trùng mã + thông số với sản phẩm đã có trong Database — lưu sẽ CẬP NHẬT ĐÈ lên sản phẩm cũ. Muốn tạo sản phẩm riêng thì đổi mã, hoặc đổi màu / kích thước / công suất để thành biến thể.',
    dong: trung })) return
  impSet({ commitText: '⏳ Đang lưu 0/' + ds.length + '…' })
  let ok = 0, loi = 0, ghiN = 0
  const conLai = [], ghiDs = []
  const form = ds.filter(x => x.kind === 'form'), file = ds.filter(x => x.kind === 'file')
  for (let k = 0; k < form.length; k++) {
    const it = form[k]
    try {
      const rs = await api.saveDbProduct(it.data); ok++
      if (it.combo && it.combo.length && rs && rs.id) {
        try { await api.setCombo(String(rs.id), it.combo.map(x => ({ id: x.recordId, soLuong: Number(x.comboSL) || 1 }))) }
        catch (e4) { toast('Lưu "' + it.ten + '" OK nhưng combo lỗi: ' + e4.message) }
      }
      sessionAdd_({ ten: it.ten + (it.bienThe ? ' (' + it.bienThe + ')' : ''), ma: it.ma, thuongHieu: it.thuongHieu, ncc: it.ncc, hinhAnh: it.hinhAnh })
      // ghi danh vào dự án: để dành, chạy sau khi tải lại danh mục (lấy đúng SP vừa lưu)
      if (it.ghi) ghiDs.push({ ghi: it.ghi, rid: (rs && rs.id != null) ? String(rs.id) : '', ten: it.ten })
    } catch (e) { loi++; it.loi = String(e.message || '').slice(0, 160); conLai.push(it) }
    impSet({ commitText: '⏳ Đang lưu ' + (k + 1) + '/' + ds.length + '…' })
  }
  if (file.length) {
    try {
      const r = await api.importCommit(file.map(x => x.prod))
      // Lỗi trả theo CHỈ SỐ dòng (i) — 2 biến thể cùng tên không bị báo lỗi lẫn nhau
      const bad = {}; ((r && r.errors) || []).forEach(e => { if (e.i != null) bad[e.i] = e.error })
      file.forEach((it, fi) => {
        if (bad[fi] != null) { loi++; it.loi = String(bad[fi]).slice(0, 160); conLai.push(it) }
        else { ok++; sessionAdd_({ ten: it.ten, ma: it.ma, thuongHieu: it.thuongHieu, ncc: it.ncc, hinhAnh: it.hinhAnh }) }
      })
    } catch (e) { file.forEach(it => { loi++; it.loi = String(e.message || '').slice(0, 160); conLai.push(it) }) }
  }
  // Chỉ bỏ những dòng đã lưu xong — dòng thêm/sửa TRONG LÚC đang lưu vẫn giữ lại
  const xong = {}; ds.forEach(x => { if (conLai.indexOf(x) < 0) xong[x.uid] = 1 })
  impSet(s => ({ pending: (s.pending || []).filter(x => !xong[x.uid]).map(x => ({ ...x })) }))
  await reloadProducts()
  // Ghi danh vào dự án — SAU khi danh mục đã tải lại: dòng trong dự án có đủ thông số / ảnh của SP vừa lưu
  for (let gi = 0; gi < ghiDs.length; gi++) {
    const g = ghiDs[gi]
    let pr = g.ghi.prod
    const nd = String(pr.nhom || '3.2.6.1')
    const real = g.rid ? (getState().products || []).filter(x => String(x.recordId || '') === g.rid)[0] : null
    if (real) pr = Object.assign({}, real, { nhom: nd, hangMuc: nodeName(nd), loai: nodeName(nd), tang: '', extra: { nganh: real.nhom || '' } })
    try {
      await api.addLine(g.ghi.maDA, pr, g.ghi.qty); ghiN++
      const cur = getState().cur
      if (cur && cur.maDA === g.ghi.maDA) await reloadLines()
    } catch (e3) { toast('Lưu "' + g.ten + '" OK nhưng ghi danh dự án lỗi: ' + e3.message) }
  }
  const msg = 'Đã lưu ' + ok + ' sản phẩm vào Database' + (ghiN ? (' · ghi danh ' + ghiN + ' vào dự án') : '')
  const baoLoi = () => qsAlert({ title: loi + ' sản phẩm chưa lưu được', ok: 'Đã hiểu',
    note: msg + '.\nCác dòng dưới đây vẫn nằm trong danh sách chờ (nhãn "Lỗi") — sửa rồi bấm Thêm sản phẩm lại.',
    dong: conLai.map(x => (x.ten || '(không tên)') + ' — ' + x.loi) })
  // Hết phiên giữa lúc lưu: bản gốc để màn đăng nhập nằm TRÊN hộp báo; ở đây hộp báo (.qs-mroot) sẽ che nút Đăng nhập
  // -> đợi đăng nhập lại rồi mới hiện; đăng xuất thì bỏ (bản gốc tải lại trang)
  if (loi && getState().auth === 'login') afterLogin_(baoLoi)
  else if (loi) await baoLoi()
  else toast(msg)
}
function afterLogin_(fn) {
  const off = subscribe(() => {
    const q = getState()
    if (!q.me) { off(); return }
    if (q.auth === 'ready') { off(); fn() }
  })
}

/* Sau khi lưu ở modal Sửa: cập nhật lại dòng trong panel phiên cho khớp dữ liệu mới (impSyncSession_, nhap.js:676-692) */
export function impSyncSession_(key) {
  const ds = impGet().sessionAdded || []; if (!ds.length || !key) return
  const k = String(key).trim().toLowerCase()
  const p = (getState().products || []).filter(x => String(x.ma || '').trim().toLowerCase() === k || String(x.recordId || '') === String(key))[0]
  if (!p) return
  const pm = String(p.ma || '').trim().toLowerCase()
  impSet({ sessionAdded: ds.map(s => {
    if (String(s.ma || '').trim().toLowerCase() !== pm) return s
    return { ...s, ten: s.nhieuBienThe ? s.ten : (p.ten || s.ten), thuongHieu: p.thuongHieu || s.thuongHieu, hinhAnh: p.hinhAnh || s.hinhAnh, capNhat: nowIsoClient_() }
  }) })
}

/* impEditSession_ (nhap.js:667-674): tìm SP theo mã trong danh mục -> trả SP để mở modal Cập nhật sản phẩm */
export async function impFindSessionProduct_(s) {
  if (!s || !s.ma) return null
  if (!(getState().products || []).length) await reloadProducts()
  const ma = String(s.ma).trim().toLowerCase()
  const p = (getState().products || []).filter(x => String(x.ma || '').trim().toLowerCase() === ma)[0]
  if (!p) { toast('Không tìm thấy "' + s.ma + '" trong danh mục — có thể đã bị xoá'); return null }
  return p
}
