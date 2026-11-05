/* Mô hình tính của tab Xuất báo giá: gom store QS + trạng thái giao diện (quoteState) + bộ cột Bóc tách (tkCols)
   thành ngữ cảnh của lib/quote.js, rồi tính phiên bản / trang tài liệu. Hàm thuần: dùng được trong render (useMemo)
   lẫn trong thao tác (đọc trạng thái MỚI NHẤT qua getState() / getQ() / getTkCols(), như bản gốc đọc S.*).
   Port: ptEnsure PUB/phantho.js:1934-1948 (phần giá trị) · bgWithSnap_ PUB/baogia.js:1238-1248 · bgVerInfo_ 1196-1201. */
import { ptComputeAll, ptEnsureVals_, ptKey } from '../../lib/phantho.js'
import { vsFltNganh_ } from '../../lib/catalogFilters.js'
import { bgSnap_, bgSnapKey_, bgHist_, bgVerInfo_, bgMau_ } from '../../lib/quote.js'
import { bgBuildPages } from './docModel'
import { getState } from '../../state/store'
import { getQ } from './quoteState'
import { getTkCols } from '../breakdown/sheet/tkCols'
import { tuyGop_ } from './tuyMau'

/* ptEnsure: Phần thô của dự án qua hàm dùng chung với tab Phần thô (ptEnsureVals_: projData, dự phòng localStorage pt_<maDA>,
   VAT phần thô mặc định theo VAT dự án), rồi tính trên BẢN SAO: ptSecTotals gán _kl / _tt / _ttnt lên từng dòng (như bản gốc)
   mà không sửa dữ liệu trong store. Bảng hỏng -> ptErr (tab báo rõ thay vì vỡ cả trang như bản gốc). */
function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch (e) { return null } }
function ptTinh_(pt, ptVat) {
  try { ptComputeAll(pt, ptVat); return '' } catch (e) { return String((e && e.message) || e) }
}
export function ptState_(cur, projData) {
  const k = ptKey(cur && cur.maDA)
  const v = ptEnsureVals_(projData, cur, lsJson(k), lsGet(k + '_vat'))
  const pt = JSON.parse(JSON.stringify(v.phanTho))
  return { phanTho: pt, ptVat: v.ptVat, ptErr: ptTinh_(pt, v.ptVat) }
}

/* st = {cur, lines, projData, congTy, me, node} · q = quoteState · tk = {cols, order} của Bóc tách
   snap = {v} khi xem lại 1 phiên bản đã chốt (bgWithSnap_): dữ liệu + giao diện lấy từ bản chụp v.snap */
export function quoteModel(st, q, tk, snap) {
  const cur = st.cur
  const pd = st.projData || {}
  const pt = ptState_(cur, pd)
  let ptErr = pt.ptErr
  let ctx = {
    cur, lines: st.lines || [], cover: q.cover.maDA === (cur && cur.maDA) ? q.cover.rows : [],
    vatHm: pd.vatHm || {}, bgCfg: tuyGop_(pd.bgCfg || {}), bgNodes: q.bgNodes || {}, phanTho: pt.phanTho, ptVat: pt.ptVat, congTy: st.congTy, bgOrg: pd.bgOrg,
  }
  let ui = {
    cols: tk.cols || {}, colOrder: tk.order || null, nganh: vsFltNganh_(st.node), bgColOrder: q.bgColOrder || null,
    bgColW: q.bgColW || {}, coverMau: q.coverMau, perSec: q.bgPerSec !== false, per: Number(q.bgPer) || 0,
  }
  const hist = bgHist_(pd)
  if (snap && snap.v && snap.v.snap) {
    const sn = snap.v.snap; const gd = sn.gd
    const nodes = {}; (sn.nodes || []).forEach(k => { nodes[k] = 1 })
    ctx = {
      ...ctx, lines: sn.lines || [], cover: sn.cover || [], cur: { ...cur, ...(sn.proj || {}) },
      phanTho: sn.pt ? JSON.parse(JSON.stringify(sn.pt)) : ctx.phanTho, bgCfg: sn.opt || {}, bgNodes: nodes,
      bgOrg: gd && gd.org ? gd.org : ctx.bgOrg,
    }
    if (sn.pt) ptErr = ptTinh_(ctx.phanTho, ctx.ptVat)     // xem bản chụp: lỗi là của Phần thô trong bản chụp
    if (gd) {
      ui = {
        ...ui, cols: gd.cols || ui.cols, colOrder: gd.ord && gd.ord.length ? gd.ord : ui.colOrder,
        bgColOrder: gd.bgOrd && gd.bgOrd.length ? gd.bgOrd : null, bgColW: gd.w || {}, coverMau: gd.bia || ui.coverMau,
        perSec: gd.sec !== false, per: gd.per || 0,
      }
    }
    const ver = bgVerInfo_(hist, ctx.cur, '', snap.v)
    return { ctx, ui, hist, ver, ptErr, mau: bgMau_(ctx.bgCfg), pages: () => bgBuildPages(ctx, ui, ver, st.me) }
  }
  const gd = {
    cols: ui.cols, ord: ui.colOrder || [], bgOrd: ui.bgColOrder || [], w: ui.bgColW, bia: ui.coverMau,
    sec: ui.perSec, per: ui.per, org: pd.bgOrg || null,
  }
  const sn = cur ? bgSnap_(ctx, gd) : null
  const key = sn ? bgSnapKey_(sn) : ''
  const ver = bgVerInfo_(hist, cur, key, null)
  return { ctx, ui, gd, sn, key, hist, ver, ptErr, mau: bgMau_(ctx.bgCfg), pages: () => bgBuildPages(ctx, ui, ver, st.me) }
}

/* Mô hình từ trạng thái MỚI NHẤT (dùng trong thao tác sau khi vừa ghi projData / tờ bìa) */
export function freshModel(snap) {
  const s = getState()
  return quoteModel({ cur: s.cur, lines: s.lines, projData: s.projData, congTy: s.congTy, me: s.me, node: s.node }, getQ(), getTkCols(), snap)
}

/* fmtDateTime_ (PUB/sanpham.js:1988-1993): dd/mm/yyyy hh:mm theo giờ máy */
export function fmtDateTime_(v) {
  if (v == null || v === '') return '—'
  const d = new Date(v); if (isNaN(d.getTime())) return String(v)
  const z = n => (n < 10 ? '0' : '') + n
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
}
/* cpSigned_ (PUB/chiphi.js:7): số có dấu, lớp màu âm / dương */
export function cpSigned_(v) { v = Math.round(Number(v) || 0); return { v, cls: v < 0 ? 'neg' : (v > 0 ? 'pos' : '') } }
