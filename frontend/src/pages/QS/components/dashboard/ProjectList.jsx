import { useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { dashSearch_, TT_DU_AN, groupStatus_, groupYear_ } from '../../lib/dashModel.js'
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
  /* Phân loại: theo trạng thái dự án (Đang báo giá / Đang thực hiện / Đã thực hiện) và theo năm tạo; danh sách chia khối theo năm.
     Lựa chọn nhớ trong máy (qs_dash_tt, qs_dash_year) */
  const [tt, setTtSt] = useState(() => { try { const v = localStorage.getItem('qs_dash_tt') || ''; return TT_DU_AN.indexOf(v) >= 0 ? v : '' } catch (e) { return '' } })
  const setTt = v => { setTtSt(v); saveLs_('qs_dash_tt', v) }
  const [year, setYearSt] = useState(() => { try { return localStorage.getItem('qs_dash_year') || '' } catch (e) { return '' } })
  const setYear = v => { setYearSt(v); saveLs_('qs_dash_year', v) }
  const q = query.toLowerCase().trim()
  const found = dashSearch_(groups, query)
  const years = [...new Set(groups.map(groupYear_))].sort((a, b) => b.localeCompare(a))
  const yr = years.indexOf(year) >= 0 ? year : ''
  const inYear = found.filter(g => !yr || groupYear_(g) === yr)
  const dem = v => inYear.filter(g => !v || groupStatus_(g) === v).length
  const shown = inYear.filter(g => !tt || groupStatus_(g) === tt)
  // khối theo năm, năm mới trước; dự án không có ngày tạo vào khối "Chưa rõ năm"
  const blocks = years.map(y => ({ y, ds: shown.filter(g => groupYear_(g) === y) })).filter(b => b.ds.length)

  const vars = {}
  if (view === 'bar') BAR_COLS.forEach(c => { vars['--w-' + c.key] = cols[c.key] + 'px' })
  const listOf = ds => (view === 'bar'
    ? <div className={`qs-dash-rows d-${density}`} style={vars}>
        <BarHeader widths={cols} onResize={resizeCol} />
        {ds.map(g => <ProjectRow key={g.drafts[0].maDA} group={g} curMa={curMa} />)}
      </div>
    : view === 'icon'
      ? <div className="qs-dash-tiles">{ds.map(g => <ProjectTile key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>
      : <div className="qs-dash-project-grid">{ds.map(g => <ProjectCard key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>)
  const list = blocks.map(b => (
    <div className="qs-dash-yblock" key={b.y || 'none'}>
      {(years.length > 1 || !b.y) && <div className="qs-dash-yhead">{b.y ? 'Năm ' + b.y : 'Chưa rõ năm'} <span>{b.ds.length} dự án</span></div>}
      {listOf(b.ds)}
    </div>
  ))

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
      <div className="qs-dash-filter">
        <div className="qs-dash-tt" role="radiogroup" aria-label="Phân loại dự án">
          {[''].concat(TT_DU_AN).map(v => (
            <button key={v || 'all'} type="button" role="radio" aria-checked={tt === v} className={'qs-dash-tt-b' + (tt === v ? ' on' : '')} onClick={() => setTt(v)}>
              {v || 'Tất cả'} <span>{dem(v)}</span></button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label className="qs-dash-year">Năm
          <select value={yr} onChange={e => setYear(e.target.value)}>
            <option value="">Tất cả năm</option>
            {years.filter(Boolean).map(y => <option key={y} value={y}>{y}</option>)}
          </select></label>
        <span className="qs-dash-tt-hint">Đổi trạng thái ở Thông tin dự án (ô Trạng thái của bản nháp)</span>
      </div>
      {shown.length
        ? list
        : (
          <div className="qs-dash-empty">
            {q ? `Không tìm thấy dự án khớp "${q}".` : (groups.length ? 'Không có dự án nào thuộc loại / năm đang chọn.' : <>Chưa có dự án. Bấm <b>Tạo dự án</b> để bắt đầu.</>)}
          </div>
        )}
    </div>
  )
}
