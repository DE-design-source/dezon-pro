import { useMemo, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import QsIcon from '../common/QsIcon'
import ProductThumb from '../common/ProductThumb'
import ChangeInput from './ChangeInput'
import NodePicker from './NodePicker'
import { mediaUrl } from '../../api/files'
import { updateLine, deleteLines, useQsStore } from '../../state/store'
import { COLS, visCols, colW } from '../../lib/columns.js'
import { money } from '../../lib/format.js'
import { ttBan_ } from '../../lib/calc.js'
import { areaCompute_, fmtM2_, bgLines_, bgTong_, bgVatParts_, computeQuoteLocal, coverCosts, donGiaPhanTho_ } from '../../lib/quote.js'
import { lineText, lineApply, tkSheetSua_, TK_SO, TK_GIUA } from '../breakdown/sheet/tkModel'
import { toggleCol } from '../breakdown/sheet/tkCols'
import { areaLoad_, areaSet, areaApply } from './quoteActions'
import { ROMAN_ } from './docModel'
import { useQuoteUi } from './quoteState'
import { ptState_ } from './quoteModel'

/* Khối "Bảng tính diện tích (hệ số)" (bgAreaHTML PUB/baogia.js:102-124): đóng/mở, sửa số tầng / dài / rộng, "Áp vào tờ bìa".
   Dữ liệu: projData.area (dự phòng localStorage qs_area_<maDA>).
   M6.1 (GIẢ ĐỊNH, chờ chủ sản phẩm xác nhận): dòng chỉ đọc "Đơn giá phần thô / m² đất" = chi phí mục 3.1 của tờ bìa (coverCosts, cùng số
   với ô 3.1 ở tờ bìa) ÷ diện tích khu đất. Chỉ hiển thị: không lưu, không vào bản xem trước / Excel.
   ctx (tuỳ chọn) = ngữ cảnh lib/quote.js của tab; không truyền thì tự dựng phần coverCosts cần, cùng nguồn như quoteModel.
   Chỉ tính khi thẻ đang mở (dòng chỉ hiện lúc mở) để khỏi tính lại Phần thô mỗi lần sửa dòng. */
export function AreaTable({ projData, ctx }) {
  const [open, setOpen] = useState(false)
  const cur = useQsStore(s => s.cur)
  const lines = useQsStore(s => s.lines)
  const q = useQuoteUi()
  const c = areaCompute_(areaLoad_(projData))
  const cost31 = useMemo(() => {
    if (!open) return null
    let x = ctx
    if (!x) {
      const pt = ptState_(cur, projData || {})
      x = { cur, lines: lines || [], cover: q.cover.maDA === (cur && cur.maDA) ? q.cover.rows : [], bgCfg: (projData || {}).bgCfg || {}, phanTho: pt.phanTho, ptVat: pt.ptVat }
    }
    return coverCosts(x).cost['3.1']
  }, [open, ctx, cur, lines, projData, q.cover])
  const co31 = cost31 != null
  const hienDg = co31 && cost31 >= 0 && c.groundArea > 0
  const dg = hienDg ? donGiaPhanTho_(cost31, c.groundArea) : 0
  const dgTitle = 'Giả định, chờ chủ sản phẩm xác nhận. Đơn giá phần thô / m² đất = Chi phí mục 3.1 trên tờ bìa ÷ Diện tích khu đất (Dài × Rộng)'
    + (!co31 ? '. Tờ bìa chưa có mục 3.1.'
      : cost31 < 0 ? '. Chi phí mục 3.1 đang âm.'
      : c.groundArea > 0 ? ' = ' + money(cost31) + ' ÷ ' + fmtM2_(c.groundArea) + ' = ' + money(dg) + ' đ/m².' : '. Chưa nhập diện tích khu đất.')
    + ' Chỉ hiển thị: không lưu, không đưa vào bản xem trước / Excel.'
  return (
    <div className="qs-card qs-qt-card">
      <div className={`qsq-area-h${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="qs-qt-card-icon"><QsIcon name="ruler" size={15} /></span>
        <b>Bảng tính diện tích (hệ số)</b>
        <span className="qs-qt-pill">DT báo giá <b>{fmtM2_(c.dtBaoGia)}</b> m²</span>
        <span className="qs-qt-pill">DT sử dụng <b>{fmtM2_(c.dtSuDung)}</b> m²</span>
        <span style={{ flex: 1 }} />
        {open && <button type="button" className="qs-qt-btn" onClick={e => { e.stopPropagation(); areaApply() }}><Icon name="check" size={14} />Áp vào tờ bìa</button>}
        <span className={`qs-bd-caret${open ? ' up' : ''}`} />
      </div>
      {open && (
        <div className="qs-qt-card-body">
          <div style={{ overflowX: 'auto' }}>
            <table className="qs-qt-area qsq-areatbl">
              <thead><tr><th>HẠNG MỤC</th><th className="r">SỐ TẦNG</th><th className="r">DÀI</th><th className="r">RỘNG</th><th className="r">DIỆN TÍCH</th><th className="r">TỔNG</th><th className="c">HỆ SỐ</th><th className="r">DT BÁO GIÁ</th><th className="r">DT SỬ DỤNG</th></tr></thead>
              <tbody>
                {c.rows.map(r => (
                  <tr key={r.t.k}>
                    <td>{r.t.label}</td>
                    <td className="r"><ChangeInput style={{ width: 56 }} value={r.cnt || ''} placeholder="0" onCommit={v => areaSet(r.t.k, 'count', v)} /></td>
                    <td className="r"><ChangeInput value={r.dai || ''} placeholder="0" onCommit={v => areaSet(r.t.k, 'dai', v)} /></td>
                    <td className="r"><ChangeInput value={r.rong || ''} placeholder="0" onCommit={v => areaSet(r.t.k, 'rong', v)} /></td>
                    <td className="r">{fmtM2_(r.dt)}</td><td className="r">{fmtM2_(r.tong)}</td>
                    <td className="c">{String(r.t.hs).replace('.', ',')}</td>
                    <td className="r"><b>{fmtM2_(r.bao)}</b></td><td className="r">{fmtM2_(r.usg)}</td>
                  </tr>
                ))}
                <tr className="tot"><td colSpan={7} className="r">TỔNG (m²)</td><td className="r">{fmtM2_(c.dtBaoGia)}</td><td className="r">{fmtM2_(c.dtSuDung)}</td></tr>
                <tr className="qsq-dgpt" title={dgTitle}>
                  <td colSpan={7} className="r">Đơn giá phần thô / m² đất <i>(giả định)</i></td>
                  <td colSpan={2} className="r" data-dgpt>{hienDg ? <><b>{money(dg)}</b> đ/m²</> : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="qsq-hint">Công thức: Diện tích = Dài × Rộng · Tổng = Diện tích × Số tầng · DT báo giá = Tổng × Hệ số. Bấm “Áp vào tờ bìa” để điền DT báo giá &amp; DT sử dụng.</p>
          <p className="qsq-hint" data-dgpt-note>Đơn giá phần thô / m² đất (giả định, chờ chủ sản phẩm xác nhận) = Chi phí mục 3.1 trên tờ bìa ÷ Diện tích khu đất (Dài × Rộng). Chỉ hiển thị: không lưu, không đưa vào bản xem trước / Excel.</p>
        </div>
      )}
    </div>
  )
}

/* Sửa 1 ô của bảng chi tiết: đúng các trường gốc mà Bóc tách ghi (tkFieldsFor_ / editProfit_ qua lineApply) */
function sua(l, k, text) {
  const n = lineApply(l, k, text)
  if (n === l) return
  const f = {}; Object.keys(n).forEach(x => { if (n[x] !== l[x]) f[x] = n[x] })
  if (Object.keys(f).length) updateLine(l.lineId, f)
}
function Cell({ l, k, stt }) {
  const cls = TK_SO[k] ? 'r' : (TK_GIUA[k] ? 'c' : '')
  if (k === 'stt') return <td className="c">{stt}</td>
  if (k === 'hinhAnh') {
    const src = String(l.hinhAnh || '').split('\n')[0].trim()
    return <td className="c"><span className="qs-qt-thumb"><ProductThumb product={l} size={54} src={src ? mediaUrl(src) : ''} /></span></td>
  }
  const text = lineText(l, k, stt)
  if (!tkSheetSua_(k)) return <td className={cls}>{text}</td>
  if (k === 'ten' || k === 'moTa' || k === 'kichThuoc') {
    return <td><ChangeInput as="textarea" rows={1} value={text} onCommit={v => sua(l, k, k === 'ten' ? v.replace(/\s*\n\s*/g, ' ') : v)} /></td>
  }
  return <td className={cls}><ChangeInput className={cls === 'r' ? 'r' : ''} value={text} placeholder={k === 'khuVuc' ? 'Phòng…' : undefined} onCommit={v => sua(l, k, v)} /></td>
}

/* Khối "Bảng báo giá chi tiết" (bgDetailHTML 765-793 + card4 852-861): cùng dòng với Bóc tách (lọc theo hạng mục chọn in),
   nhóm theo tầng, ô sửa ghi thẳng vào dòng; chip cột dùng chung với Bóc tách.
   Props: ctx (lib/quote.js), tk = {cols, order} của Bóc tách, nganh (lọc cột theo ngành), onExport(fmt) */
export default function DetailEditor({ ctx, tk, nganh, onExport, exporting }) {
  const cols = visCols(tk.order, tk.cols, nganh)
  const lines = bgLines_(ctx)
  const groups = {}; const order = []
  lines.forEach(l => { const g = (l.tang || '').trim() || 'CHƯA PHÂN TẦNG'; if (!groups[g]) { groups[g] = []; order.push(g) } groups[g].push(l) })
  const q = bgTong_(computeQuoteLocal(false, ctx).subtotal, ctx.bgCfg, ctx.cur && ctx.cur.vat, bgVatParts_(ctx))
  const n = cols.length + 1
  return (
    <div className="qs-card qs-qt-card">
      <div className="qs-qt-card-head">
        <span className="qs-qt-card-icon"><Icon name="listLines" size={15} /></span>
        <b>Bảng báo giá chi tiết</b><span className="qs-qt-sub">Đồng bộ Bóc tách</span>
        <span style={{ flex: 1 }} />
        <NodePicker ctx={ctx} small />
        <button type="button" className="qs-qt-btn green" disabled={exporting} onClick={() => onExport('xlsx')}><Icon name="download" size={13} />{exporting ? 'Đang xuất…' : 'Excel'}</button>
        <button type="button" className="qs-qt-btn red" onClick={() => onExport('pdf')}><Icon name="download" size={13} />PDF / In</button>
      </div>
      <div className="qs-qt-card-body">
        <div className="qs-qt-colchips dark">
          {COLS.map(c => <button type="button" key={c[0]} className={tk.cols[c[0]] ? 'on' : ''} onClick={() => toggleCol(c[0])}>{c[1]}</button>)}
        </div>
        <div className="qs-qt-detail-wrap">
          <table className="qs-qt-ed-table detail" style={{ width: cols.reduce((a, c) => a + colW(c[0], tk.w), 0) + 44 }}>
            <colgroup>{cols.map(c => <col key={c[0]} style={{ width: colW(c[0], tk.w) }} />)}<col style={{ width: 44 }} /></colgroup>
            <thead><tr>{cols.map(c => <th key={c[0]} className={TK_SO[c[0]] ? 'r' : (TK_GIUA[c[0]] ? 'c' : '')}>{c[1]}</th>)}<th /></tr></thead>
            <tbody>
              {order.map((g, gi) => {
                const gsum = groups[g].reduce((s, l) => s + ttBan_(l), 0)
                return [
                  <tr key={'g' + gi} className="group"><td colSpan={n}>{(ROMAN_[gi] || (gi + 1)) + '. ' + g}<span className="gs">Tổng tầng: <b>{money(gsum)} đ</b></span></td></tr>,
                  ...groups[g].map((l, ri) => (
                    <tr key={l.lineId}>
                      {cols.map(c => <Cell key={c[0]} l={l} k={c[0]} stt={(gi + 1) + '.' + (ri + 1)} />)}
                      <td className="c"><button type="button" className="qs-qt-del" title="Xoá dòng" onClick={() => deleteLines([l.lineId], { confirm: false })}><Icon name="x" size={12} /></button></td>
                    </tr>
                  )),
                ]
              })}
              {!lines.length && <tr><td colSpan={n} className="empty">Chưa có hạng mục.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="qs-qt-ed-sum">
          <div><span>Tạm tính</span><b>{money(q.sub)} đ</b></div>
          {q.ck ? <div><span>Chiết khấu</span><b>−{money(q.ck)} đ</b></div> : null}
          <div><span>VAT {q.vatNhan}</span><b>{money(q.vat)} đ</b></div>
          <div className="grand"><span>Tổng cộng</span><b>{money(q.total)} đ</b></div>
        </div>
      </div>
    </div>
  )
}
