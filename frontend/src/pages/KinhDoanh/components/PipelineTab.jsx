import { useEffect, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL, DEPT_COLOR, DEPT_SHORT, DEPT_TINT } from '../../../data/kinhDoanhData'
import { fmtTy, stageAccent } from '../utils'
import { useKdMap } from './ShortlistSelect'

/* Bộ lọc theo đánh giá tiềm năng (sao, kdOptions.rating): nút xổ danh sách, tích chọn nhiều mức 0..5 sao (0 = chưa đánh giá);
   không tích mức nào = tất cả */
const STAR_FLT = [5, 4, 3, 2, 1, 0]
const StarIc = ({ on }) => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: on ? '#F5A524' : 'var(--border)' }}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
/* sortOn / onSort: nút ưu tiên sắp xếp 5 sao trước -> 1 sao -> chưa đánh giá (MarkUp 2026-11-16 17:44) */
function StarFilter({ value, onChange, count, sortOn, onSort }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const toggle = n => onChange(value.indexOf(n) >= 0 ? value.filter(x => x !== n) : [...value, n])
  const label = !value.length ? 'Tất cả sao' : value.slice().sort((a, b) => b - a).map(n => (n ? n + '★' : 'Chưa đánh giá')).join(', ')
  return (
    <div className="kd-pl-sdd" ref={box}>
      <button type="button" className={'kd-pl-sbtn' + (value.length ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <StarIc on /><span>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="kd-pl-spop">
          {STAR_FLT.map(n => (
            <label key={n} className={value.indexOf(n) >= 0 ? 'on' : ''}>
              <input type="checkbox" checked={value.indexOf(n) >= 0} onChange={() => toggle(n)} />
              <span className="st">{n ? [1, 2, 3, 4, 5].map(i => <StarIc key={i} on={i <= n} />) : <em>Chưa đánh giá</em>}</span>
              <i>{count(n)}</i>
            </label>
          ))}
          <button type="button" className={'kd-pl-ssort' + (sortOn ? ' on' : '')} aria-pressed={!!sortOn} onClick={() => onSort(!sortOn)}
            title="Xếp khách trong mỗi cột theo số sao: 5 sao trước, chưa đánh giá cuối">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h13M3 12h9M3 18h5M18 4v16M15 17l3 3 3-3" /></svg>
            <span>Ưu tiên 5 sao trước → 1 sao</span>
            <i className="sw" aria-hidden="true" />
          </button>
          <div className="ft">
            <button type="button" onClick={() => onChange([])} disabled={!value.length}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
/* Bộ lọc chọn nhiều (Nguồn, Nhân sự phụ trách - MarkUp 2026-11-16 17:42): cùng kiểu nút + hộp tích của bộ lọc sao, có ô tìm.
   options [{v, label, n}]; value [] = tất cả */
const NONE = '__none__'
function MultiFilter({ icon, allLabel, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const toggle = v => onChange(value.indexOf(v) >= 0 ? value.filter(x => x !== v) : [...value, v])
  const lbl = v => (options.find(o => o.v === v) || { label: v }).label
  const label = !value.length ? allLabel : value.map(lbl).join(', ')
  const t = q.trim().toLowerCase()
  const shown = options.filter(o => !t || o.label.toLowerCase().indexOf(t) >= 0)
  return (
    <div className="kd-pl-sdd" ref={box}>
      <button type="button" className={'kd-pl-sbtn' + (value.length ? ' on' : '')} onClick={() => { setOpen(o => !o); setQ('') }} aria-expanded={open} title={label}>
        {icon}<span>{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="kd-pl-spop">
          {options.length > 6 && <input className="q" autoFocus value={q} placeholder="Gõ để tìm…" onChange={e => setQ(e.target.value)} />}
          <div className="ls">
            {shown.length ? shown.map(o => (
              <label key={o.v} className={value.indexOf(o.v) >= 0 ? 'on' : ''}>
                <input type="checkbox" checked={value.indexOf(o.v) >= 0} onChange={() => toggle(o.v)} />
                <span className="st nm">{o.v === NONE ? <em>{o.label}</em> : o.label}</span>
                <i>{o.n}</i>
              </label>
            )) : <p className="none">Không thấy "{q}"</p>}
          </div>
          <div className="ft">
            <button type="button" onClick={() => onChange([])} disabled={!value.length}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
const ADMIN_KD = 'Admin Kinh doanh'
const srcKey = l => String(l.source || '').trim() || NONE
const staffOf = l => [...new Set((l.assignees || []).filter(a => a && a.name && a.role !== ADMIN_KD).map(a => String(a.name).trim()).filter(Boolean))]
function optsOf(list, keysOf, noneLabel) {
  const m = new Map()
  list.forEach(l => { const ks = keysOf(l); (ks.length ? ks : [NONE]).forEach(k => m.set(k, (m.get(k) || 0) + 1)) })
  return [...m.entries()].map(([v, n]) => ({ v, n, label: v === NONE ? noneLabel : v }))
    .sort((a, b) => (a.v === NONE) - (b.v === NONE) || b.n - a.n || a.label.localeCompare(b.label, 'vi'))
}
/* Bộ lọc Giai đoạn / Giá trị (MarkUp 2026-11-16 18:01). Giá trị lead tính bằng tỷ (l.value) */
const VAL_BANDS = [
  ['0', 'Chưa có giá trị', v => !(v > 0)],
  ['lt1', 'Dưới 1 tỷ', v => v > 0 && v < 1],
  ['1-3', '1 - 3 tỷ', v => v >= 1 && v < 3],
  ['3-5', '3 - 5 tỷ', v => v >= 3 && v < 5],
  ['5-10', '5 - 10 tỷ', v => v >= 5 && v < 10],
  ['gt10', 'Từ 10 tỷ', v => v >= 10],
]
const bandOf = l => { const v = Number(l.value) || 0; const b = VAL_BANDS.find(x => x[2](v)); return b ? b[0] : '0' }
import { DeptFilter, TimeFilter } from './Filters'
import LeadCard from './LeadCard'

/* ===================== Tab Pipeline khách hàng (Kanban + Danh sách) ===================== */

/* STT | Lead | Nguồn | Loại dự án | Phòng ban | Giá trị | Giai đoạn | Chuyển tới | Sửa (MarkUp 2026-11-16 17:34, 17:37) */
const LIST_COLS = '36px 1.4fr 1fr 1.2fr 1fr 0.9fr 1.2fr 1fr 34px'
const viewBtnStyle = active => ({
  border: 'none', cursor: 'pointer', padding: '7px 13px', fontSize: 12.5, fontWeight: 600,
  background: active ? 'var(--sales-tint)' : 'none', color: active ? 'var(--sales)' : 'var(--text-muted)', fontFamily: 'inherit',
})

export default function PipelineTab({ leads: leadsAll, dept, onDeptChange, timeFilter, onTimeFilterChange, scrollRef, onMove, onDelete, onOpenDetail, onEdit, onAddAssignee, onRemoveAssignee }) {
  const [view, setView] = useState('kanban')
  const rating = useKdMap('rating')
  const [star, setStar] = useState([])   // các mức sao đang lọc ([] = tất cả)
  const [starSort, setStarSortRaw] = useState(() => { try { return localStorage.getItem('kd-star-sort') === '1' } catch { return false } })
  const setStarSort = v => { setStarSortRaw(v); try { localStorage.setItem('kd-star-sort', v ? '1' : '0') } catch { /* bỏ qua */ } }
  const rateOf = l => Number(rating[String(l.id)]) || 0
  const [srcF, setSrcF] = useState([])     // nguồn đang lọc
  const [staffF, setStaffF] = useState([]) // nhân sự phụ trách đang lọc
  const okSrc = l => !srcF.length || srcF.indexOf(srcKey(l)) >= 0
  const okStaff = l => { if (!staffF.length) return true; const ss = staffOf(l); return ss.length ? ss.some(x => staffF.indexOf(x) >= 0) : staffF.indexOf(NONE) >= 0 }
  const okStar = l => !star.length || star.indexOf(rateOf(l)) >= 0
  const [stageF, setStageF] = useState([])
  const [valF, setValF] = useState([])
  const okStage = l => !stageF.length || stageF.indexOf(l.stage) >= 0
  const okVal = l => !valF.length || valF.indexOf(bandOf(l)) >= 0
  const leads0 = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l) && okVal(l))
  /* ưu tiên sao: 5 -> 1 -> chưa đánh giá; cùng số sao giữ thứ tự cũ (sort ổn định) */
  const leads = starSort ? leads0.slice().sort((a, b) => (rateOf(b) || -1) - (rateOf(a) || -1)) : leads0
  /* số đếm của từng bộ lọc tính trên các bộ lọc còn lại */
  const starCnt = n => leadsAll.filter(l => okSrc(l) && okStaff(l) && okStage(l) && okVal(l) && rateOf(l) === n).length
  const srcOpts = optsOf(leadsAll.filter(l => okStar(l) && okStaff(l) && okStage(l) && okVal(l)), l => [srcKey(l)].filter(k => k !== NONE), 'Chưa có nguồn')
  const staffOpts = optsOf(leadsAll.filter(l => okStar(l) && okSrc(l) && okStage(l) && okVal(l)), staffOf, 'Chưa có người phụ trách')
  const forStage = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okVal(l))
  const stageOpts = STAGES.map(st => ({ v: st, label: STAGE_LABEL[st], n: forStage.filter(l => l.stage === st).length }))
  const forVal = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l))
  const valOpts = VAL_BANDS.map(([v, label]) => ({ v, label, n: forVal.filter(l => bandOf(l) === v).length }))
  const [draggingId, setDraggingId] = useState(null)
  const [hoverStage, setHoverStage] = useState(null)
  const [memberOpenFor, setMemberOpenFor] = useState(null)
  const kanbanRef = useRef(null)
  const trackRef = useRef(null)
  const [hs, setHs] = useState({ ratio: 1, pos: 0 }) // thanh cuộn ngang: tỉ lệ phần nhìn thấy & vị trí (0–1)

  /* Thanh kéo ngang luôn hiện ở đáy màn hình (sticky) — đồng bộ với vị trí cuộn của kanban */
  useEffect(() => {
    const k = kanbanRef.current
    if (!k) return undefined
    const upd = () => {
      const max = k.scrollWidth - k.clientWidth
      const ratio = k.scrollWidth ? Math.min(1, k.clientWidth / k.scrollWidth) : 1
      const pos = max > 0 ? k.scrollLeft / max : 0
      // chỉ đổi state khi số đo thật sự đổi: object mới mỗi lần sẽ vẽ lại vô hạn
      setHs(h => (h.ratio === ratio && h.pos === pos ? h : { ratio, pos }))
    }
    upd()
    k.addEventListener('scroll', upd)
    const ro = new ResizeObserver(upd)
    ro.observe(k)
    return () => { k.removeEventListener('scroll', upd); ro.disconnect() }
    /* leads.length (không phải leads): danh sách lọc là mảng mới mỗi lần vẽ -> effect chạy lại mỗi lần vẽ -> setHs -> vẽ lại
       -> vòng lặp vô hạn, React bận nên đổi trang (đường dẫn đã đổi) không vẽ được trang mới */
  }, [view, leads.length])
  const stepScroll = dir => { const k = kanbanRef.current; if (k) k.scrollBy({ left: dir * Math.max(240, k.clientWidth * 0.6), behavior: 'smooth' }) }
  // Kéo thumb: di chuyển theo tỉ lệ độ rộng nội dung / độ rộng thanh
  function dragThumb(e) {
    e.preventDefault(); e.stopPropagation()
    const k = kanbanRef.current, t = trackRef.current
    if (!k || !t) return
    const startX = e.clientX, start = k.scrollLeft, factor = k.scrollWidth / t.clientWidth
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = ev => { k.scrollLeft = start + (ev.clientX - startX) * factor }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Bấm vào thanh: nhảy tới vị trí đó (thumb canh giữa điểm bấm)
  function jumpTrack(e) {
    const k = kanbanRef.current, t = trackRef.current
    if (!k || !t) return
    const r = t.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width - hs.ratio / 2
    k.scrollTo({ left: Math.max(0, frac) * k.scrollWidth, behavior: 'smooth' })
  }

  /* Bấm ra ngoài → đóng popover người phụ trách trên thẻ */
  useEffect(() => {
    const close = () => setMemberOpenFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  /* Tự động cuộn khi kéo thẻ lead (trái/phải/lên/xuống) */
  useEffect(() => {
    const kanban = kanbanRef.current
    const scrollWrap = scrollRef.current
    if (!kanban || !scrollWrap) return undefined
    const EDGE = 70, MAX_SPEED = 16
    let dragging = false
    let lastEvent = null
    let rafId = null

    function edgeSpeed(pos, min, max) {
      if (pos < min + EDGE) return -MAX_SPEED * (1 - Math.max(0, pos - min) / EDGE)
      if (pos > max - EDGE) return MAX_SPEED * (1 - Math.max(0, max - pos) / EDGE)
      return 0
    }
    function tick() {
      if (dragging && lastEvent) {
        const kRect = kanban.getBoundingClientRect()
        const sRect = scrollWrap.getBoundingClientRect()
        const hSpeed = edgeSpeed(lastEvent.clientX, kRect.left, kRect.right)
        const vSpeed = edgeSpeed(lastEvent.clientY, sRect.top, sRect.bottom)
        if (hSpeed) kanban.scrollLeft += hSpeed
        if (vSpeed) scrollWrap.scrollTop += vSpeed
        rafId = requestAnimationFrame(tick)
      } else {
        rafId = null
      }
    }
    const onStart = () => { dragging = true }
    const onOver = e => {
      if (!dragging) return
      lastEvent = e
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const onStop = () => { dragging = false; lastEvent = null }
    kanban.addEventListener('dragstart', onStart)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragend', onStop)
    document.addEventListener('drop', onStop)
    return () => {
      kanban.removeEventListener('dragstart', onStart)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragend', onStop)
      document.removeEventListener('drop', onStop)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [scrollRef])

  return (
    <>
      {/* 1 module xanh đậm (như băng dự án QS): phòng ban · thời gian | Kanban / Danh sách */}
      <div className="kd-pl-bar">
        <DeptFilter dept={dept} onChange={onDeptChange} />
        <TimeFilter filter={timeFilter} onChange={onTimeFilterChange} pill />
        <StarFilter value={star} onChange={setStar} count={starCnt} sortOn={starSort} onSort={setStarSort} />
        <MultiFilter allLabel="Tất cả nguồn" options={srcOpts} value={srcF} onChange={setSrcF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.5V19l4 2v-8.5z" /></svg>} />
        <MultiFilter allLabel="Tất cả nhân sự" options={staffOpts} value={staffF} onChange={setStaffF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>} />
        <MultiFilter allLabel="Tất cả giai đoạn" options={stageOpts} value={stageF} onChange={setStageF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>} />
        <MultiFilter allLabel="Tất cả giá trị" options={valOpts} value={valF} onChange={setValF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} />
        <span style={{ flex: 1 }} />
        <div className="kd-pl-view" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button className={view === 'kanban' ? 'active' : undefined} style={viewBtnStyle(view === 'kanban')} onClick={() => setView('kanban')}>Kanban</button>
          <button className={view === 'list' ? 'active' : undefined} style={viewBtnStyle(view === 'list')} onClick={() => setView('list')}>Danh sách</button>
        </div>
      </div>

      {/* ---- Kanban ---- */}
      <div ref={kanbanRef} className="kd-kanban" style={{ display: view === 'kanban' ? 'flex' : 'none', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
        {STAGES.map(stageId => {
          const items = leads.filter(l => l.stage === stageId)
          const total = items.reduce((s, l) => s + l.value, 0)
          const accent = stageAccent(stageId)
          const isLostStage = stageId === 'truot-thau' || stageId === 'spam' || stageId === 'khong-tham-gia'
          const headColor = accent ? accent.color : ''
          return (
            <div
              key={stageId}
              className={`kd-stage-col${hoverStage === stageId ? ' drop-hover' : ''}`}
              style={{ minWidth: 220, '--lane': headColor || 'var(--text-muted)', ...(isLostStage ? { opacity: 0.85 } : null) }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (hoverStage !== stageId) setHoverStage(stageId) }}
              onDragLeave={() => setHoverStage(cur => (cur === stageId ? null : cur))}
              onDrop={e => {
                e.preventDefault()
                setHoverStage(null)
                setDraggingId(null)
                onMove(e.dataTransfer.getData('text/plain'), stageId)
              }}
            >
              <div className="kd-stage-head">
                <span title={STAGE_LABEL[stageId]} style={{ fontWeight: 700, fontSize: 13, ...(headColor ? { color: headColor } : null) }}>{STAGE_LABEL[stageId]}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: headColor || 'var(--text-muted)' }}>({items.length} dự án - {fmtTy(total)})</span>
              </div>
              <div className="kd-stage-body">
                {!items.length && <div className="kd-stage-empty">Kéo thẻ vào đây</div>}
                {items.map(l => (
                  <LeadCard
                    key={l.id} lead={l}
                    dragging={draggingId === l.id}
                    onDragStart={setDraggingId}
                    onDragEnd={() => setDraggingId(null)}
                    onOpen={onOpenDetail} onDelete={onDelete} onMove={onMove}
                    memberOpen={memberOpenFor === l.id}
                    onToggleMember={id => setMemberOpenFor(cur => (cur === id ? null : id))}
                    onCloseMember={() => setMemberOpenFor(null)}
                    onAddAssignee={onAddAssignee} onRemoveAssignee={onRemoveAssignee}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {view === 'kanban' && hs.ratio < 0.995 && (
        <div className="kd-hscroll" role="group" aria-label="Cuộn ngang các giai đoạn">
          <button type="button" onClick={() => stepScroll(-1)} disabled={hs.pos <= 0.002} title="Sang trái" aria-label="Cuộn sang trái">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          {/* thanh trượt mảnh: rãnh xám + con trượt màu kinh doanh (dày lên khi rê / kéo) */}
          <div className="kd-hscroll-track kd-hs-slim" ref={trackRef} onPointerDown={jumpTrack}>
            <div className="kd-hscroll-thumb" style={{ width: hs.ratio * 100 + '%', left: hs.pos * (1 - hs.ratio) * 100 + '%' }} onPointerDown={dragThumb} title="Kéo để xem các giai đoạn" />
          </div>
          <button type="button" onClick={() => stepScroll(1)} disabled={hs.pos >= 0.998} title="Sang phải" aria-label="Cuộn sang phải">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}

      {/* ---- Danh sách ---- */}
      <div style={{ display: view === 'list' ? 'block' : 'none', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '6px 20px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 10, padding: '12px 4px', fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ textAlign: 'right' }}>STT</span><span>Lead khách hàng</span><span>Nguồn</span><span>Loại dự án</span><span>Phòng ban</span><span>Giá trị</span><span>Giai đoạn</span><span>Chuyển tới</span><span />
        </div>
        {leads.map((l, i) => {
          const a = stageAccent(l.stage)
          return (
            /* bấm dòng = mở trang chi tiết khách hàng; ô chọn giai đoạn và nút sửa không mở */
            <div key={l.id} className="kd-list-row" role="button" tabIndex={0} title="Xem chi tiết khách hàng"
              onClick={() => onOpenDetail && onOpenDetail(l.id)}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpenDetail && onOpenDetail(l.id) } }}
              style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 10, alignItems: 'center', padding: '11px 4px', cursor: 'pointer', ...(i < leads.length - 1 ? { borderBottom: '1px solid var(--border)' } : null) }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</span>
              <span title={l.source || ''} style={{ fontSize: 12.5, color: l.source ? 'var(--text)' : 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.source || '—'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{l.type}</span>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: DEPT_TINT[l.dept], color: DEPT_COLOR[l.dept], fontSize: 10.5, fontWeight: 600, justifySelf: 'start' }}>{DEPT_SHORT[l.dept]}</span>
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700 }}>{fmtTy(l.value)}</span>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: a ? a.bg : 'var(--sales-tint)', color: a ? a.color : 'var(--sales)', fontSize: 11, fontWeight: 600, justifySelf: 'start' }}>{STAGE_LABEL[l.stage]}</span>
              <select
                value={l.stage} onChange={e => onMove(l.id, e.target.value)} onClick={e => e.stopPropagation()}
                style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 11, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              >
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
              <button type="button" className="kd-list-edit" title="Sửa thông tin khách hàng" aria-label={'Sửa ' + l.name}
                onClick={e => { e.stopPropagation(); onEdit && onEdit(l.id) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
