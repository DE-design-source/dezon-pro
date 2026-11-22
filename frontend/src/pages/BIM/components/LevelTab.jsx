import { useState } from 'react'
import { fmtNum } from '../../../data/bimData'
import { Icon, SectionHead, StatusBadge, useFlash } from './shared'
import { useAccess } from '../../../services/accessService'

export default function LevelTab({ levels, onCreateLevel }) {
  const { can } = useAccess()
  const [overlay, setOverlay] = useState(false)
  const [detecting, detect] = useFlash(800)

  return (
    <>
      <SectionHead eyebrow="Level" title="Tầng trong model" desc="Nhận diện Level từ mặt phẳng và quản lý khoảng cao độ theo quy tắc nửa mở.">
        <button className={`bim-btn-ghost${overlay ? ' on' : ''}`} onClick={() => setOverlay(o => !o)}><Icon name="eye" />Hiện overlay</button>
      </SectionHead>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="bim-btn-dark" style={{ flex: 1 }} onClick={() => detect()}>
          {detecting ? 'Đang dò Level...' : <><Icon name="scan" size={15} stroke="#fff" />Dò Level</>}
        </button>
        {can('bim', 'main', 'create') && <button className="bim-btn-ghost" style={{ flex: 1 }} onClick={onCreateLevel}><Icon name="plus" size={15} sw={2.4} />Tạo từ selection</button>}
      </div>
      <div className="bim-card" style={{ padding: 4 }}>
        {[...levels].reverse().map(l => (
          <div key={l.code} className="bim-data-row">
            <div className={`bim-level-chip${l.status === 'selected' ? ' active' : ''}`}>{l.code}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Cao độ {fmtNum(l.elevation, 3)} m · Cao {fmtNum(l.height, 3)} m</div>
            </div>
            {l.status === 'selected'
              ? <StatusBadge color="bim">● Đang chọn</StatusBadge>
              : <StatusBadge color="success">● Đã ghi</StatusBadge>}
          </div>
        ))}
      </div>
      <div className="bim-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800 }}>
          <Icon html={'<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>'} size={16} stroke="var(--bim)" />
          Quan hệ không gian
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>8.204 objects đã có Level tự động. 14 quan hệ thủ công được khóa và luôn ưu tiên hơn tính toán tự động.</p>
        <div style={{ height: 8, borderRadius: 5, background: 'var(--surface-alt)', overflow: 'hidden' }}><div style={{ width: '98.6%', height: '100%', background: 'var(--success)' }} /></div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>98,6% objects đã xác định tầng</div>
      </div>
    </>
  )
}
