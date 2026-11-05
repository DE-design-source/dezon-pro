import { useEffect, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'
import { cpOvCharts_ } from '../../lib/totals.js'

/* Ô "Biên tối thiểu" (%): dòng có biên lợi nhuận (trên giá bán) thấp hơn mức này bị tô vàng + đếm vào chip "Biên < x%".
   Nằm trên hàng chip lọc của khối công cụ Chi phí (dời từ ô Cảnh báo cũ). onMinBien(chuỗi) -> số đã lưu, false khi bị từ chối */
export function MinBienInput({ minBien, onMinBien }) {
  const [minDraft, setMinDraft] = useState(String(minBien))
  useEffect(() => { setMinDraft(String(minBien)) }, [minBien])
  // Bản gốc vẽ lại ô sau khi đổi: bị từ chối thì về số đang lưu, nhận thì hiện đúng số đã lưu (VD "12.0" -> 12)
  const commitMin = () => {
    if (minDraft === String(minBien)) return
    const r = onMinBien(minDraft)
    setMinDraft(String(r === false || r == null ? minBien : r))
  }
  return (
    <label className="qs-ct-min" title="Dòng có biên lợi nhuận (trên giá bán) thấp hơn mức này bị tô vàng">
      Biên tối thiểu
      <input type="number" min="0" max="99" step="any" value={minDraft} onChange={e => setMinDraft(e.target.value)}
        onBlur={commitMin} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }} />
      %
    </label>
  )
}

/* Khối "Tổng quan chi phí" (port cpOverview_ PUB/chiphi.js:423-463): còn biểu đồ theo hạng mục (8 nhóm, bấm để lọc hạng mục).
   Đã bỏ: 5 ô số tiền (trùng dải số trên băng dự án), ô Cảnh báo (chip cảnh báo = chip lọc của khối công cụ, ô Biên tối thiểu dời
   xuống đó - MinBienInput), biểu đồ tỷ trọng giá vốn theo nhà cung cấp.
   Props: T (cpTong_), scope (dòng của hạng mục), minBien, onHm(code), onCollapse() (bật / tắt thu gọn), collapsed (chỉ còn hàng tiêu đề + nút mở) */
export default function CostOverview({ T, scope, minBien, onHm, onCollapse, collapsed }) {
  const ch = scope.length ? cpOvCharts_(scope, T, minBien) : null
  const head = (
      <div className="qs-ct-overview-head">
        <span className="qs-ct-title">Tổng quan chi phí</span>
        {/* nút tròn chỉ biểu tượng (cùng dáng nút thu gọn dải tổng tiền): thu gọn / mở lại thẻ */}
        <button type="button" className="qs-bd-round-btn accent qs-ct-fold" title={collapsed ? "Mở Tổng quan chi phí" : "Thu gọn Tổng quan chi phí"} aria-label={collapsed ? "Mở" : "Thu gọn"}
          aria-expanded={!collapsed} onClick={onCollapse}><Icon name={collapsed ? "chevronDown" : "chevronUp"} size={14} /></button>
      </div>
  )
  if (collapsed) return <div className="qs-card qs-ct-overview folded">{head}</div>
  if (!ch) return null   // chưa có dòng: không còn gì để vẽ
  // mở: bỏ hàng tiêu đề, chỉ còn nút thu gọn tròn nổi ở góc phải trên của thẻ
  return (
    <div className="qs-card qs-ct-overview open">
      <button type="button" className="qs-bd-round-btn accent qs-ct-fold" title="Thu gọn Tổng quan chi phí" aria-label="Thu gọn" aria-expanded="true"
        onClick={onCollapse}><Icon name="chevronUp" size={14} /></button>

      {ch && (
        <div className="qs-ct-charts">
          <div className="qs-ct-chart">
            <div className="qs-ct-chart-head">
              <b>Theo hạng mục</b>
              <span><i className="sale" />giá bán</span><span><i className="cost" />giá vốn · % = biên</span>
            </div>
            {ch.bars.map(b => (
              <div key={b.g.k} className="qs-ct-cat qs-cp-click" onClick={() => onHm(b.g.k === '__k' ? '' : b.g.k)}
                title={`${b.g.ten} — vốn ${money(b.g.t.von)} · bán ${money(b.g.t.ban)} · bấm để xem riêng`}>
                <span className="qs-ct-cat-name">{b.g.ten}</span>
                <div className="qs-ct-cat-bar">
                  <div className="sale" style={{ width: `${b.wBan.toFixed(1)}%` }} />
                  <div className="cost" style={{ width: `${b.wVon.toFixed(1)}%` }} />
                </div>
                <span className="qs-ct-cat-value">{money(b.g.t.ban)}</span>
                <span className={`qs-ct-cat-pct qs-cp-pct${b.cls ? ' ' + b.cls : ''}`}>{b.b.toFixed(1)}%</span>
              </div>
            ))}
            {ch.moreHm > 0 && <div className="qs-ct-empty">+ {ch.moreHm} hạng mục khác</div>}
          </div>
          {/* biểu đồ "Tỷ trọng giá vốn theo nhà cung cấp" đã bỏ */}
        </div>
      )}
    </div>
  )
}
