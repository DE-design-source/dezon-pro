import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { listLeads } from '../../../KinhDoanh/api'
import { useQs } from '../../state/QsData'
import { dashSearch_, TT_DU_AN, groupStatus_, groupYear_ } from '../../lib/dashModel.js'
import { openProjDlg } from '../project/projectActions'
import { usePhuTrach, setPhuTrach, ptRoles_ } from './ptStore'
import { statCache, loadStats_ } from '../project/projectStats'
import ProjectCard from './ProjectCard'
import { ProjectRow, ProjectTile, BarHeader, BAR_COLS, BAR_DENSITY } from './ProjectViews'
import { useFitLevel } from '../common/useFitLevel'

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
const SRCS = [['', 'Tất cả', 'Tất cả'], ['kd', 'Từ kinh doanh', 'KD'], ['qs', 'Từ phòng QS', 'QS']]
function readSrc_() {
  try { const v = localStorage.getItem(SRC_LS); return SRCS.some(x => x[0] === v) ? v : '' } catch (e) { return '' }
}
/* Lọc thời gian theo ngày tạo bản nháp mới nhất của dự án (cột Ngày tạo); nhớ ở qs_dash_time = {k, from, to} */
const TIME_LS = 'qs_dash_time'
const TIMES = [['', 'Mọi thời gian'], ['7d', '7 ngày qua'], ['30d', '30 ngày qua'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tuỳ chọn…']]
/* Nút lọc nhanh cạnh ô chọn: bấm = lọc, bấm lại nút đang bật = bỏ lọc */
const QUICK_T = [['week', 'Tuần', 'T'], ['month', 'Tháng', 'Th'], ['quarter', 'Quý', 'Q'], ['year', 'Năm', 'N']]
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
  /* Phân loại: theo trạng thái dự án (Đang báo giá / Đang thực hiện / Đã thực hiện) và theo năm tạo; danh sách chia khối theo năm.
     Lựa chọn nhớ trong máy (qs_dash_tt, qs_dash_year) */
  const [tt, setTtSt] = useState(() => { try { const v = localStorage.getItem('qs_dash_tt') || ''; return TT_DU_AN.indexOf(v) >= 0 ? v : '' } catch (e) { return '' } })
  const setTt = v => { setTtSt(v); saveLs_('qs_dash_tt', v) }
  const [year, setYearSt] = useState(() => { try { return localStorage.getItem('qs_dash_year') || '' } catch (e) { return '' } })
  const setYear = v => { setYearSt(v); saveLs_('qs_dash_year', v) }
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
  /* Thanh nằm 1 hàng: hẹp (mở Dezbot, màn nhỏ) thì gọn dần theo chỗ trống thật (data-fit 1..5, dashboard.css):
     1 nút Tạo dự án chỉ còn biểu tượng · 2 nguồn rút gọn (KD / QS), bỏ số đếm · 3 ô tìm hẹp lại · 4 nút chọn kỳ chỉ còn biểu tượng ·
     5 Tuần / Tháng / Quý / Năm và Gọn / Vừa / Rộng rút còn chữ đầu (tên đủ ở chú thích khi rê chuột) */
  const headRef = useRef(null)
  useFitLevel(headRef, 5, '.qs-dash-views, .qs-dash-tmod')
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
  const shown0 = kdMa && src ? found.filter(g => (src === 'kd') === isKd(g)) : found
  const years = [...new Set(groups.map(groupYear_))].sort((a, b) => b.localeCompare(a))
  const yr = years.indexOf(year) >= 0 ? year : ''
  const inYear = shown0.filter(g => !yr || groupYear_(g) === yr)
  const dem = v => inYear.filter(g => !v || groupStatus_(g) === v).length
  const shown = inYear.filter(g => !tt || groupStatus_(g) === tt)
  // khối theo năm, năm mới trước; dự án không có ngày tạo vào khối "Chưa rõ năm"
  const blocks = years.map(y => ({ y, ds: shown.filter(g => groupYear_(g) === y) })).filter(b => b.ds.length)
  const srcCnt = { '': found.length, kd: nKd, qs: found.length - nKd }
  /* Báo danh sách đang lọc lên Bảng điều khiển (cột trái cộng số theo bộ lọc); chỉ báo khi tập dự án / nhãn lọc đổi */
  const fltLb = [kdMa && src ? (SRCS.find(x => x[0] === src) || SRCS[0])[1] : '', time.k ? timeLb : '', tt, yr ? 'Năm ' + yr : '', q ? '"' + query.trim() + '"' : ''].filter(Boolean).join(' · ')
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

  const vars = {}
  if (view === 'bar') BAR_COLS.forEach(c => { vars['--w-' + c.key] = cols[c.key] + 'px' })
  const listOf = ds => (view === 'bar'
    ? <div className={`qs-dash-rows d-${density}`} style={vars}>
        <BarHeader widths={cols} onResize={resizeCol} />
        {ds.map(g => <ProjectRow key={g.drafts[0].maDA} group={g} curMa={curMa} kd={kdMa ? isKd(g) : null} st={statOf(g)}
          pt={ptRoles_(ptMap[g.drafts[0].maDA]).ql} users={ptUsers} canEditPt={canEditPt} onPt={list => setPhuTrach(g.drafts[0].maDA, list)} />)}
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
    <div className="qs-dash-list">
      <div className="qs-dash-list-head" ref={headRef}>
        {/* không tiêu đề "Danh sách dự án" (MarkUp 2026-11-12 15:12): số dự án đã có ở nút nguồn "Tất cả";
            ô tìm đứng ngay sau bộ lọc thời gian, giãn hết chỗ trống để cả thanh nằm 1 hàng */}
        {kdMa && (
          <div className="qs-dash-views qs-dash-src" role="radiogroup" aria-label="Nguồn dự án">
            {SRCS.map(([k, lb, sh]) => (
              <button key={k || 'all'} type="button" role="radio" aria-checked={src === k}
                title={k === 'kd' ? 'Dự án có khách hàng ở trang Kinh doanh gắn vào' : k === 'qs' ? 'Dự án phòng QS tự tạo, chưa gắn khách hàng Kinh doanh' : 'Mọi dự án'}
                className={`qs-dash-view${src === k ? ' on' : ''}`} onClick={() => setSrc(k)}><span className="lf">{lb}</span><span className="ls">{sh}</span><small>{srcCnt[k]}</small></button>
            ))}
          </div>
        )}
        {/* bộ lọc thời gian = 1 module: chọn kỳ (menu) + lọc nhanh Tuần / Tháng / Quý / Năm, cùng cỡ chữ */}
        <div className="qs-dash-tmod">
        <div className="qs-dash-time" ref={timeRef}>
          <button type="button" className={'qs-dash-time-btn' + (time.k ? ' on' : '')} aria-haspopup="listbox" aria-expanded={timeOpen}
            title={"Lọc theo ngày tạo (bản nháp mới nhất): " + timeLb} onClick={() => setTimeOpen(o => !o)}>
            <Icon name="calendar" size={14} /><span className="lf">{timeLb}</span><Icon name="chevronDown" size={13} />
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
          {QUICK_T.map(([k, lb, sh]) => (
            <button key={k} type="button" role="radio" aria-checked={time.k === k} title={'Dự án tạo trong ' + lb.toLowerCase() + ' này' + (time.k === k ? ' - bấm lại để bỏ lọc' : '')}
              className={`qs-dash-view${time.k === k ? ' on' : ''}`} onClick={() => setTime({ ...time, k: time.k === k ? '' : k })}><span className="lf">{lb}</span><span className="ls">{sh}</span></button>
          ))}
        </div>
        </div>
        <div className="qs-dash-search">
          <Icon name="search" size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm dự án, khách hàng…" />
        </div>
        {view === 'bar' && (
          <div className="qs-dash-views qs-dash-dens" role="radiogroup" aria-label="Chiều cao dòng" title="Chiều cao dòng">
            {BAR_DENSITY.map(([k, lb]) => (
              <button key={k} type="button" role="radio" aria-checked={density === k}
                className={`qs-dash-view${density === k ? ' on' : ''}`} title={lb} onClick={() => setDensity(k)}><span className="lf">{lb}</span><span className="ls">{lb.charAt(0)}</span></button>
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
        <button type="button" className="qs-dash-create" title="Tạo dự án" aria-label="Tạo dự án" onClick={() => (onCreate ? onCreate() : openProjDlg('create'))}><Icon name="plus" size={14} /><span className="lf">Tạo dự án</span></button>
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
      <div className="qs-dash-list-body">
        {shown.length
          ? list
          : (
            <div className="qs-dash-empty">
              {q ? `Không tìm thấy dự án khớp "${q}"${time.k ? ' trong ' + timeLb.toLowerCase() : ''}.`
                : time.k && groups.length ? `Không có dự án tạo trong ${timeLb.toLowerCase()}.`
                : kdMa && src && groups.length ? `Không có dự án ${src === 'kd' ? 'từ Kinh doanh' : 'từ phòng QS'}.`
                : (tt || yr) && groups.length ? 'Không có dự án nào thuộc loại / năm đang chọn.'
                : <>Chưa có dự án. Bấm <b>Tạo dự án</b> để bắt đầu.</>}
            </div>
          )}
      </div>
    </div>
  )
}
