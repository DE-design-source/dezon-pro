import { useEffect, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL, DEPT_COLOR, DEPT_SHORT, DEPT_TINT } from '../../../data/kinhDoanhData'
import { fmtTy, stageAccent } from '../utils'
import { useKdMap } from './ShortlistSelect'

/* Bộ lọc theo đánh giá tiềm năng (sao, kdOptions.rating): nút xổ danh sách, tích chọn nhiều mức 0..5 sao (0 = chưa đánh giá);
   không tích mức nào = tất cả */
const STAR_FLT = [5, 4, 3, 2, 1, 0]
const StarIc = ({ on }) => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: on ? '#F5A524' : 'var(--border)' }}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
function StarFilter({ value, onChange, count }) {
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
          <div className="ft">
            <button type="button" onClick={() => onChange([])} disabled={!value.length}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
import { DeptFilter, TimeFilter } from './Filters'
import LeadCard from './LeadCard'

/* ===================== Tab Pipeline khách hàng (Kanban + Danh sách) ===================== */

const LIST_COLS = '1.4fr 1.2fr 1fr 0.9fr 1.2fr 1fr'
const viewBtnStyle = active => ({
  border: 'none', cursor: 'pointer', padding: '7px 13px', fontSize: 12.5, fontWeight: 600,
  background: active ? 'var(--sales-tint)' : 'none', color: active ? 'var(--sales)' : 'var(--text-muted)', fontFamily: 'inherit',
})

export default function PipelineTab({ leads: leadsAll, dept, onDeptChange, timeFilter, onTimeFilterChange, scrollRef, onMove, onDelete, onOpenDetail, onAddAssignee, onRemoveAssignee }) {
  const [view, setView] = useState('kanban')
  const rating = useKdMap('rating')
  const [star, setStar] = useState([])   // các mức sao đang lọc ([] = tất cả)
  const rateOf = l => Number(rating[String(l.id)]) || 0
  const leads = !star.length ? leadsAll : leadsAll.filter(l => star.indexOf(rateOf(l)) >= 0)
  const starCnt = n => leadsAll.filter(l => rateOf(l) === n).length
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
      setHs({ ratio: k.scrollWidth ? Math.min(1, k.clientWidth / k.scrollWidth) : 1, pos: max > 0 ? k.scrollLeft / max : 0 })
    }
    upd()
    k.addEventListener('scroll', upd)
    const ro = new ResizeObserver(upd)
    ro.observe(k)
    return () => { k.removeEventListener('scroll', upd); ro.disconnect() }
  }, [view, leads])
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
        <TimeFilter filter={timeFilter} onChange={onTimeFilterChange} />
        <StarFilter value={star} onChange={setStar} count={starCnt} />
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
          <span>Lead khách hàng</span><span>Loại dự án</span><span>Phòng ban</span><span>Giá trị</span><span>Giai đoạn</span><span>Chuyển tới</span>
        </div>
        {leads.map((l, i) => {
          const a = stageAccent(l.stage)
          return (
            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 10, alignItems: 'center', padding: '11px 4px', ...(i < leads.length - 1 ? { borderBottom: '1px solid var(--border)' } : null) }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{l.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{l.type}</span>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: DEPT_TINT[l.dept], color: DEPT_COLOR[l.dept], fontSize: 10.5, fontWeight: 600, justifySelf: 'start' }}>{DEPT_SHORT[l.dept]}</span>
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700 }}>{fmtTy(l.value)}</span>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: a ? a.bg : 'var(--sales-tint)', color: a ? a.color : 'var(--sales)', fontSize: 11, fontWeight: 600, justifySelf: 'start' }}>{STAGE_LABEL[l.stage]}</span>
              <select
                value={l.stage} onChange={e => onMove(l.id, e.target.value)}
                style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 11, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              >
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </div>
          )
        })}
      </div>
    </>
  )
}
