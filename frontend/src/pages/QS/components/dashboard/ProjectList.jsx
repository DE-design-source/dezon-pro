import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { listLeads } from '../../../KinhDoanh/api'
import { useQs } from '../../state/QsData'
import { dashSearch_ } from '../../lib/dashModel.js'
import { openProjDlg } from '../project/projectActions'
import { usePhuTrach, setPhuTrach, ptRoles_ } from './ptStore'
import { statCache, loadStats_ } from '../project/projectStats'
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
/* Lọc nguồn dự án (qs_dash_src): '' tất cả · 'kd' từ Kinh doanh (có khách hàng ở trang Kinh doanh gắn mã dự án, sales_leads.project_code)
   · 'qs' phòng QS tự tạo (không khách hàng nào gắn) */
const SRC_LS = 'qs_dash_src'
const SRCS = [['', 'Tất cả'], ['kd', 'Từ kinh doanh'], ['qs', 'Từ phòng QS']]
function readSrc_() {
  try { const v = localStorage.getItem(SRC_LS); return SRCS.some(x => x[0] === v) ? v : '' } catch (e) { return '' }
}
/* Lọc thời gian theo ngày tạo bản nháp mới nhất của dự án (cột Ngày tạo); nhớ ở qs_dash_time = {k, from, to} */
const TIME_LS = 'qs_dash_time'
const TIMES = [['', 'Mọi thời gian'], ['7d', '7 ngày qua'], ['30d', '30 ngày qua'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tuỳ chọn…']]
/* Nút lọc nhanh cạnh ô chọn: bấm = lọc, bấm lại nút đang bật = bỏ lọc */
const QUICK_T = [['week', 'Tuần'], ['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']]
function readTime_() {
  try { const v = JSON.parse(localStorage.getItem(TIME_LS) || '{}') || {}; return TIMES.some(x => x[0] === v.k) ? { k: v.k, from: v.from || '', to: v.to || '' } : { k: '', from: '', to: '' } } catch (e) { return { k: '', from: '', to: '' } }
}
/* [từ, đến) theo mốc giờ máy; null = không giới hạn */
function timeRange_(t) {
  const now = new Date()
  const d0 = (y, m, d) => new Date(y, m, d).getTime()
  const Y = now.getFullYear(), M = now.getMonth()
  if (t.k === '7d') return [now.getTime() - 7 * 864e5, null]
  if (t.k === '30d') return [now.getTime() - 30 * 864e5, null]
  if (t.k === 'week') return [d0(Y, M, now.getDate() - ((now.getDay() + 6) % 7)), null]   // từ thứ Hai
  if (t.k === 'month') return [d0(Y, M, 1), null]
  if (t.k === 'quarter') return [d0(Y, M - (M % 3), 1), null]
  if (t.k === 'year') return [d0(Y, 0, 1), null]
  if (t.k === 'custom') {
    const p = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? d0(+m[1], +m[2] - 1, +m[3]) : null }
    const to = p(t.to)
    return [p(t.from), to == null ? null : to + 864e5]
  }
  return [null, null]
}
const fmtD_ = s => (s ? s.split('-').reverse().join('/') : '…')

/* Danh sách dự án (port dashProjSection_ / dashProjCards_, PUB/dash.js:196-212, 249): tìm theo tên dự án, khách hàng, SĐT.
   Props: groups = projectGroups(projects) (mỗi nhóm = 1 dự án, nhiều bản nháp), curMa = mã bản nháp đang mở,
   onCreate = nút "Tạo dự án" (mở trang nhập đủ trường như "Nhập dự án"; không truyền thì dùng hộp thoại ngắn),
   onFilter({groups, label}) = danh sách dự án sau bộ lọc (nguồn, thời gian, ô tìm) + nhãn bộ lọc ('' = không lọc). */
export default function ProjectList({ groups, curMa, onCreate, onFilter }) {
  const [query, setQuery] = useState('')
  const [view, setViewSt] = useState(readView_)
  const setView = v => { setViewSt(v); saveLs_(VIEW_LS, v) }
  const [cols, setCols] = useState(readCols_)
  const resizeCol = (k, px) => setCols(c => { const n = { ...c, [k]: px }; saveLs_(COLS_LS, JSON.stringify(n)); return n })
  const [density, setDensitySt] = useState(readDensity_)
  const setDensity = v => { setDensitySt(v); saveLs_(DENS_LS, v) }
  const q = query.toLowerCase().trim()
  // Mã dự án đã gắn với khách hàng Kinh doanh; null = chưa tải được (ẩn bộ lọc nguồn)
  const [kdMa, setKdMa] = useState(null)
  /* Nhân sự phụ trách từng dự án (ptStore, dùng chung với hộp Thông tin dự án): quản trị giao / bỏ ở cột Phụ trách, người khác chỉ xem */
  const { map: ptMap, users: ptUsers, canEdit: canEditPt } = usePhuTrach()
  useEffect(() => {
    let off = false
    listLeads().then(ls => { if (!off) setKdMa(new Set(ls.map(l => l.maDA).filter(Boolean))) }, () => { if (!off) setKdMa(null) })
    return () => { off = true }
  }, [groups.length])
  const [src, setSrcSt] = useState(readSrc_)
  const setSrc = v => { setSrcSt(v); saveLs_(SRC_LS, v) }
  const isKd = g => g.drafts.some(d => kdMa.has(d.maDA))
  const [time, setTimeSt] = useState(readTime_)
  const setTime = t => { setTimeSt(t); saveLs_(TIME_LS, JSON.stringify(t)) }
  const [timeOpen, setTimeOpen] = useState(false)
  const timeRef = useRef(null)
  useEffect(() => {
    if (!timeOpen) return undefined
    const down = e => { if (timeRef.current && !timeRef.current.contains(e.target)) setTimeOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [timeOpen])
  const [tFrom, tTo] = timeRange_(time)
  const inTime = g => {
    if (tFrom == null && tTo == null) return true
    const t = new Date(g.drafts[g.drafts.length - 1].ngayTao).getTime()
    return !isNaN(t) && (tFrom == null || t >= tFrom) && (tTo == null || t < tTo)
  }
  const timeLb = time.k === 'custom' ? fmtD_(time.from) + ' – ' + fmtD_(time.to) : (TIMES.find(x => x[0] === time.k) || TIMES[0])[1]
  const found = dashSearch_(groups, query).filter(inTime)
  const nKd = kdMa ? found.filter(isKd).length : 0
  const shown = kdMa && src ? found.filter(g => (src === 'kd') === isKd(g)) : found
  const srcCnt = { '': found.length, kd: nKd, qs: found.length - nKd }
  /* Báo danh sách đang lọc lên Bảng điều khiển (cột trái cộng số theo bộ lọc); chỉ báo khi tập dự án / nhãn lọc đổi */
  const fltLb = [kdMa && src ? (SRCS.find(x => x[0] === src) || SRCS[0])[1] : '', time.k ? timeLb : '', q ? '"' + query.trim() + '"' : ''].filter(Boolean).join(' · ')
  const shownKey = shown.map(g => g.drafts.map(d => d.maDA).join(',')).join('|') + '#' + fltLb
  const shownRef = useRef(shown)
  shownRef.current = shown
  useEffect(() => { if (onFilter) onFilter({ groups: shownRef.current, label: fltLb }) }, [shownKey])   // eslint-disable-line react-hooks/exhaustive-deps

  /* Số dòng + giá trị + nhà cung cấp của bản đang dùng (đọc thẳng dòng đang mở) hoặc bản mới nhất (projectStats, đếm 1 lần / phiên)
     - chỉ Dạng thanh cần */
  const { lines } = useQs()
  const [, setStatVer] = useState(0)   // tăng mỗi khi đếm xong 1 dự án -> vẽ lại
  useEffect(() => {
    if (view !== 'bar') return undefined
    let alive = true
    loadStats_(groups.map(g => g.drafts[g.drafts.length - 1]), () => { if (alive) setStatVer(v => v + 1) })
    return () => { alive = false }
  }, [groups, view])
  const curSt = useMemo(() => {
    const ls = lines || []
    const m = {}
    ls.forEach(l => { const k = String(l.thuongHieu || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
    return { n: ls.length, tong: ls.reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0), ncc: Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'vi')) }
  }, [lines])
  const statOf = g => (g.drafts.some(d => d.maDA === curMa) ? curSt : (statCache[g.drafts[g.drafts.length - 1].maDA] || null))

  let list = null
  if (view === 'bar') {
    const vars = {}
    BAR_COLS.forEach(c => { vars['--w-' + c.key] = cols[c.key] + 'px' })
    list = (
      <div className={`qs-dash-rows d-${density}`} style={vars}>
        <BarHeader widths={cols} onResize={resizeCol} />
        {shown.map(g => <ProjectRow key={g.drafts[0].maDA} group={g} curMa={curMa} kd={kdMa ? isKd(g) : null} st={statOf(g)}
          pt={ptRoles_(ptMap[g.drafts[0].maDA]).ql} users={ptUsers} canEditPt={canEditPt} onPt={list => setPhuTrach(g.drafts[0].maDA, list)} />)}
      </div>
    )
  }
  else if (view === 'icon') list = <div className="qs-dash-tiles">{shown.map(g => <ProjectTile key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>
  else list = <div className="qs-dash-project-grid">{shown.map(g => <ProjectCard key={g.drafts[0].maDA} group={g} curMa={curMa} />)}</div>

  return (
    <div className="qs-dash-list">
      <div className="qs-dash-list-head">
        <Icon name="home" size={18} className="qs-dash-accent" />
        <h3 className="qs-dash-title">Danh sách dự án</h3>
        <span className="qs-dash-count">{groups.length}</span>
        {kdMa && (
          <div className="qs-dash-views qs-dash-src" role="radiogroup" aria-label="Nguồn dự án">
            {SRCS.map(([k, lb]) => (
              <button key={k || 'all'} type="button" role="radio" aria-checked={src === k}
                title={k === 'kd' ? 'Dự án có khách hàng ở trang Kinh doanh gắn vào' : k === 'qs' ? 'Dự án phòng QS tự tạo, chưa gắn khách hàng Kinh doanh' : 'Mọi dự án'}
                className={`qs-dash-view${src === k ? ' on' : ''}`} onClick={() => setSrc(k)}>{lb}<small>{srcCnt[k]}</small></button>
            ))}
          </div>
        )}
        {/* bộ lọc thời gian = 1 module: chọn kỳ (menu) + lọc nhanh Tuần / Tháng / Quý / Năm, cùng cỡ chữ */}
        <div className="qs-dash-tmod">
        <div className="qs-dash-time" ref={timeRef}>
          <button type="button" className={'qs-dash-time-btn' + (time.k ? ' on' : '')} aria-haspopup="listbox" aria-expanded={timeOpen}
            title="Lọc theo ngày tạo (bản nháp mới nhất)" onClick={() => setTimeOpen(o => !o)}>
            <Icon name="calendar" size={14} /><span>{timeLb}</span><Icon name="chevronDown" size={13} />
          </button>
          {time.k && <button type="button" className="qs-dash-time-x" title="Bỏ lọc thời gian" onClick={() => setTime({ k: '', from: '', to: '' })}><Icon name="x" size={12} /></button>}
          {timeOpen && (
            <div className="qs-dash-time-pop" role="listbox">
              {TIMES.map(([k, lb]) => (
                <button key={k || 'all'} type="button" role="option" aria-selected={time.k === k} className={time.k === k ? 'on' : ''}
                  onClick={() => { setTime({ ...time, k }); if (k !== 'custom') setTimeOpen(false) }}>
                  {lb}{time.k === k && <Icon name="check" size={13} />}
                </button>
              ))}
              {time.k === 'custom' && (
                <div className="qs-dash-time-rg">
                  <label>Từ<input type="date" value={time.from} max={time.to || undefined} onChange={e => setTime({ ...time, from: e.target.value })} /></label>
                  <label>Đến<input type="date" value={time.to} min={time.from || undefined} onChange={e => setTime({ ...time, to: e.target.value })} /></label>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="qs-dash-views qs-dash-dens qs-dash-tquick" role="radiogroup" aria-label="Lọc nhanh theo thời gian">
          {QUICK_T.map(([k, lb]) => (
            <button key={k} type="button" role="radio" aria-checked={time.k === k} title={'Dự án tạo trong ' + lb.toLowerCase() + ' này' + (time.k === k ? ' - bấm lại để bỏ lọc' : '')}
              className={`qs-dash-view${time.k === k ? ' on' : ''}`} onClick={() => setTime({ ...time, k: time.k === k ? '' : k })}>{lb}</button>
          ))}
        </div>
        </div>
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
        <button type="button" className="qs-dash-create" onClick={() => (onCreate ? onCreate() : openProjDlg('create'))}><Icon name="plus" size={14} />Tạo dự án</button>
      </div>
      <div className="qs-dash-list-body">
        {shown.length
          ? list
          : (
            <div className="qs-dash-empty">
              {q ? `Không tìm thấy dự án khớp "${q}"${time.k ? ' trong ' + timeLb.toLowerCase() : ''}.`
                : time.k && groups.length ? `Không có dự án tạo trong ${timeLb.toLowerCase()}.`
                : kdMa && src && groups.length ? `Không có dự án ${src === 'kd' ? 'từ Kinh doanh' : 'từ phòng QS'}.`
                : <>Chưa có dự án. Bấm <b>Tạo dự án</b> để bắt đầu.</>}
            </div>
          )}
      </div>
    </div>
  )
}
