/* Phần thô dùng chung cho Danh sách SP chế độ 3.1 (products/pt) và Nhập dữ liệu ngành Phần thô (importer/pt).
   Port nguyên văn: PT_LOAI_NGAN / ptLoaiLabel_ / ptLoaiNgan_ / ctPatchOf_ (PUB/sanpham.js:1230-1234, 1326-1328),
   CT_BULK_F (phantho.js:692-694), CT_DEMUC_RULES / ctDeMucOf_ / ctDeMucNhan_ / CT_DEMUC_CHON / ctDeMucCua_ (phantho.js:524-564),
   ctGrpParse_ / ctGrpText_ (phantho.js:1028-1050), ptInfo_ (phantho.js:1739-1753), ptEnsure / ptPersist / ptAddFromLib phần dữ liệu
   (phantho.js:1690-1708, 1934-1955). Khác bản gốc: PT_TEMPLATE / S.phanTho / S._ptOvr toàn cục thành tham số hoặc đọc từ store,
   nên mỗi lần dùng dựng lại thư viện từ congTac (ptTpl_) và đọc phanTho từ projData (ptVals_). */
import {
  ptTemplateNew_, dtSync_, dtVals_, dtKey_, ctSyncTemplate_, ptMakeItem_, ptFindSec_, ptNewSec_, ptEnsureVals_, ptKey, PT_LOAI,
} from '../../../lib/phantho.js'
import { nodeName } from '../../../lib/tree.js'
import { getState } from '../../../state/store'
import { projDataSet_ } from '../../../state/projData'
import { denyQs, lineTab } from '../../../state/qsAccess'
import { qsToast } from '../../common/dialogs'

export function lsJson_(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v } catch (e) { return def } }
function lsSet_(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* bỏ qua: máy chặn localStorage */ } }

/* Giá sửa tay của thư viện dựng sẵn (qs_ptovr) - dùng chung với Bóc tách 3.1 nên luôn đọc lại từ localStorage */
export function ptOvrAll_() { const v = lsJson_('qs_ptovr', {}); return v && typeof v === 'object' ? v : {} }
export function ptOvrSave_(U) { lsSet_('qs_ptovr', JSON.stringify(U || {})) }
export function ptOvrClear_() { try { localStorage.removeItem('qs_ptovr') } catch (e) { /* bỏ qua */ } }

/* PT_TEMPLATE của bản gốc: thư viện mẫu + nhóm dự toán (số liệu đầu vào của dự án đang mở) + công tác trong CSDL */
export function ptTpl_(maDA, congTac) {
  const tpl = dtSync_(ptTemplateNew_(), bo => dtVals_(bo, lsJson_(dtKey_(maDA, bo.id), null)))
  return ctSyncTemplate_(tpl, congTac || []).tpl
}

export const PT_LOAI_NGAN = { kt_chitiet: 'KT chi tiết', kt_sobo: 'KT sơ bộ', dt_nhancong: 'DT · Nhân công', dt_vattu: 'DT · Vật tư' }
export function ptLoaiLabel_(v) { const g = String(v || 'kt_chitiet'); const m = PT_LOAI.filter(x => x[0] === g)[0]; return m ? m[1] : v }
export function ptLoaiNgan_(v) { return PT_LOAI_NGAN[v] || ptLoaiLabel_(v) }

/* gói dữ liệu 1 công tác để gửi lên server (giữ nguyên các trường không sửa) */
export function ctPatchOf_(c) {
  return { loai: c.loai, mode: c.mode, maNhom: c.maNhom, hangMuc: c.hangMuc, ten: c.ten, dvt: c.dvt,
    kl: c.kl, dt: c.dt, hs: c.hs, dgnt: c.dgnt, dg: c.dg, gc: c.gc, hinhAnh: c.hinhAnh,
    thongSo: c.thongSo, phamVi: c.phamVi, linkTaiLieu: c.linkTaiLieu }
}
// Sửa hàng loạt: đổi 1 trường cho mọi công tác đang chọn
export const CT_BULK_F = [['dg', 'Giá bán lẻ (đ)', 'money'], ['dgnt', 'Đơn giá nhà thầu (đ)', 'money'], ['dvt', 'Đơn vị tính', 'text'],
  ['ncc', 'Nhà thầu · nhà cung cấp', 'text'], ['hangMuc', 'Hạng mục', 'text'], ['maNhom', 'Số hạng mục', 'text'],
  ['loai', 'Loại báo giá', 'loai'], ['gc', 'Ghi chú', 'text']]

/* Đề mục bóc tách của công tác: rỗng = tự nhận theo tên hạng mục · '0' = chỉ ở 3.1 · mã đề mục = ghim vào đó */
const CT_DEMUC_RULES = [
  [/thach cao/, '3.2.1'],
  [/son nuoc|\bson\b/, '3.2.2'],
  [/xay tuong|trat tuong|xay to/, '3.2.3'],
  [/op lat|\bda\b|san go/, '3.2.4'],
  [/nhom|kinh|\bsat\b|cua cuon|\bcua\b/, '3.2.8'],
]
export function ctDeMucOf_(hangMuc) {
  const t = String(hangMuc || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
  for (let i = 0; i < CT_DEMUC_RULES.length; i++) if (CT_DEMUC_RULES[i][0].test(t)) return CT_DEMUC_RULES[i][1]
  return ''
}
export const CT_DEMUC_CHON = ['3.2.1', '3.2.2', '3.2.3', '3.2.4', '3.2.5', '3.2.6', '3.2.6.1', '3.2.6.2', '3.2.7', '3.2.8', '3.2.8.1', '3.2.8.2']
export function ctDeMucNhan_(hangMuc) { const c = ctDeMucOf_(hangMuc); return c ? (c + ' ' + nodeName(c)) : '' }
export function ctDeMucCua_(c) {
  const v = String((c && c.deMuc) || '').trim()
  if (v === '0') return ''
  if (v) return v
  return ctDeMucOf_((c && c.hangMuc) || '')
}

/* Đề mục lớn / nhỏ lưu trong 1 ô text: "## Tên đề mục lớn" rồi các dòng "Tên: giá trị" */
export function ctGrpParse_(txt) {
  const out = []; let cur = null
  String(txt || '').split(/\r?\n/).forEach(raw => {
    const l = raw.trim(); if (!l) return
    // dòng thụt vào = dòng tiếp theo của CÙNG một đề mục nhỏ (thẻ nhập nhiều dòng)
    if (/^\s+/.test(raw) && cur && cur.rows.length) { const last = cur.rows[cur.rows.length - 1]; last.v = (last.v ? last.v + '\n' : '') + l; return }
    const m = l.match(/^##\s*(.*)$/)
    if (m) { cur = { t: m[1].trim(), rows: [] }; out.push(cur); return }
    if (!cur) { cur = { t: 'Thông số kỹ thuật', rows: [] }; out.push(cur) }
    const kv = l.match(/^([^:：]{1,60})[:：]\s*(.*)$/)
    cur.rows.push(kv ? { k: kv[1].trim(), v: kv[2].trim() } : { k: '', v: l })
  })
  return out
}
export function ctGrpText_(grps) {
  grps = (grps || []).filter(g => String(g.t || '').trim() || (g.rows || []).some(r => String(r.k || '').trim() || String(r.v || '').trim()))
  return grps.map(g => '## ' + (g.t || 'Thông số kỹ thuật') + '\n'
    + g.rows.filter(r => (r.k || '').trim() || (r.v || '').trim())
      .map(r => {
        const t = (r.k || '').trim() ? ((r.k).trim() + ': ' + (r.v || '').trim()) : (r.v || '').trim()
        return t.split(/\r?\n/).map((x, i) => (i ? ('  ' + x.trim()) : x)).join('\n')
      }).join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* Thông tin thêm của công tác dựng sẵn (PT_INFO rỗng trong bản gốc) + phần người dùng nhập (projData.ptInfo, dự phòng qs_ptinfo) */
const PT_INFO = {}
export function ptInfoKey_(ten) { return String(ten || '').split('\n')[0].trim().toLowerCase() }
export function ptInfoUser_(projData) {
  let d = projData && projData.ptInfo
  if (!d || typeof d !== 'object') { d = lsJson_('qs_ptinfo', {}); if (!d || typeof d !== 'object') d = {} }
  return d
}
export function ptInfo_(ten, projData) {
  const k = ptInfoKey_(ten), a = PT_INFO[k] || {}, b = ptInfoUser_(projData)[k] || {}, o = {}
  ;['anh', 'model', 'ts', 'gc', 'pv', 'tl'].forEach(f => { o[f] = (b[f] != null && b[f] !== '') ? b[f] : (a[f] || '') })
  return o
}

/* Bảng khái toán + VAT của dự án đang mở (ptEnsure) */
export function ptVals_() {
  const S = getState(), ma = S.cur && S.cur.maDA
  let vat = null
  try { vat = localStorage.getItem(ptKey(ma) + '_vat') } catch (e) { vat = null }
  return ptEnsureVals_(S.projData, S.cur, lsJson_(ptKey(ma), null), vat)
}
/* ptPersist: lưu máy + projData (phanTho, ptVat) */
export function ptPersist_(phanTho, ptVat) {
  if (denyQs(lineTab('edit'), 'edit')) return   // N21: ghi bảng Phần thô của dự án
  const S = getState(), k = ptKey(S.cur && S.cur.maDA)
  let v = Number(ptVat); if (!isFinite(v)) v = 0
  lsSet_(k, JSON.stringify(phanTho)); lsSet_(k + '_vat', String(v))
  projDataSet_('phanTho', phanTho); projDataSet_('ptVat', v)
}
/* Thêm các công tác refs = [[si, ii], ...] của thư viện tpl vào bảng khái toán (ptAddFromLib, nhánh bấm ＋: về đúng hạng mục theo mẫu).
   Trả số dòng đã thêm; chưa chọn dự án thì báo và trả -1. */
export function ptAddFromLib_(tpl, refs) {
  const S = getState()
  if (!S.cur) { qsToast('Chọn dự án trước khi thêm công tác vào bảng'); return -1 }
  const { phanTho, ptVat } = ptVals_()
  const pt = JSON.parse(JSON.stringify(phanTho || []))
  const ovr = ptOvrAll_()
  let n = 0
  refs.forEach(([si, ii]) => {
    const tsec = tpl[si]; if (!tsec) return
    const a = tsec.items[ii]; if (!a) return
    const item = ptMakeItem_(tsec, a, ovr)
    let sec = ptFindSec_(pt, tsec)
    if (!sec) { sec = ptNewSec_(tsec); pt.push(sec) }
    sec.items.push(item); n++
  })
  if (n) ptPersist_(pt, ptVat)
  return n
}
