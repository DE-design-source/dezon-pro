import { useState } from 'react'
import { BIM_TABS } from '../../../data/bimData'
import { Icon } from './shared'
import OverviewTab from './OverviewTab'
import IssuesTab from './IssuesTab'
import ObjectsTab from './ObjectsTab'
import LevelTab from './LevelTab'
import RoomTab from './RoomTab'
import MaterialTab from './MaterialTab'
import FilterTab from './FilterTab'
import BoqTab from './BoqTab'
import { ProductsTab, MaterialsCatalogTab } from './CatalogTabs'
import { useAccess } from '../../../services/accessService'

/* Bảng điều khiển của một dự án đã liên kết */
export default function LinkedView({ visible, project, onBack, onUnlink, levels, onCreateLevel, materials, onToggleMaterial, onAssignMaterials }) {
  const { can } = useAccess()
  const [tab, setTab] = useState('overview')
  const panel = key => `bim-panel${tab === key ? ' active' : ''}`
  const guid = project ? project.guid : '1c53e9d0-4a2f-4e91-8b3a-6f1d2c9bce92'

  return (
    <div className="bim-view" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="bim-card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="bim-btn-ghost" title="Quay lại danh sách dự án" style={{ width: 36, height: 36, padding: 0, flex: 'none' }} onClick={onBack}>
            <Icon name="chevronLeft" size={15} sw={2.2} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="bim-eyebrow">{project ? project.name : 'File SketchUp'}</div>
            <div style={{ fontSize: 15.5, fontWeight: 700 }}>{project ? project.primaryFile : 'test level room space.skp'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{project ? `${project.projectCode} · ${project.client}` : 'SiteFlow BIM · TEST-LEVEL-ROOM-SPACE'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Model GUID</div>
            <div className="mono" style={{ fontSize: 12.5, fontWeight: 700 }} title={guid}>{guid.slice(0, 8)}...{guid.slice(-4)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Đồng bộ gần nhất</div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{project ? project.lastSync : 'Hôm nay, 10:42'}</div>
          </div>
          <span className="bim-badge success" style={{ gap: 5, display: 'inline-flex', alignItems: 'center' }}>
            <Icon name="check" size={12} sw={3} />
            Đã liên kết
          </span>
          {can('bim', 'main', 'delete') && <button className="bim-btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} title="Ngắt liên kết với file này" onClick={onUnlink}>Ngắt liên kết</button>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {BIM_TABS.map(t => (
          <button key={t.key} className={`bim-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* Các tab luôn được mount (ẩn bằng class .active) để giữ dữ liệu đã thao tác, giống bản HTML */}
      <div className={panel('overview')}><OverviewTab /></div>
      <div className={panel('issues')}><IssuesTab /></div>
      <div className={panel('objects')}><ObjectsTab /></div>
      <div className={panel('level')}><LevelTab levels={levels} onCreateLevel={onCreateLevel} /></div>
      <div className={panel('roomspace')}><RoomTab /></div>
      <div className={panel('material')}><MaterialTab materials={materials} onToggle={onToggleMaterial} onAssign={onAssignMaterials} /></div>
      <div className={panel('filter')}><FilterTab /></div>
      <div className={panel('boq')}><BoqTab /></div>
      <div className={panel('products')}><ProductsTab /></div>
      <div className={panel('materialscat')}><MaterialsCatalogTab /></div>
    </div>
  )
}
