import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MATERIAL_FILTERS, materialStatus } from '../../../data/sanXuatData'

const STATUS_LABEL = { low: ['Sắp hết', 'var(--danger)', 'var(--danger-tint)'], ok: ['Đủ dùng', 'var(--success)', 'var(--success-tint)'] }

export default function MaterialsTab({ materials, onStock }) {
  const [filter, setFilter] = useState('all')
  const lowItems = materials.filter(m => materialStatus(m) === 'low')
  const rows = materials.filter(m => filter === 'all' || m.category === filter)

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div className="sx-card sx-kpi-card">
          <div className="sx-kpi-label">Tổng giá trị tồn kho</div>
          <div className="sx-kpi-num">318tr</div>
          <div className="sx-kpi-sub">8 nhóm nguyên vật liệu</div>
        </div>
        <div className="sx-card sx-kpi-card">
          <div className="sx-kpi-label">Mặt hàng sắp hết</div>
          <div className="sx-kpi-num" style={{ color: 'var(--danger)' }}>{lowItems.length}</div>
          <div className="sx-badge" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}>{lowItems.length ? lowItems.map(m => m.name).join(', ') : 'Không có'}</div>
        </div>
        <div className="sx-card sx-kpi-card">
          <div className="sx-kpi-label">Đơn nhập hàng đang chờ</div>
          <div className="sx-kpi-num">1</div>
          <div className="sx-kpi-sub"><Link to="/mua-hang" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>Xem tại Mua hàng ›</Link></div>
        </div>
      </div>
      <div className="sx-card" style={{ padding: '6px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 4px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {MATERIAL_FILTERS.map(f => (
              <button key={f.key} className={`sx-filter-chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          {onStock && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="sx-add-btn" style={{ background: 'var(--success)' }} onClick={() => onStock('in')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
              Nhập kho
            </button>
            <button className="sx-add-btn" style={{ background: 'var(--danger)' }} onClick={() => onStock('out')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="5 12 12 19 19 12" /></svg>
              Xuất kho
            </button>
          </div>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="sx-table">
            <thead>
              <tr><th>Vật tư</th><th>Loại</th><th>Tồn kho</th><th>Định mức tối thiểu</th><th>Nhà cung cấp</th><th>Trạng thái</th></tr>
            </thead>
            <tbody>
              {rows.map(m => {
                const status = materialStatus(m)
                const s = STATUS_LABEL[status]
                return (
                  <tr key={m.name}>
                    <td style={{ fontWeight: 600 }}>{m.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{m.type}</td>
                    <td className="mono" style={status === 'low' ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{m.qty} {m.unit}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{m.minQty} {m.unit}</td>
                    <td>{m.supplier}</td>
                    <td><span className="sx-pill" style={{ background: s[2], color: s[1] }}>{s[0]}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
