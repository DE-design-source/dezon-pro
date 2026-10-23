import { useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { dashSearch_ } from '../../lib/dashModel.js'
import { openProjDlg } from '../project/projectActions'
import ProjectCard from './ProjectCard'
import { ProjectRow, ProjectTile, BarHeader, BAR_COLS, BAR_DENSITY } from './ProjectViews'

/* Chế độ xem danh sách: Thẻ (mặc định, như bản gốc) / Dạng thanh / Biểu tượng; nhớ lựa chọn ở localStorage qs_dash_view */
const VIEWS = [
  { key: 'card', label: 'Thẻ', icon: 'table' },
  { key: 'bar', label: 'Dạng thanh', icon: 'listLines' },
  { key: 'icon', label: 'Biểu tượng', icon: 'grid' },
]
const VIEW_LS = 'qs_dash_view'
function readView_() {
  try { const v = localStorage.getItem(VIEW_LS); return VIEWS.some(x => x.key === v) ? v : 'card' } catch (e) { return 'card' }
}
/* Dạng thanh: độ rộng cột (qs_dash_cols, JSON {key: px}) và chiều cao dòng (qs_dash_density) */
const COLS_LS = 'qs_dash_cols'
const DENS_LS = 'qs_dash_density'
function readCols_() {
  const w = {}
  let s = {}
  try { s = JSON.parse(localStorage.getItem(COLS_LS) || '{}') || {} } catch (e) { s = {} }
  BAR_COLS.forEach(c => { const v = Number(s[c.key]); w[c.key] = v >= c.min && v <= 800 ? v : c.def })
  return w
}
function readDensity_() {
  try { const v = localStorage.getItem(DENS_LS); return BAR_DENSITY.some(x => x[0] === v) ? v : 'normal' } catch (e) { return 'normal' }
}
const saveLs_ = (k, v) => { try { localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }

/* Danh sách dự án (port dashProjSection_ / dashProjCards_, PUB/dash.js:196-212, 249): tìm theo tên dự án, khách hàng, SĐT.
   Props: groups = projectGroups(projects) (mỗi nhóm = 1 dự án, nhiều bản nháp), curMa = mã bản nháp đang mở. */
export default function ProjectList({ groups, curMa }) {
  const [query, setQuery] = useState('')
  const [view, setViewSt] = useState(readView_)
  const setView = v => { setViewSt(v); saveLs_(VIEW_LS, v) }
  const [cols, setCols] = useState(readCols_)
  const resizeCol = (k, px) => setCols(c => { const n = { ...c, [k]: px }; saveLs_(COLS_LS, JSON.stringify(n)); return n })
  const [density, setDensitySt] = useState(readDensity_)
  const setDensity = v => { setDensitySt(v); saveLs_(DENS_LS, v) }
  const q = query.toLowerCase().trim()
  const shown = dashSearch_(groups, query)

  let list = null
  if (view === 'bar') {
    const vars = {}
    BAR_COLS.forEach(c => { vars['--w-' + c.key] = cols[c.key] + 'px' })
    list = (
      <div className={`qs-dash-rows d-${density}`} style={vars}>
        <BarHeader widths={cols} onResize={resizeCol} />
        {shown.map(g => <ProjectRow key={g.drafts[0].maDA} group={g} curMa={curMa} />)}
      </div>
    )
  }
  else if (view === 'icon') list = <div className="qs-dash-tiles">{shown.map(g => <ProjectTile key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>
  else list = <div className="qs-dash-project-grid">{shown.map(g => <ProjectCard key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>

  return (
    <div className="qs-card qs-dash-list">
      <div className="qs-dash-list-head">
        <Icon name="home" size={18} className="qs-dash-accent" />
        <h3 className="qs-dash-title">Danh sách dự án</h3>
        <span className="qs-dash-count">{groups.length}</span>
        <span style={{ flex: 1 }} />
        {view === 'bar' && (
          <div className="qs-dash-views qs-dash-dens" role="radiogroup" aria-label="Chiều cao dòng" title="Chiều cao dòng">
            {BAR_DENSITY.map(([k, lb]) => (
              <button key={k} type="button" role="radio" aria-checked={density === k}
                className={`qs-dash-view${density === k ? ' on' : ''}`} onClick={() => setDensity(k)}>{lb}</button>
            ))}
          </div>
        )}
        <div className="qs-dash-views" role="radiogroup" aria-label="Chế độ xem">
          {VIEWS.map(v => (
            <button key={v.key} type="button" role="radio" aria-checked={view === v.key} aria-label={v.label} title={v.label}
              className={`qs-dash-view${view === v.key ? ' on' : ''}`} onClick={() => setView(v.key)}>
              <Icon name={v.icon} size={14} />
            </button>
          ))}
        </div>
        <div className="qs-dash-search">
          <Icon name="search" size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm dự án, khách hàng…" />
        </div>
        <button type="button" className="qs-dash-create" onClick={() => openProjDlg('create')}><Icon name="plus" size={14} />Tạo dự án</button>
      </div>
      {shown.length
        ? list
        : (
          <div className="qs-dash-empty">
            {q ? `Không tìm thấy dự án khớp "${q}".` : <>Chưa có dự án. Bấm <b>Tạo dự án</b> để bắt đầu.</>}
          </div>
        )}
    </div>
  )
}
