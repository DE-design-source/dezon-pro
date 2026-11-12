import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../../../components/ui/Icon'
import { money, fmtDate } from '../../QS/lib/format'
import { loadPurchaseHub, SOURCES, SRC, GROUPS, GRP } from '../api'
import './dashboard.css'

/* Tab "Tổng quan" của Mua hàng: bảng điều khiển cùng dáng Bảng điều khiển QS (cột trái thẻ tóm tắt | danh sách bên phải,
   thanh tiêu đề danh sách nền xanh đậm). Dữ liệu gom từ QS, Quản lý thiết kế, Quản lý dự án (api.js), chỉ đọc;
   bấm 1 dòng mở chi tiết ngay tại chỗ để phòng Mua hàng không phải vào trang của bộ phận khác. */
const short = v => {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ'
  if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' triệu'
  return money(v) + ' đ'
}
const URGENT = { urgent: 'Gấp', critical: 'Khẩn cấp' }
/* Ở cấp module: treeItem / rowEl (khai sau return của component) gọi lúc vẽ; để const trong component sau return thì
   chưa được gán -> ReferenceError làm trắng cả bảng mỗi khi vẽ phiếu Gấp / Khẩn cấp (MarkUp 2026-11-12 15:18) */
const lvTitle = r => (r.fromToday != null ? (r.fromToday < 0 ? 'Quá hạn ' + -r.fromToday + ' ngày' : 'Còn ' + r.fromToday + ' ngày') : '')
const SIDE_N = 6
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
const needsAction = r => r.grp === 'cho' || !!URGENT[r.level]
const MODE_LS = 'mh_dash_mode'
const readMode = () => { try { return localStorage.getItem(MODE_LS) === 'list' ? 'list' : 'project' } catch (e) { return 'project' } }

/* Lọc thời gian theo ngày của phiếu (Ngày gửi / Ngày cần hàng), như bộ lọc thời gian Bảng điều khiển QS; nhớ ở mh_dash_time = {k, from, to} */
const TIME_LS = 'mh_dash_time'
const TIMES = [['', 'Mọi thời gian'], ['today', 'Hôm nay'], ['7d', '7 ngày qua'], ['30d', '30 ngày qua'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['custom', 'Tuỳ chọn…']]
/* Nút lọc nhanh cạnh ô chọn: bấm = lọc, bấm lại nút đang bật = bỏ lọc */
const QUICK_T = [['today', 'Ngày', 'hôm nay'], ['month', 'Tháng', 'tháng này'], ['quarter', 'Quý', 'quý này']]
const NO_TIME = { k: '', from: '', to: '' }
function readTime() {
  try { const v = JSON.parse(localStorage.getItem(TIME_LS) || '{}') || {}; return TIMES.some(x => x[0] === v.k) ? { k: v.k, from: v.from || '', to: v.to || '' } : NO_TIME } catch (e) { return NO_TIME }
}
/* [từ, đến) theo giờ máy; null = không giới hạn. Kỳ (ngày / tuần / tháng / quý / năm) chặn cả 2 đầu để phiếu có ngày cần hàng sau kỳ không lọt vào */
function timeRange(t) {
  const now = new Date(), Y = now.getFullYear(), M = now.getMonth(), D = now.getDate()
  const d0 = (y, m, d) => new Date(y, m, d).getTime()
  const endToday = d0(Y, M, D + 1)
  if (t.k === 'today') return [d0(Y, M, D), endToday]
  if (t.k === '7d') return [d0(Y, M, D - 6), endToday]
  if (t.k === '30d') return [d0(Y, M, D - 29), endToday]
  if (t.k === 'week') { const w = D - ((now.getDay() + 6) % 7); return [d0(Y, M, w), d0(Y, M, w + 7)] }   // từ thứ Hai
  if (t.k === 'month') return [d0(Y, M, 1), d0(Y, M + 1, 1)]
  if (t.k === 'quarter') { const q = M - (M % 3); return [d0(Y, q, 1), d0(Y, q + 3, 1)] }
  if (t.k === 'year') return [d0(Y, 0, 1), d0(Y + 1, 0, 1)]
  if (t.k === 'custom') {
    const to = dayMs(t.to)
    return [dayMs(t.from), to == null ? null : to + 864e5]
  }
  return [null, null]
}
/* Ngày của phiếu -> mốc 0h giờ máy; 'YYYY-MM-DD...' đọc theo ngày ghi (không lệch múi giờ) */
function dayMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
  const t = new Date(s).getTime()
  return s && !isNaN(t) ? t : null
}
const fmtD = s => (s ? s.split('-').reverse().join('/') : '…')

export default function PurchaseDashboard() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [prog, setProg] = useState({ done: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState('all')
  const [grp, setGrp] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState('')
  const [mode, setModeSt] = useState(readMode)   // 'project' = gom theo dự án (bấm dự án xổ các phiếu) | 'list' = từng phiếu
  const setMode = m => { setModeSt(m); try { localStorage.setItem(MODE_LS, m) } catch (e) { /* bỏ qua */ } }
  const [projOpen, setProjOpen] = useState(() => new Set())
  const toggleProj = k => setProjOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const load = useCallback(() => {
    setLoading(true); setProg({ done: 0, total: 0 })
    let alive = true
    loadPurchaseHub((done, total) => { if (alive) setProg({ done, total }) })
      .then(r => { if (alive) { setData(r); setLoading(false) } })
    return () => { alive = false }
  }, [])
  useEffect(() => load(), [load])

  const [time, setTimeSt] = useState(readTime)
  const setTime = t => { setTimeSt(t); try { localStorage.setItem(TIME_LS, JSON.stringify(t)) } catch (e) { /* bỏ qua */ } }
  const [timeOpen, setTimeOpen] = useState(false)
  const timeRef = useRef(null)
  useEffect(() => {
    if (!timeOpen) return undefined
    const down = e => { if (timeRef.current && !timeRef.current.contains(e.target)) setTimeOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [timeOpen])
  const timeLb = time.k === 'custom' ? fmtD(time.from) + ' – ' + fmtD(time.to) : (TIMES.find(x => x[0] === time.k) || TIMES[0])[1]

  /* Bộ lọc thời gian áp cho cả cột trái (số tóm tắt) lẫn danh sách; phiếu không có ngày bị loại khi đang lọc */
  const allRows = data ? data.rows : []
  const rows = useMemo(() => {
    const [a, b] = timeRange(time)
    if (a == null && b == null) return allRows
    return allRows.filter(r => { const t = dayMs(r.date); return t != null && (a == null || t >= a) && (b == null || t < b) })
  }, [allRows, time])
  const bySrc = useMemo(() => {
    const m = { all: rows.length }
    SOURCES.forEach(s => { m[s.key] = rows.filter(r => r.src === s.key).length })
    return m
  }, [rows])
  const inSrc = useMemo(() => (src === 'all' ? rows : rows.filter(r => r.src === src)), [rows, src])
  const shown = useMemo(() => {
    const t = norm(q.trim())
    return inSrc.filter(r => (grp === 'all' || (grp === 'can' ? needsAction(r) : r.grp === grp))
      && (!t || norm([r.code, r.project, r.title, r.supplier, r.task, r.owner].join(' ')).indexOf(t) >= 0))
  }, [inSrc, grp, q])

  /* Gom theo dự án (cùng nguồn + tên dự án): dự án có phiếu cần xử lý lên trước, rồi ngày gần nhất */
  const projGroups = useMemo(() => {
    const m = new Map()
    shown.forEach(r => {
      const k = r.src + '|' + r.project
      if (!m.has(k)) m.set(k, { key: k, src: r.src, project: r.project, rows: [], total: 0, nCho: 0, nUrg: 0, date: '' })
      const g = m.get(k)
      g.rows.push(r)
      if (r.grp !== 'huy') g.total += r.value
      if (r.grp === 'cho') g.nCho++
      if (URGENT[r.level]) g.nUrg++
      if (String(r.date) > g.date) g.date = String(r.date)
    })
    return [...m.values()].sort((a, b) => (b.nUrg + b.nCho > 0) - (a.nUrg + a.nCho > 0) || b.date.localeCompare(a.date))
  }, [shown])

  /* Số tóm tắt theo nguồn đang chọn (không theo trạng thái / ô tìm) */
  const S = useMemo(() => {
    const live = inSrc.filter(r => r.grp !== 'huy')
    const total = live.reduce((t, r) => t + r.value, 0)
    const srcV = SOURCES.map(s => ({ ...s, v: live.filter(r => r.src === s.key).reduce((t, r) => t + r.value, 0) }))
    const g = GROUPS.map(x => { const l = inSrc.filter(r => r.grp === x.key); return { ...x, n: l.length, v: l.reduce((t, r) => t + r.value, 0) } })
    const ncc = {}
    live.forEach(r => { const k = r.supplier.trim() || 'Chưa chọn NCC'; ncc[k] = ncc[k] || { name: k, v: 0, n: 0 }; ncc[k].v += r.value; ncc[k].n++ })
    const nccL = Object.values(ncc).sort((a, b) => b.v - a.v)
    const act = inSrc.filter(needsAction).sort((a, b) => (a.fromToday == null ? 1e9 : a.fromToday) - (b.fromToday == null ? 1e9 : b.fromToday))
    const projects = new Set(live.map(r => r.src + '|' + r.project)).size
    return { total, n: live.length, projects, srcV, g, ncc: nccL, act }
  }, [inSrc])

  function openPage(r) {
    const s = SRC[r.src]
    if (s.kind && r.deliveryId) { try { localStorage.setItem('siteflow-delivery-current-' + s.kind, String(r.deliveryId)) } catch (e) { /* bỏ qua */ } }
    nav(s.page)
  }

  const warn = data ? SOURCES.filter(s => data.src[s.key].state !== 'ok' || data.src[s.key].fail > 0) : []
  const nccMax = S.ncc.length ? S.ncc[0].v || 1 : 1

  return (
    <div className="mh-dash-main">
      <div className="mh-dash-side mh-thin-scroll">
        <section className="mh-sm" aria-label="Giá trị mua hàng">
          <div className="mh-sm-h"><h3>Giá trị mua hàng</h3>
            <span className="mh-sm-sub"><Icon name="filter" size={11} />{src === 'all' ? 'Tất cả nguồn' : 'Từ ' + SRC[src].pageLabel}{time.k ? ' · ' + timeLb : ''}</span>
          </div>
          {loading && <div className="mh-sum-load"><i style={{ width: (prog.total ? prog.done / prog.total * 100 : 5) + '%' }} />Đang gom dữ liệu {prog.done}/{prog.total || '…'} dự án…</div>}
          {!loading && warn.map(s => {
            const x = data.src[s.key]
            return <div key={s.key} className="mh-sum-warn"><Icon name="alert" size={13} />{s.pageLabel}: {x.state === 'ok' ? x.fail + ' dự án chưa tải được' : x.msg}</div>
          })}
          <div className="mh-sm-hero">
            {loading ? <span className="mh-sk mh-sm-bigsk" /> : <b className="mh-sm-big" title={money(S.total) + ' đ'}>{short(S.total)}</b>}
            {!loading && (
              <div className="mh-sm-chiprow">
                <span className="mh-sm-chip">{S.n.toLocaleString('vi-VN')} phiếu</span>
                <span>trên {S.projects} dự án · không tính phiếu từ chối / huỷ</span>
              </div>
            )}
            <div className="mh-sm-split">
              <span className="mh-sm-cap">Theo bộ phận gửi</span>
              <div className="mh-sm-bar" aria-hidden="true">
                {!loading && S.total > 0 && S.srcV.map(s => s.v > 0 && <i key={s.key} className={'s-' + s.key} style={{ width: s.v / S.total * 100 + '%' }} />)}
              </div>
              <div className="mh-sm-legend">
                {S.srcV.map(s => <span key={s.key}><em className={'s-' + s.key} />{s.label} <b>{loading ? '' : S.total ? Math.round(s.v / S.total * 100) + '%' : '0%'}</b></span>)}
              </div>
            </div>
          </div>
          <dl className="mh-sm-rows">
            {S.g.map(g => (
              <div key={g.key} className={'mh-sm-row' + (grp === g.key ? ' on' : '')} onClick={() => setGrp(v => (v === g.key ? 'all' : g.key))} title={'Lọc: ' + g.label}>
                <dt><span className={'mh-dot g-' + g.key} />{g.label} <em>{loading ? '' : g.n}</em></dt>
                <dd>{loading ? <span className="mh-sk" /> : <b>{money(g.v)}</b>}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mh-sm" aria-label="Cần xử lý">
          <div className="mh-sm-h"><h3>Cần xử lý</h3>{!loading && <span className="mh-sm-sub">{S.act.length} phiếu</span>}
            {!loading && S.act.length > SIDE_N && <button type="button" className="mh-sm-more" onClick={() => setGrp('can')} title="Xem tất cả trong danh sách"><Icon name="chevronRight" size={14} /></button>}
          </div>
          <div className="mh-act">
            {loading && [0, 1, 2].map(i => <span key={i} className="mh-sk w" />)}
            {!loading && !S.act.length && <div className="mh-sum-empty">Không có phiếu chờ duyệt hoặc sắp tới hạn.</div>}
            {!loading && S.act.slice(0, SIDE_N).map(r => (
              <button type="button" key={r.id} className="mh-act-i" onClick={() => { setGrp('all'); setQ(''); setOpen(r.id); setProjOpen(s => new Set(s).add(r.src + '|' + r.project)) }}>
                <span className={'mh-src-pill s-' + r.src}>{SRC[r.src].label}</span>
                <span className="mh-act-t"><b>{r.code || r.title}</b><small>{r.project}{r.title && r.code ? ' · ' + r.title : ''}</small></span>
                {URGENT[r.level] ? <span className={'mh-lv ' + r.level}>{URGENT[r.level]}</span> : <span className="mh-st g-cho">Chờ duyệt</span>}
              </button>
            ))}
          </div>
        </section>

        <section className="mh-sm mh-sm-grow" aria-label="Nhà cung cấp">
          <div className="mh-sm-h"><h3>Nhà cung cấp</h3>{!loading && <span className="mh-sm-sub">{S.ncc.length} nhà cung cấp</span>}</div>
          <div className="mh-sm-grp">
            {loading && [0, 1, 2].map(i => <span key={i} className="mh-sk w" />)}
            {!loading && !S.ncc.length && <div className="mh-sum-empty">Chưa có phiếu mua hàng.</div>}
            {!loading && S.ncc.slice(0, SIDE_N).map((x, i) => (
              <div key={x.name} className="mh-sm-g" onClick={() => setQ(x.name === 'Chưa chọn NCC' ? '' : x.name)} title={x.name + ': ' + money(x.v) + ' đ · ' + x.n + ' phiếu'}>
                <div className="t"><span className="nm">{x.name} <em>{x.n} phiếu</em></span><b>{money(x.v)}</b></div>
                <span className="track"><i className={i === 0 ? 'top' : ''} style={{ width: Math.max(1.5, x.v / nccMax * 100) + '%' }} /></span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mh-dash-list">
        <div className="mh-dash-list-head">
          <div className="mh-views" role="tablist" aria-label="Cách xem">
            <button type="button" className={'mh-view' + (mode === 'project' ? ' on' : '')} onClick={() => setMode('project')} title="Gom theo dự án - bấm dự án để xổ các phiếu"><Icon name="folder" size={13} />Theo dự án <small>{projGroups.length}</small></button>
            <button type="button" className={'mh-view' + (mode === 'list' ? ' on' : '')} onClick={() => setMode('list')} title="Từng phiếu"><Icon name="listLines" size={13} />Từng phiếu</button>
          </div>
          <div className="mh-views" role="tablist" aria-label="Nguồn">
            {[{ key: 'all', label: 'Tất cả' }].concat(SOURCES).map(s => (
              <button key={s.key} type="button" className={'mh-view' + (src === s.key ? ' on' : '')} onClick={() => setSrc(s.key)} title={s.pageLabel || 'Mọi bộ phận'}>
                {s.label} <small>{bySrc[s.key] || 0}</small>
              </button>
            ))}
          </div>
          <select className="mh-dash-sel" value={grp} onChange={e => setGrp(e.target.value)} aria-label="Trạng thái">
            <option value="all">Mọi trạng thái</option>
            <option value="can">Cần xử lý</option>
            {GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          {/* bộ lọc thời gian = 1 khối: chọn kỳ (menu) + lọc nhanh Ngày / Tháng / Quý */}
          <div className="mh-tmod">
            <div className="mh-time" ref={timeRef}>
              <button type="button" className={'mh-time-btn' + (time.k ? ' on' : '')} aria-haspopup="listbox" aria-expanded={timeOpen}
                title="Lọc theo ngày của phiếu (ngày gửi / ngày cần hàng)" onClick={() => setTimeOpen(o => !o)}>
                <Icon name="calendar" size={14} /><span>{timeLb}</span><Icon name="chevronDown" size={13} />
              </button>
              {time.k && <button type="button" className="mh-time-x" title="Bỏ lọc thời gian" onClick={() => setTime(NO_TIME)}><Icon name="x" size={12} /></button>}
              {timeOpen && (
                <div className="mh-time-pop" role="listbox">
                  {TIMES.map(([k, lb]) => (
                    <button key={k || 'all'} type="button" role="option" aria-selected={time.k === k} className={time.k === k ? 'on' : ''}
                      onClick={() => { setTime({ ...time, k }); if (k !== 'custom') setTimeOpen(false) }}>
                      {lb}{time.k === k && <Icon name="check" size={13} />}
                    </button>
                  ))}
                  {time.k === 'custom' && (
                    <div className="mh-time-rg">
                      <label>Từ<input type="date" value={time.from} max={time.to || undefined} onChange={e => setTime({ ...time, from: e.target.value })} /></label>
                      <label>Đến<input type="date" value={time.to} min={time.from || undefined} onChange={e => setTime({ ...time, to: e.target.value })} /></label>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mh-tquick" role="radiogroup" aria-label="Lọc nhanh theo thời gian">
              {QUICK_T.map(([k, lb, nm]) => (
                <button key={k} type="button" role="radio" aria-checked={time.k === k} title={'Phiếu trong ' + nm + (time.k === k ? ' - bấm lại để bỏ lọc' : '')}
                  className={'mh-view' + (time.k === k ? ' on' : '')} onClick={() => setTime({ ...time, k: time.k === k ? '' : k })}>{lb}</button>
              ))}
            </div>
          </div>
          <label className="mh-dash-search"><Icon name="search" size={14} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã, dự án, hạng mục, NCC…" />
          </label>
          <button type="button" className="mh-dash-reload" onClick={load} disabled={loading} title="Tải lại dữ liệu"><Icon name="refresh" size={14} /></button>
        </div>

        {/* Bảng cùng dáng "Danh sách dự án" của Bảng điều khiển QS: nút mở | biểu tượng | Dự án (2 dòng) | ... | NCC dạng nhãn xanh đậm;
            dòng dự án mở ra các phiếu dạng cây (như các bản nháp của dự án QS) */}
        <div className="mh-dash-list-body mh-thin-scroll">
          <div className="mh-row-main mh-bar-head">
            <span className="mh-bar-sp" /><span>{mode === 'project' ? 'Dự án' : 'Phiếu'}</span><span>Hạng mục / nội dung</span><span className="c">Nguồn</span>
            <span className="r">Giá trị (đ)</span><span className="c">Ngày</span><span className="c">{mode === 'project' ? 'Phiếu' : 'Mức độ'}</span><span className="c">Trạng thái</span><span>Nhà cung cấp</span>
          </div>
          {loading && !data && [0, 1, 2, 3, 4].map(i => <div key={i} className="mh-row-main"><span className="mh-sk w" style={{ gridColumn: '1 / -1' }} /></div>)}
          {!loading && !shown.length && <div className="mh-dash-empty">{allRows.length ? 'Không có phiếu khớp bộ lọc.' : 'Chưa có thông tin mua hàng từ QS, Quản lý thiết kế, Quản lý dự án.'}</div>}
          {mode === 'list' && shown.map(r => rowEl(r))}
          {mode === 'project' && projGroups.map(g => {
            const on = projOpen.has(g.key)
            const nccs = [...new Set(g.rows.map(r => r.supplier).filter(Boolean))]
            const titles = [...new Set(g.rows.map(r => r.title).filter(Boolean))]
            const nLines = g.rows.reduce((t, r) => t + (Number(r.count) || 0), 0)
            return (
              <div key={g.key} className={'mh-prj' + (on ? ' open' : '')}>
                <div className="mh-row-main mh-prj-main" onClick={() => toggleProj(g.key)}>
                  <span className="mh-tg"><Icon name={on ? 'chevronUp' : 'chevronDown'} size={14} /></span>
                  <span className="mh-ic"><Icon name="folder" size={16} /></span>
                  <span className="mh-cell-2" title={g.project}><b className="mh-name">{g.project || 'Chưa gắn dự án'}</b><small>{g.rows.length} phiếu mua hàng{g.date ? ' · gần nhất ' + fmtDate(g.date) : ''}</small></span>
                  <span className="mh-cell-2"><span className={titles.length ? '' : 'nil'}>{titles.slice(0, 2).join(', ') || '—'}</span>{titles.length > 2 && <small>+{titles.length - 2} hạng mục khác</small>}</span>
                  <span className="c"><span className={'mh-src-pill s-' + g.src}>{SRC[g.src].label}</span></span>
                  <span className="r mh-cell-2 al-r"><b className="mh-num">{money(g.total)}</b>{nLines > 0 && <small>{nLines} dòng hàng</small>}</span>
                  <span className="c mh-date" title="Ngày gần nhất">{g.date ? fmtDate(g.date) : '—'}</span>
                  <span className="c"><span className="mh-count">{g.rows.length} phiếu</span></span>
                  <span className="c mh-st-cell mh-prj-st">
                    {g.nUrg > 0 && <span className="mh-lv critical">{g.nUrg} gấp</span>}
                    {g.nCho > 0 && <span className="mh-st g-cho">{g.nCho} chờ duyệt</span>}
                    {!g.nUrg && !g.nCho && <span className="mh-st g-xong">Không cần xử lý</span>}
                  </span>
                  {nccChips(nccs)}
                </div>
                {on && <div className="mh-prj-body">{g.rows.map(r => treeItem(r))}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  /* Nhà cung cấp: nhãn nền xanh đậm như cột Nhà cung cấp của QS, tối đa 3 nhãn + "+N" */
  function nccChips(list) {
    return (
      <span className="mh-ncc" title={list.join(', ')}>
        {list.length ? <>{list.slice(0, 3).map(n => <span key={n}>{n}</span>)}{list.length > 3 && <em>+{list.length - 3}</em>}</> : <i className="nil">Chưa chọn</i>}
      </span>
    )
  }

  /* 1 phiếu trong dự án đang mở: nhánh cây + dòng gọn kiểu bản nháp của QS; bấm để xem chi tiết */
  function treeItem(r) {
    const on = open === r.id
    return (
      <div key={r.id} className="mh-tree-i">
        <div className={'mh-draft' + (on ? ' active' : '')} onClick={() => setOpen(on ? '' : r.id)}>
          <span className="mh-draft-ic"><Icon name="fileText" size={15} /></span>
          <span className="mh-draft-t">
            <b>{r.code || '—'}{r.title && <span> · {r.title}</span>}</b>
            <small>{[r.kind, r.task, r.supplier || 'Chưa chọn NCC', r.date ? fmtDate(r.date) : ''].filter(Boolean).join(' · ')}</small>
          </span>
          <b className="mh-num">{money(r.value)} đ</b>
          <span className="mh-st-cell">
            {URGENT[r.level] && <span className={'mh-lv ' + r.level} title={lvTitle(r)}>{URGENT[r.level]}</span>}
            <span className={'mh-st g-' + r.grp} title={GRP[r.grp].label}>{r.stLabel}</span>
          </span>
          <button type="button" className="mh-draft-go" onClick={e => { e.stopPropagation(); openPage(r) }} title={'Mở ở ' + SRC[r.src].pageLabel}>Mở</button>
        </div>
        {on && rowBody(r)}
      </div>
    )
  }

  function rowEl(r) {
            const on = open === r.id
            return (
              <div key={r.id} className={'mh-row' + (on ? ' open' : '')}>
                <div className="mh-row-main" onClick={() => setOpen(on ? '' : r.id)}>
                  <span className="mh-tg"><Icon name={on ? 'chevronUp' : 'chevronDown'} size={14} /></span>
                  <span className="mh-ic"><Icon name="fileText" size={16} /></span>
                  <span className="mh-cell-2"><b className="mh-name">{r.code || '—'}</b><small>{[r.project, r.task].filter(Boolean).join(' · ') || r.kind}</small></span>
                  <span className="mh-cell-2"><span>{r.title || '—'}</span>{(r.count > 0 || r.qty) && <small>{[r.count > 0 ? r.count + ' dòng' : '', r.qty].filter(Boolean).join(' · ')}</small>}</span>
                  <span className="c"><span className={'mh-src-pill s-' + r.src}>{SRC[r.src].label}</span></span>
                  <span className="r mh-num">{money(r.value)}</span>
                  <span className="c mh-date" title={r.dateLabel}>{r.date ? fmtDate(r.date) : '—'}</span>
                  <span className="c">{URGENT[r.level] ? <span className={'mh-lv ' + r.level} title={lvTitle(r)}>{URGENT[r.level]}</span> : <span className="mh-date">—</span>}</span>
                  <span className="c mh-st-cell"><span className={'mh-st g-' + r.grp} title={GRP[r.grp].label}>{r.stLabel}</span></span>
                  {nccChips(r.supplier ? [r.supplier] : [])}
                </div>
                {on && rowBody(r)}
              </div>
            )
  }

  function rowBody(r) {
                return (
                  <div className="mh-row-body">
                    <dl className="mh-kv">
                      <div><dt>Loại phiếu</dt><dd>{r.kind}</dd></div>
                      <div><dt>{r.dateLabel}</dt><dd>{r.date ? fmtDate(r.date) : '—'}</dd></div>
                      <div><dt>Người phụ trách</dt><dd>{r.owner || '—'}</dd></div>
                      {r.dept && <div><dt>Bộ phận</dt><dd>{r.dept}</dd></div>}
                      {r.levelLabel && <div><dt>Mức độ</dt><dd>{r.levelLabel}{r.fromToday != null ? ' · ' + (r.fromToday < 0 ? 'quá hạn ' + -r.fromToday + ' ngày' : 'còn ' + r.fromToday + ' ngày') : ''}</dd></div>}
                      {r.group && <div><dt>Nhóm hàng</dt><dd>{r.group}</dd></div>}
                      {r.payment && <div><dt>Thanh toán</dt><dd>{r.payment}</dd></div>}
                      {r.note && <div className="wide"><dt>Ghi chú</dt><dd>{r.note}</dd></div>}
                    </dl>
                    {r.items && r.items.length > 0 && (
                      <div className="mh-items">
                        {r.items.slice(0, 8).map((x, i) => (
                          <div key={i} className="mh-item">
                            <span className="mh-cell-2"><span>{x.name || '—'}</span>{x.sub && <small>{x.sub}</small>}</span>
                            <span className="mh-num">{x.qty != null && x.qty !== '' ? Number(x.qty).toLocaleString('vi-VN') + ' ' + (x.unit || '') : ''}</span>
                            <span className="mh-num r">{money(x.value)}</span>
                          </div>
                        ))}
                        {r.items.length > 8 && <div className="mh-items-more">+ {r.items.length - 8} dòng khác</div>}
                      </div>
                    )}
                    <button type="button" className="mh-row-open" onClick={() => openPage(r)}>Mở ở {SRC[r.src].pageLabel} <Icon name="arrowRight" size={13} /></button>
                  </div>
                )
  }
}
