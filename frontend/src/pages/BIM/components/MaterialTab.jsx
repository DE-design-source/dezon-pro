import { useState } from 'react'
import { fmtNum } from '../../../data/bimData'
import { Icon, SearchInput, StatusBadge, useFlash } from './shared'
import { useAccess } from '../../../services/accessService'

export default function MaterialTab({ materials, onToggle, onAssign }) {
  const { can } = useAccess()
  const [scanning, scan] = useFlash(800)
  const [syncing, sync] = useFlash(700)
  const [catalog, setCatalog] = useState('Sơn nội thất trắng mờ')
  const [locked, setLocked] = useState(true)
  const checkedCount = materials.filter(m => m.checked).length

  function assign() {
    if (!checkedCount) { alert('Vui lòng chọn ít nhất 1 vật liệu.'); return }
    onAssign()
  }

  return (
    <>
      <div className="bim-eyebrow">Material</div>
      <div>
        <h2 className="bim-title">Vật liệu SketchUp</h2>
        <p className="bim-desc" style={{ maxWidth: 560 }}>Scan diện tích phủ thực tế và liên kết vật liệu đang dùng với danh mục Materials của tổ chức.</p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="bim-btn-dark" style={{ flex: 1 }} onClick={() => scan()}>
          {scanning ? 'Đang scan vật liệu...' : <><Icon name="scan" size={15} stroke="#fff" />Scan</>}
        </button>
        <button className="bim-btn-ghost" style={{ flex: 1 }} onClick={() => sync()}>
          {syncing ? 'Đang đồng bộ...' : <><Icon name="refresh" />Đồng bộ usage</>}
        </button>
      </div>
      <div className="bim-card" style={{ padding: 4 }}>
        {materials.map((m, i) => (
          <div key={m.name} className="bim-data-row">
            <input type="checkbox" className="bim-chk" checked={m.checked} onChange={e => onToggle(i, e.target.checked)} />
            <div className="bim-mat-swatch" style={{ background: m.swatch }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{m.code} · {fmtNum(m.area)} m²</div>
            </div>
            {m.status === 'linked'
              ? <StatusBadge color="success">● Đã liên kết</StatusBadge>
              : <StatusBadge color="finance">● Cần gán</StatusBadge>}
          </div>
        ))}
      </div>
      <div className="bim-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="bim-card-title">Liên kết danh mục</h3>
        <SearchInput value={catalog} onChange={setCatalog} placeholder="VD: Sơn nội thất trắng mờ" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" className="bim-chk" checked={locked} onChange={e => setLocked(e.target.checked)} />
          Khóa liên kết thủ công
        </label>
        {can('bim', 'main', 'edit') && (
          <button className="bim-btn-dark" onClick={assign}>
            <Icon name="link" stroke="#fff" />
            <span>Gán cho {checkedCount} vật liệu</span>
          </button>
        )}
      </div>
    </>
  )
}
