import { useState } from 'react'
import { INITIAL_PRODUCTS, INITIAL_MATERIALS_CATALOG } from '../../../data/bimData'
import { Icon, SectionHead, SearchInput, StatusBadge } from './shared'
import { useAccess } from '../../../services/accessService'

const LOCK_ICON = '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
const GLOBE_ICON = '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'

function CatalogKpis({ total, active }) {
  return (
    <div className="bim-card" style={{ padding: '16px 20px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
      <div><div className="bim-kpi-num" style={{ fontSize: 20 }}>{total}</div><div className="bim-kpi-label">{active.totalLabel}</div></div>
      <div><div className="bim-kpi-num" style={{ fontSize: 20, color: 'var(--success)' }}>{active.count}</div><div className="bim-kpi-label">Đang sử dụng</div></div>
      <div><div className="bim-kpi-num" style={{ fontSize: 20 }}>Tổ chức</div><div className="bim-kpi-label">Phạm vi quản lý</div></div>
    </div>
  )
}

function AddButton({ label, onClick }) {
  const { can } = useAccess()
  if (!can('bim', 'main', 'create')) return null
  return <button className="bim-btn-dark" onClick={onClick}><Icon name="plus" stroke="#fff" sw={2.6} />{label}</button>
}

const nameCell = item => (
  <td className="bim-td">
    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{item.name}</div>
    <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{item.code}</div>
  </td>
)
const activeCell = <td className="bim-td"><StatusBadge color="success">● Đang sử dụng</StatusBadge></td>

export function ProductsTab() {
  const [items, setItems] = useState(INITIAL_PRODUCTS)
  const [query, setQuery] = useState('')
  const q = query.toLowerCase()
  const rows = items.filter(p => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.ifc.toLowerCase().includes(q))

  function add() {
    const name = prompt('Tên sản phẩm mới:')
    if (!name) return
    setItems(prev => [{ code: 'PRD-NEW-' + (prev.length + 1), name, ifc: 'IfcBuildingElementProxy', method: 'Đếm đối tượng', unit: 'cái', assigned: 0, scope: 'internal', status: 'active' }, ...prev])
  }

  return (
    <>
      <SectionHead eyebrow="Danh mục tổ chức" title="Sản phẩm" desc="Danh mục Product dùng nhất quán khi gán dữ liệu cho objects trong SketchUp — dùng chung cho mọi dự án.">
        <AddButton label="Thêm sản phẩm" onClick={add} />
      </SectionHead>
      <CatalogKpis total={items.length} active={{ totalLabel: 'Tổng sản phẩm', count: items.filter(p => p.status === 'active').length }} />
      <SearchInput value={query} onChange={setQuery} placeholder="Tìm tên, mã, IFC class hoặc vật liệu..." />
      <div className="bim-card" style={{ padding: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Sản phẩm', 'Phân loại IFC', 'Cách đo bóc', 'Đơn vị', 'Đã gán', 'Phạm vi', 'Trạng thái'].map(h => <th key={h} className="bim-th">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.code}>
                {nameCell(p)}
                <td className="bim-td"><span className="bim-ifc-badge">{p.ifc}</span></td>
                <td className="bim-td" style={{ color: 'var(--text-muted)' }}>{p.method}</td>
                <td className="bim-td">{p.unit}</td>
                <td className="bim-td" style={{ fontWeight: 600 }}>{p.assigned} objects</td>
                <td className="bim-td">
                  <span className="bim-scope-pill">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" dangerouslySetInnerHTML={{ __html: p.scope === 'internal' ? LOCK_ICON : GLOBE_ICON }} />
                    {p.scope === 'internal' ? 'Nội bộ' : 'Công khai'}
                  </span>
                </td>
                {activeCell}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function MaterialsCatalogTab() {
  const [items, setItems] = useState(INITIAL_MATERIALS_CATALOG)
  const [query, setQuery] = useState('')
  const q = query.toLowerCase()
  const rows = items.filter(m => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))

  function add() {
    const name = prompt('Tên vật liệu mới:')
    if (!name) return
    setItems(prev => [{ code: 'MAT-NEW-' + (prev.length + 1), name, category: 'Chưa phân loại', desc: '—', thickness: '—' }, ...prev])
  }

  return (
    <>
      <SectionHead eyebrow="Danh mục tổ chức" title="Vật liệu" desc="Quản lý thông số và tiêu chuẩn vật liệu của tổ chức — dùng để liên kết ở tab Material của từng model.">
        <AddButton label="Thêm vật liệu" onClick={add} />
      </SectionHead>
      <CatalogKpis total={items.length} active={{ totalLabel: 'Tổng vật liệu', count: items.length }} />
      <SearchInput value={query} onChange={setQuery} placeholder="Tìm theo tên, mã hoặc mô tả..." />
      <div className="bim-card" style={{ padding: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Vật liệu', 'Phân loại', 'Mô tả', 'Chiều dày', 'Trạng thái'].map(h => <th key={h} className="bim-th">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.code}>
                {nameCell(m)}
                <td className="bim-td" style={{ color: 'var(--text-muted)' }}>{m.category}</td>
                <td className="bim-td">{m.desc}</td>
                <td className="bim-td">{m.thickness}</td>
                {activeCell}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
