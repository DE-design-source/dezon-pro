import { DOCUMENTS, EXPIRING_CONTRACTS } from '../../../data/chamCongData'
import Kpi from './Kpi'

const DOC_COLS = { gridTemplateColumns: '1fr 2fr 1.1fr 1.2fr 1fr 1fr' }
const CONTRACT_COLS = { gridTemplateColumns: '1.6fr 1.4fr 1.2fr 1fr 1fr' }
const tint = c => ({ background: `var(--${c}-tint)`, color: `var(--${c})` })

export default function HanhChinhTab({ canCreate = true }) {
  return (
    <>
      <div className="cc-kpi-grid">
        <Kpi label="Công văn tháng này" value="7" sub="Đã ban hành/tiếp nhận" />
        <Kpi label="Hợp đồng sắp hết hạn" value="2" color="var(--finance)" sub="Trong 30 ngày tới" />
        <Kpi label="Đơn từ chờ duyệt" value="3" color="var(--danger)" sub="Nghỉ phép, công tác" />
        <Kpi label="Tài sản đang cấp phát" value="24" color="var(--success)" sub="Laptop, xe, thiết bị văn phòng" />
      </div>

      <div className="cc-row-between">
        <span className="cc-section-title">Công văn — Văn bản nội bộ gần đây</span>
        {canCreate && <button className="cc-btn-add">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Thêm văn bản
        </button>}
      </div>

      <div className="cc-card cc-table">
        <div className="cc-grid cc-grid-head" style={DOC_COLS}>
          <span>Số hiệu</span><span>Tiêu đề</span><span>Loại văn bản</span><span>Người ban hành</span><span>Ngày ban hành</span><span>Trạng thái</span>
        </div>
        {DOCUMENTS.map(d => (
          <div key={d.code} className="cc-grid cc-grid-row" style={DOC_COLS}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{d.code}</span>
            <span style={{ fontSize: 12.5 }}>{d.title}</span>
            <span className="cc-pill" style={tint(d.typeColor)}>{d.type}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{d.issuer}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{d.date}</span>
            <span className="cc-pill" style={tint(d.statusColor)}>{d.status}</span>
          </div>
        ))}
      </div>

      <div className="cc-row-between">
        <span className="cc-section-title">Hợp đồng lao động sắp hết hạn</span>
      </div>

      <div className="cc-card cc-table">
        <div className="cc-grid cc-grid-head" style={CONTRACT_COLS}>
          <span>Họ tên</span><span>Chức vụ</span><span>Loại hợp đồng</span><span>Ngày hết hạn</span><span>Trạng thái</span>
        </div>
        {EXPIRING_CONTRACTS.map(c => (
          <div key={c.name} className="cc-grid cc-grid-row" style={CONTRACT_COLS}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{c.position}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{c.type}</span>
            <span className="mono" style={{ fontSize: 11.5, color: `var(--${c.color})`, fontWeight: 600 }}>{c.date}</span>
            <span className="cc-pill" style={tint(c.color)}>{c.status}</span>
          </div>
        ))}
      </div>
    </>
  )
}
