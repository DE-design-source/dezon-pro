import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
/* Dữ liệu mặc định của Quản lý thiết kế; trang khác (Quản lý dự án) truyền bộ dữ liệu riêng qua prop `data` */
import * as QLTK_DATA from '../../../data/quanLyThietKeData'
import TaskDrawer from './TaskDrawer'
import GanttItemModal from './GanttItemModal'
import PurchaseBoard from './PurchaseBoard'
import { useDelivery } from '../delivery'

const STATS_EXPANDED_H = 200
const TASKLIST_MIN_W = 420
const TASKLIST_MAX_W = 900
const TASKLIST_KEY = 'siteflow-qltk-tasklist-w'
const LABEL_MIN_W = 34
const MONTH_NAMES = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12']
const RING_CIRCUMFERENCE = 100.5

const CommentFlagIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
)

function loadTasklistWidth() {
  try {
    const saved = parseInt(localStorage.getItem(TASKLIST_KEY), 10)
    if (saved) return saved
  } catch { /* localStorage không khả dụng */ }
  return 540
}

/* Đường kẻ tuần + nền cuối tuần — dựng một lần cho mỗi mức zoom, dùng lại cho mọi hàng */
function GridLines({ dayW, TOTAL_DAYS, RANGE_START }) {
  const lines = []
  for (let d = 0; d <= TOTAL_DAYS; d++) {
    const date = new Date(RANGE_START); date.setDate(date.getDate() + d)
    const dow = date.getDay()
    if (dow === 0 || dow === 6) lines.push(<div key={d} className="tk-gl weekend" style={{ left: d * dayW, width: dayW }} />)
    else if (dow === 1) lines.push(<div key={d} className="tk-gl" style={{ left: d * dayW }} />)
  }
  return <div className="tk-grid-lines">{lines}</div>
}

/* Popover thêm nhân sự cho một giai đoạn */
function PhaseMemberPopover({ phase, onAdd, onRemove, onClose }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const nameRef = useRef(null)
  function add() {
    if (!name.trim()) { nameRef.current.focus(); return }
    onAdd({ name: name.trim(), role: role.trim() || 'Thành viên' })
    setName(''); setRole('')
  }
  return (
    <div className="tk-member-popover" onClick={e => e.stopPropagation()}>
      <div className="tk-mp-title">Nhân sự tham gia — {phase.name}</div>
      <div className="tk-mp-list">
        {phase.members.length ? phase.members.map((m, i) => (
          <span key={i} className="tk-mp-chip">
            <span className="tk-avatar-mini" style={{ background: avatarColor(m.name), marginRight: 0 }}>{initials(m.name)}</span>
            {m.name}
            <span style={{ cursor: 'pointer', color: 'var(--text-faint)', marginLeft: 2 }} onClick={() => onRemove(i)}>✕</span>
          </span>
        )) : <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Chưa có nhân sự</span>}
      </div>
      <input ref={nameRef} type="text" placeholder="Họ tên" value={name} onChange={e => setName(e.target.value)} />
      <input type="text" placeholder="Vai trò (VD: Kỹ sư, Đội thi công...)" value={role} onChange={e => setRole(e.target.value)} />
      <div className="tk-mp-actions">
        <button className="tk-mp-btn" onClick={onClose}>Đóng</button>
        <button className="tk-mp-btn primary" onClick={add}>Thêm nhân sự</button>
      </div>
    </div>
  )
}

/* Tiến độ của dự án đang chọn (DeliveryProvider): đề mục, công việc, mốc thu/chi, bình luận lưu trên máy chủ.
   Bảng mua hàng (PurchaseBoard) vẫn là dữ liệu mẫu: chỉ mở với đề mục mẫu PURCHASE_PHASE_ID nên dữ liệu thật không vào. */
export default function GanttTab({ active, data = QLTK_DATA }) {
  const {
    TODAY, INITIAL_PHASES, STATUS_LABEL,
    parseD, dayDiff, fmt, fmtFull, toISO, statusOf, fmtTyQ, avatarColor, initials,
    PURCHASE_PHASE_ID = null, INITIAL_PURCHASE_ITEMS = {},
  } = data
  const dv = useDelivery()
  const phases = useMemo(() => (dv.detail && String(dv.detail.project.id) === String(dv.currentId) ? dv.detail.phases : []), [dv.detail, dv.currentId])
  const comments = (dv.detail && dv.detail.comments) || {}
  const currentProject = dv.current || { name: 'Chưa có dự án' }
  /* Khung timeline theo dữ liệu thật (luôn gồm hôm nay), lùi 6 ngày / thêm 8 ngày như bản cũ */
  const { RANGE_START, RANGE_END, TOTAL_DAYS } = useMemo(() => {
    const ds = [TODAY, ...phases.flatMap(p => p.tasks.flatMap(t => [parseD(t.start), parseD(t.end)]))]
    const s = new Date(Math.min(...ds)); s.setDate(s.getDate() - 6)
    const e = new Date(Math.max(...ds)); e.setDate(e.getDate() + Math.max(8, 60 - dayDiff(s, e)))
    return { RANGE_START: s, RANGE_END: e, TOTAL_DAYS: dayDiff(s, e) }
  }, [phases]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Dòng tiền: các mốc thu / chi đã xác nhận (tỷ) */
  const CASHFLOW_DATA = useMemo(() => {
    const sum = k => phases.flatMap(p => p.tasks).filter(t => t.finType === k && t.confirmed).reduce((s, t) => s + (t.amountValue || 0) / 1000, 0)
    return { income: sum('thu'), expense: sum('chi') }
  }, [phases])
  const [itemModal, setItemModal] = useState(null) // { kind: 'task'|'phase', mode: 'create'|'edit', phaseId?, task?, phase? }
  const [dayW, setDayW] = useState(16)
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [drawer, setDrawer] = useState({ taskId: null, open: false })
  const [board, setBoard] = useState({ taskId: null, open: false })
  const [openPhasePop, setOpenPhasePop] = useState(null)
  const [cashflowOpen, setCashflowOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [projectMenuQuery, setProjectMenuQuery] = useState('')
  const [statsH, setStatsH] = useState(STATS_EXPANDED_H)
  const [statsAnimate, setStatsAnimate] = useState(true)
  const [tasklistW, setTasklistW] = useState(loadTasklistWidth)
  const [tasklistDragging, setTasklistDragging] = useState(false)

  const timelineColRef = useRef(null)
  const sidebarBodyRef = useRef(null)
  const timelineBodyRef = useRef(null)
  const statsWrapRef = useRef(null)
  const projectSearchRef = useRef(null)
  const syncing = useRef(false)

  const xFor = date => dayDiff(RANGE_START, date) * dayW

  /* ---------- Click ra ngoài: đóng các popover/menu ---------- */
  useEffect(() => {
    const close = () => {
      setCashflowOpen(false)
      setOpenPhasePop(null)
      setProjectMenuOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  /* ---------- Khi mở tab: cuộn timeline về quanh hôm nay ---------- */
  useEffect(() => {
    if (!active) return
    const id = setTimeout(() => {
      if (timelineColRef.current) timelineColRef.current.scrollLeft = Math.max(0, dayDiff(RANGE_START, TODAY) * dayW - 300)
    }, 30)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (projectMenuOpen && projectSearchRef.current) projectSearchRef.current.focus()
  }, [projectMenuOpen])

  /* ---------- Số liệu tổng hợp ---------- */
  const stats = useMemo(() => {
    const flat = phases.flatMap(p => p.tasks).filter(t => !t.milestone)
    const total = flat.length
    return {
      total,
      done: flat.filter(t => statusOf(t) === 'done').length,
      progress: flat.filter(t => statusOf(t) === 'progress').length,
      overdue: flat.filter(t => statusOf(t) === 'overdue').length,
      avg: total ? Math.round(flat.reduce((s, t) => s + t.progress, 0) / total) : 0,
    }
  }, [phases])
  const net = CASHFLOW_DATA.income - CASHFLOW_DATA.expense

  const visiblePhases = useMemo(() => {
    const q = searchTerm
    return phases
      .filter(p => phaseFilter === 'all' || p.id === phaseFilter)
      .map(p => ({ ...p, tasks: p.tasks.filter(t => !q || t.name.toLowerCase().includes(q) || (t.assignee || '').toLowerCase().includes(q)) }))
      .filter(p => !q || p.tasks.length > 0) // đề mục trống vẫn hiện (để thêm công việc), chỉ ẩn khi đang tìm kiếm
  }, [phases, phaseFilter, searchTerm])

  const rowCount = visiblePhases.reduce((n, p) => n + 1 + (collapsed.has(p.id) ? 0 : p.tasks.length + 1), 0) + 1
  const gridLines = useMemo(() => <GridLines dayW={dayW} TOTAL_DAYS={TOTAL_DAYS} RANGE_START={RANGE_START} />, [dayW, TOTAL_DAYS, RANGE_START])

  const drawerTask = drawer.taskId ? phases.flatMap(p => p.tasks).find(t => t.id === drawer.taskId) : null
  const boardTask = board.taskId ? phases.flatMap(p => p.tasks).find(t => t.id === board.taskId) : null
  const purchaseTaskIds = useMemo(
    () => new Set((phases.find(p => p.id === PURCHASE_PHASE_ID)?.tasks || []).map(t => t.id)),
    [phases],
  )

  /* ---------- Cập nhật dữ liệu (gửi máy chủ; DeliveryProvider nạp lại tiến độ sau mỗi lệnh) ---------- */
  function updateTask(taskId, patch) {
    return dv.updateTask(taskId, patch)
  }
  /* ---------- Tạo / sửa / xoá đề mục & công việc ---------- */
  const knownAssignees = useMemo(() => [...new Set(phases.flatMap(p => [...p.tasks.map(t => t.assignee), ...(p.members || []).map(m => m.name)]).filter(Boolean))], [phases])
  const openNewTask = phaseId => setItemModal({ kind: 'task', mode: 'create', phaseId })
  const openEditTask = (phaseId, task) => setItemModal({ kind: 'task', mode: 'edit', phaseId, task })
  async function saveTask(data) {
    if (!dv.currentId) { alert('Chọn hoặc tạo dự án trước.'); return }
    const editing = itemModal?.mode === 'edit'
    const fields = { ...data, critical: !data.milestone && !!data.critical }
    delete fields.assignee
    const ok = editing ? await dv.updateTask(itemModal.task.id, fields) : await dv.addTask({ ...fields, sortOrder: (phases.find(p => p.id === data.phaseId)?.tasks.length || 0) })
    if (!ok) return
    setCollapsed(c => { const n = new Set(c); n.delete(data.phaseId); return n })
    setItemModal(null)
  }
  async function deleteTask(id) {
    if (!window.confirm('Xoá công việc này khỏi tiến độ?')) return
    if (await dv.deleteTask(id)) setItemModal(null)
  }
  async function savePhase(name) {
    if (!dv.currentId) { alert('Chọn hoặc tạo dự án trước.'); return }
    const ok = itemModal?.mode === 'edit' ? await dv.updatePhase(itemModal.phase.id, { name }) : await dv.addPhase({ name, sortOrder: phases.length })
    if (ok) setItemModal(null)
  }
  async function deletePhase(id) {
    const ph = phases.find(p => p.id === id)
    if (!window.confirm(`Xoá đề mục "${ph?.name}"${ph?.tasks.length ? ` cùng ${ph.tasks.length} công việc` : ''}?`)) return
    if (!(await dv.deletePhase(id))) return
    if (phaseFilter === id) setPhaseFilter('all')
    setItemModal(null)
  }
  /* Mẫu: xoá hết (trống) hoặc dựng lại khung mẫu, dời ngày để công việc đầu tiên bắt đầu từ hôm nay */
  async function applyTemplate(v) {
    if (!dv.currentId) { alert('Chọn hoặc tạo dự án trước.'); return }
    if (v === 'blank') {
      if (phases.length && !window.confirm('Bắt đầu từ trống sẽ xoá toàn bộ đề mục & công việc hiện tại. Tiếp tục?')) return
    } else if (v === 'sample') {
      if (!window.confirm('Dựng tiến độ theo khung mẫu (dời ngày bắt đầu về hôm nay) — thay toàn bộ đề mục hiện tại?')) return
    } else return
    await dv.batch(async call => {
      for (const p of phases) await call('DELETE', '/phases/' + p.id)
      if (v !== 'sample') return
      const first = Math.min(...INITIAL_PHASES.flatMap(p => p.tasks.map(t => parseD(t.start))))
      const shift = s => { const d = parseD(s); d.setDate(d.getDate() + dayDiff(new Date(first), TODAY)); return toISO(d) }
      for (let i = 0; i < INITIAL_PHASES.length; i++) {
        const src = INITIAL_PHASES[i]
        const ph = await call('POST', '/phases', { name: src.name, sortOrder: i, members: src.members || [] })
        for (let k = 0; k < src.tasks.length; k++) {
          const s = src.tasks[k]
          await call('POST', '/tasks', {
            phaseId: ph.id, name: s.name, start: shift(s.start), end: shift(s.end), progress: 0, critical: !!s.critical, milestone: !!s.milestone,
            desc: s.desc || '', depts: s.depts || [], owners: s.owners || (s.assignee ? [s.assignee] : []), sortOrder: k,
            finType: s.finType || '', planStart: s.planStart ? shift(s.planStart) : '', amountVnd: s.amountValue != null ? Math.round(s.amountValue * 1e6) : null,
          })
        }
      }
    })
    setPhaseFilter('all')
  }

  function updatePhaseMembers(phaseId, fn) {
    const ph = phases.find(p => p.id === phaseId)
    if (ph) dv.updatePhase(phaseId, { members: fn(ph.members || []) })
  }
  function toggleCollapsed(phaseId) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(phaseId) ? next.delete(phaseId) : next.add(phaseId)
      return next
    })
  }
  function openTask(t) {
    setSelectedTaskId(t.id)
    // Công việc mua hàng → mở trang chi tiết đơn mua hàng dạng kanban thay cho drawer
    if (purchaseTaskIds.has(t.id)) setBoard({ taskId: t.id, open: true })
    else setDrawer({ taskId: t.id, open: true })
  }
  function closeDrawer() {
    setDrawer(d => ({ ...d, open: false }))
    setSelectedTaskId(null)
  }
  function closeBoard() {
    setBoard(b => ({ ...b, open: false }))
    setSelectedTaskId(null)
  }
  const [purchaseItems, setPurchaseItems] = useState(INITIAL_PURCHASE_ITEMS)
  function movePurchaseItem(taskId, itemId, stage) {
    setPurchaseItems(prev => ({ ...prev, [taskId]: (prev[taskId] || []).map(it => it.id === itemId ? { ...it, stage } : it) }))
  }
  function addComment(taskId, text) {
    dv.addComment(taskId, text)
  }
  function confirmFinance(task) {
    const input = prompt(`Nhập ngày ${task.finType === 'thu' ? 'thực thu' : 'thực chi'} thực tế (YYYY-MM-DD):`, task.planStart)
    if (!input) return
    if (isNaN(parseD(input).getTime())) { alert('Ngày không hợp lệ. Vui lòng nhập theo định dạng YYYY-MM-DD.'); return }
    updateTask(task.id, { start: input, end: input, confirmed: true })
  }

  /* ---------- Kéo giãn thanh công việc ---------- */
  function startBarResize(e, t, x1) {
    e.stopPropagation()
    e.preventDefault()
    const bar = e.currentTarget.parentElement
    const startX = e.clientX
    const startDays = dayDiff(parseD(t.start), parseD(t.end))
    let pendingEnd = t.end
    document.body.style.cursor = 'ew-resize'
    function onMove(ev) {
      const newDays = Math.max(0, startDays + Math.round((ev.clientX - startX) / dayW))
      const newEnd = parseD(t.start); newEnd.setDate(newEnd.getDate() + newDays)
      bar.style.width = Math.max(dayW, (xFor(newEnd) + dayW) - x1) + 'px'
      pendingEnd = toISO(newEnd)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      if (pendingEnd !== t.end) updateTask(t.id, { end: pendingEnd })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /* ---------- Kéo/bấm để thu gọn thanh KPI + bộ lọc ---------- */
  function startStatsDrag(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = statsWrapRef.current.getBoundingClientRect().height
    const clamp = h => Math.max(0, Math.min(STATS_EXPANDED_H, h))
    let moved = false
    setStatsAnimate(false)
    function onMove(ev) {
      const delta = ev.clientY - startY
      if (Math.abs(delta) > 3) moved = true
      setStatsH(clamp(startH + delta))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setStatsAnimate(true)
      if (moved) {
        const h = statsWrapRef.current.getBoundingClientRect().height
        setStatsH(h > STATS_EXPANDED_H / 2 ? STATS_EXPANDED_H : 0)
      } else {
        setStatsH(h => (h <= 2 ? STATS_EXPANDED_H : 0))
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /* ---------- Kéo mép phải cột "Công việc" ---------- */
  function startTasklistResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = e.currentTarget.parentElement.getBoundingClientRect().width
    let latest = startW
    setTasklistDragging(true)
    document.body.style.userSelect = 'none'
    function onMove(ev) {
      latest = Math.max(TASKLIST_MIN_W, Math.min(TASKLIST_MAX_W, startW + (ev.clientX - startX)))
      setTasklistW(latest)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setTasklistDragging(false)
      document.body.style.userSelect = ''
      try { localStorage.setItem(TASKLIST_KEY, String(parseInt(latest, 10))) } catch { /* bỏ qua */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /* ---------- Đồng bộ cuộn dọc sidebar <-> timeline ---------- */
  function syncScroll(from, to) {
    if (syncing.current || !from.current || !to.current) return
    syncing.current = true
    to.current.scrollTop = from.current.scrollTop
    syncing.current = false
  }

  function scrollToToday() {
    const col = timelineColRef.current
    col.scrollTo({ left: Math.max(0, xFor(TODAY) - col.clientWidth / 2), behavior: 'smooth' })
  }

  /* ---------- Đầu bảng thời gian ---------- */
  const months = []
  for (let cursor = new Date(RANGE_START.getFullYear(), RANGE_START.getMonth(), 1); cursor < RANGE_END;) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const segStart = cursor < RANGE_START ? RANGE_START : cursor
    const segEnd = next > RANGE_END ? RANGE_END : next
    const left = xFor(segStart)
    months.push({ left, width: xFor(segEnd) - left, label: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}` })
    cursor = next
  }
  const weeks = []
  const wcursor = new Date(RANGE_START)
  while (wcursor.getDay() !== 1) wcursor.setDate(wcursor.getDate() - 1)
  for (; wcursor < RANGE_END; wcursor.setDate(wcursor.getDate() + 7)) {
    weeks.push({ left: xFor(wcursor), label: fmt(wcursor) })
  }

  const menuQuery = projectMenuQuery.toLowerCase()
  const menuProjects = dv.projects.filter(p => !menuQuery || p.name.toLowerCase().includes(menuQuery))

  /* ---------- Một hàng trên timeline ---------- */
  function renderTimelineItem(t, st, isSel) {
    const select = e => { e.stopPropagation(); openTask(t) }

    if (t.finType) {
      const isConfirmed = t.confirmed !== false
      const planX = t.planStart ? xFor(parseD(t.planStart)) : null
      const arrow = t.finType === 'thu' ? '↑' : '↓'
      if (!isConfirmed) {
        return (
          <div
            className={`tk-fin-marker tk-fin-${t.finType} tk-fin-pending${isSel ? ' selected' : ''}`}
            style={{ left: planX }}
            title={`${t.name} — Kế hoạch ${fmt(parseD(t.planStart))} — Chờ Kế toán (${t.assignee}) xác nhận thực ${t.finType === 'thu' ? 'thu' : 'chi'}`}
            onClick={select}
          >
            <span>{arrow}</span><span>{t.amount}</span><span className="tk-fin-pending-chip">⏳ Chờ {t.assignee} xác nhận</span>
          </div>
        )
      }
      let delayInfo = ''
      let chip = null
      if (t.planStart) {
        const diff = dayDiff(parseD(t.planStart), parseD(t.start))
        if (diff > 0) { delayInfo = ` — Trễ ${diff} ngày so với kế hoạch`; chip = <span className="tk-fin-delay-chip late"><span className="tk-dot" />Trễ {diff} ngày</span> }
        else if (diff < 0) { delayInfo = ` — Sớm ${-diff} ngày so với kế hoạch`; chip = <span className="tk-fin-delay-chip early"><span className="tk-dot" />Sớm {-diff} ngày</span> }
        else { delayInfo = ' — Đúng kế hoạch'; chip = <span className="tk-fin-delay-chip early"><span className="tk-dot" />Đúng hạn</span> }
      }
      return (
        <>
          {t.planStart && <div className="tk-fin-plan-line" style={{ left: planX }} title={`Kế hoạch: ${fmt(parseD(t.planStart))}`} />}
          <div
            className={`tk-fin-marker tk-fin-${t.finType}${isSel ? ' selected' : ''}`}
            style={{ left: xFor(parseD(t.start)) }}
            title={`${t.name} — ${t.amount}${delayInfo}`}
            onClick={select}
          >
            <span>{arrow}</span><span>{t.amount}</span>{chip}
          </div>
        </>
      )
    }

    if (t.milestone) {
      return <div className={`tk-milestone${isSel ? ' selected' : ''}`} style={{ left: xFor(parseD(t.start)) }} title={t.name} onClick={select} />
    }

    const x1 = xFor(parseD(t.start))
    const w = Math.max(dayW, xFor(parseD(t.end)) + dayW - x1)
    const isNarrow = w < LABEL_MIN_W
    const afterBarX = isNarrow ? x1 + w + 6 + 28 : x1 + w
    return (
      <>
        <div
          className={`tk-bar tk-bar-status-${st}${t.critical ? ' critical' : ''}${isSel ? ' selected' : ''}`}
          style={{ left: x1, width: w }}
          title={`${t.name} — ${t.progress}%`}
          onClick={select}
        >
          <div className="tk-fill" style={{ width: `${t.progress}%` }} />
          {!isNarrow && <span className="tk-bar-label">{t.progress}%</span>}
          <div
            className="tk-bar-resize"
            title="Kéo để mở rộng/thu hẹp thời gian"
            onMouseDown={e => startBarResize(e, t, x1)}
            onClick={e => e.stopPropagation()}
          />
        </div>
        {isNarrow && <span className="tk-bar-label-outside" style={{ left: x1 + w + 6 }}>{t.progress}%</span>}
        {comments[t.id]?.length > 0 && (
          <div className="tk-comment-flag" title="Có bình luận — bấm để xem" style={{ left: afterBarX + 8 }} onClick={select}>
            <CommentFlagIcon />
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="tk-topbar">
        <div className="tk-project-id">
          <span className="tk-kicker" onClick={e => { e.stopPropagation(); setProjectMenuOpen(o => !o); setProjectMenuQuery('') }}>
            <span>{currentProject.name.replace(' — ', ' / ')}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9" /></svg>
          </span>
          <h1>Tiến độ</h1>

          {projectMenuOpen && (
            <div className="tk-project-menu" onClick={e => e.stopPropagation()}>
              <div className="tk-project-menu-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input ref={projectSearchRef} type="text" placeholder="Tìm dự án..." value={projectMenuQuery} onChange={e => setProjectMenuQuery(e.target.value)} />
              </div>
              <div className="tk-project-menu-list">
                {menuProjects.length ? menuProjects.map(p => (
                  <div
                    key={p.id}
                    className={`tk-pm-item${String(p.id) === String(dv.currentId) ? ' active' : ''}`}
                    onClick={() => { dv.select(p.id); setProjectMenuOpen(false) }}
                  >
                    <span>{p.name}</span><span className="tk-pm-sub">{[p.client, p.progress + '%'].filter(Boolean).join(' · ')}</span>
                  </div>
                )) : <div className="tk-pm-empty">Không tìm thấy dự án.</div>}
              </div>
            </div>
          )}
        </div>
        <div className="tk-divider-v" />
        <div className="tk-overall-progress">
          <svg className="tk-ring" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" style={{ stroke: 'var(--border)' }} strokeWidth="4" />
            <circle
              cx="20" cy="20" r="16" fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="4"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE - RING_CIRCUMFERENCE * stats.avg / 100}
              strokeLinecap="round" transform="rotate(-90 20 20)"
            />
          </svg>
          <div className="tk-label">
            <span className="tk-num">{stats.avg}%</span>
            <span className="tk-txt">Tổng tiến độ</span>
          </div>
        </div>
        <div className="tk-divider-v" />
        <div className="tk-search-wrap">
          <div className="tk-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="text" placeholder="Tìm công việc, người phụ trách..." onChange={e => setSearchTerm(e.target.value.trim().toLowerCase())} />
          </div>
        </div>
        <div className="tk-view-switch">
          <button className={dayW === 16 ? 'active' : ''} onClick={() => setDayW(16)}>Tuần</button>
          <button className={dayW === 6 ? 'active' : ''} onClick={() => setDayW(6)}>Tháng</button>
        </div>
        <button className="tk-btn-primary" onClick={scrollToToday}>Về hôm nay</button>
      </div>

      <div
        ref={statsWrapRef}
        className="tk-stats-wrap"
        style={{ maxHeight: statsH, transition: statsAnimate ? 'max-height .2s ease' : 'none' }}
      >
        <div className="tk-stats">
          <div className="tk-stat"><span className="tk-n">{stats.total}</span><span className="tk-l">Tổng số công việc</span></div>
          <div className="tk-stat accent-done"><span className="tk-n">{stats.done}</span><span className="tk-l">Đã hoàn thành</span></div>
          <div className="tk-stat accent-progress"><span className="tk-n">{stats.progress}</span><span className="tk-l">Đang thực hiện</span></div>
          <div className="tk-stat accent-overdue"><span className="tk-n">{stats.overdue}</span><span className="tk-l">Trễ hạn</span></div>
          <div className="tk-stat"><span className="tk-n">{stats.avg}%</span><span className="tk-l">Tiến độ trung bình</span></div>
          <div className="tk-stat accent-cashflow" onClick={e => { e.stopPropagation(); setCashflowOpen(o => !o) }}>
            <span className="tk-n">{net >= 0 ? '+' : ''}{fmtTyQ(net)}</span><span className="tk-l">Dòng tiền</span>
            {cashflowOpen && (
              <div className="tk-cashflow-popover" onClick={e => e.stopPropagation()}>
                <div className="tk-cf-row"><span className="tk-cf-label">Tổng thu</span><span className="tk-cf-value" style={{ color: 'var(--success)' }}>{fmtTyQ(CASHFLOW_DATA.income)}</span></div>
                <div className="tk-cf-row"><span className="tk-cf-label">Tổng chi</span><span className="tk-cf-value" style={{ color: 'var(--overdue)' }}>{fmtTyQ(CASHFLOW_DATA.expense)}</span></div>
                <div className="tk-cf-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span className="tk-cf-label">Chênh lệch</span>
                  <span className="tk-cf-value" style={{ color: net >= 0 ? 'var(--success)' : 'var(--overdue)' }}>{net >= 0 ? '+' : ''}{fmtTyQ(net)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="tk-filters">
          <span className="tk-flabel">Lọc theo giai đoạn</span>
          <button className={`tk-chip${phaseFilter === 'all' ? ' active' : ''}`} onClick={() => setPhaseFilter('all')}>Tất cả</button>
          {/* Bản HTML chèn từng chip ngay sau "Tất cả" nên thứ tự hiển thị bị đảo ngược */}
          {[...phases].reverse().map(p => (
            <button key={p.id} className={`tk-chip${phaseFilter === p.id ? ' active' : ''}`} onClick={() => setPhaseFilter(p.id)}>{p.name}</button>
          ))}
          <button className="tk-chip tk-chip-add" onClick={() => setItemModal({ kind: 'phase', mode: 'create' })}>+ Thêm đề mục</button>
          <select className="tk-tpl-select" value="" onChange={e => applyTemplate(e.target.value)} title="Khởi tạo tiến độ">
            <option value="">Khởi tạo…</option>
            <option value="blank">Bắt đầu từ trống (tự tạo đề mục)</option>
            <option value="sample">Dùng tiến độ mẫu (chung cư)</option>
          </select>
          <span className="tk-spacer" />
          <div className="tk-legend">
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--done)' }} />Hoàn thành</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--progress)' }} />Đang thực hiện</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--overdue)' }} />Trễ hạn</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--notstarted)' }} />Chưa bắt đầu</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--milestone)', transform: 'rotate(45deg)' }} />Mốc quan trọng</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--income)', borderRadius: 20 }} />Thu tiền (thực tế)</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'var(--expense)', borderRadius: 20 }} />Chi tiền (thực tế)</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'transparent', borderLeft: '2px dashed var(--text-dim)', width: 0, height: 14, borderRadius: 0 }} />Mốc kế hoạch (Thu/Chi)</div>
            <div className="tk-li"><span className="tk-sw" style={{ background: 'transparent', border: '1.5px dashed var(--text-dim)', borderRadius: 20, width: 14, height: 9 }} />Chờ Kế toán xác nhận</div>
          </div>
        </div>
      </div>
      <div className="tk-stats-handle" title="Kéo lên / bấm để thu gọn, mở rộng khung timeline" onMouseDown={startStatsDrag}>
        <div className="tk-stats-grip" />
      </div>

      <div className="tk-grid-area" style={{ '--tasklist-w': `${tasklistW}px` }}>
        <div className="tk-sidebar-col">
          <div className="tk-sidebar-head">
            <div className="tk-h-name">Công việc</div>
            <div>Thời lượng</div>
            <div>Phụ trách</div>
            <div>Trạng thái</div>
          </div>
          <div className="tk-sidebar-body" ref={sidebarBodyRef} onScroll={() => syncScroll(sidebarBodyRef, timelineBodyRef)}>
            {visiblePhases.map(phase => {
              const isCollapsed = collapsed.has(phase.id)
              const members = phase.members || []
              const shown = members.slice(0, 4)
              const extra = members.length - shown.length
              const doneCount = phase.tasks.filter(t => statusOf(t) === 'done').length
              return (
                <Fragment key={phase.id}>
                  <div className={`tk-row-phase${isCollapsed ? ' collapsed' : ''}`}>
                    <span className="tk-chev" onClick={e => { e.stopPropagation(); toggleCollapsed(phase.id) }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m6 9 6 6 6-6" /></svg>
                    </span>
                    <span className="tk-phase-name" onClick={() => toggleCollapsed(phase.id)}>{phase.name}</span>
                    <div className="tk-avatar-stack">
                      {shown.map((m, i) => <span key={i} className="tk-avatar" style={{ background: avatarColor(m.name) }} title={`${m.name} — ${m.role}`}>{initials(m.name)}</span>)}
                      {extra > 0 && <span className="tk-avatar-more" title={`${extra} người khác`}>+{extra}</span>}
                    </div>
                    <button className="tk-add-member-btn" title="Thêm nhân sự" onClick={e => { e.stopPropagation(); setOpenPhasePop(id => id === phase.id ? null : phase.id) }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                    <span className="tk-phase-actions" onClick={e => e.stopPropagation()}>
                      <button title="Thêm công việc vào đề mục" onClick={() => openNewTask(phase.id)}>+</button>
                      <button title="Đổi tên đề mục" onClick={() => setItemModal({ kind: 'phase', mode: 'edit', phase })}>✎</button>
                      <button className="del" title="Xoá đề mục" onClick={() => deletePhase(phase.id)}>×</button>
                    </span>
                    <span className="tk-phase-meta">{doneCount}/{phase.tasks.length}</span>
                    {openPhasePop === phase.id && (
                      <PhaseMemberPopover
                        phase={phases.find(p => p.id === phase.id)}
                        onAdd={m => updatePhaseMembers(phase.id, list => [...list, m])}
                        onRemove={idx => updatePhaseMembers(phase.id, list => list.filter((_, i) => i !== idx))}
                        onClose={() => setOpenPhasePop(null)}
                      />
                    )}
                  </div>

                  {!isCollapsed && phase.tasks.map(t => {
                    const st = statusOf(t)
                    const isFin = !!t.finType
                    const nameIcon = isFin ? (t.finType === 'thu' ? '↑ ' : '↓ ') : (t.milestone ? '◆ ' : '')
                    const dateCell = isFin ? t.amount : (t.milestone ? fmt(parseD(t.start)) : `${Math.max(1, dayDiff(parseD(t.start), parseD(t.end)) + 1)}d`)
                    return (
                      <div
                        key={t.id}
                        className={`tk-row-task${t.id === selectedTaskId ? ' selected' : ''}${t.milestone ? ' milestone' : ''}`}
                        onClick={() => openTask(t)}
                      >
                        <div className="tk-t-name">
                          {t.critical && <span className="tk-crit-dot" title="Đường găng" />}
                          {nameIcon}{t.name}
                          {comments[t.id]?.length > 0 && <span className="tk-comment-flag-inline" title="Có bình luận"><CommentFlagIcon /></span>}
                          <button className="tk-task-edit" title="Sửa công việc" onClick={e => { e.stopPropagation(); openEditTask(phase.id, t) }}>✎</button>
                        </div>
                        <div className="tk-t-dates mono">{dateCell}</div>
                        <div className="tk-t-assignee">
                          {t.assignee && <><span className="tk-avatar-mini" style={{ background: avatarColor(t.assignee) }}>{initials(t.assignee)}</span><span className="tk-t-assignee-name" title={[...(t.owners || [t.assignee]), ...(t.depts || [])].join(', ')}>{t.assignee}</span>{(t.owners?.length || 0) > 1 && <span className="tk-more-owners">+{t.owners.length - 1}</span>}</>}
                        </div>
                        <div className="tk-t-status">
                          {isFin
                            ? <span className={`tk-status-badge tk-status-${t.finType === 'thu' ? 'income' : 'expense'}`}><span className="tk-dot" />{t.finType === 'thu' ? 'Thu tiền' : 'Chi tiền'}</span>
                            : <span className={`tk-status-badge tk-status-${st}`}><span className="tk-dot" />{STATUS_LABEL[st]}</span>}
                        </div>
                      </div>
                    )
                  })}
                  {!isCollapsed && (
                    <div className="tk-row-task tk-row-add" onClick={() => openNewTask(phase.id)}>
                      <div className="tk-t-name">+ Thêm công việc</div>
                    </div>
                  )}
                </Fragment>
              )
            })}
            <div className="tk-row-phase tk-row-add-phase" onClick={() => setItemModal({ kind: 'phase', mode: 'create' })}>
              + Thêm đề mục{phases.length === 0 ? ' — chưa có đề mục nào, bấm để tạo đề mục đầu tiên' : ''}
            </div>
          </div>
          <div
            className={`tk-tasklist-resize${tasklistDragging ? ' dragging' : ''}`}
            title="Kéo để mở rộng/thu hẹp cột Công việc"
            onMouseDown={startTasklistResize}
          />
        </div>

        <div className="tk-timeline-col" ref={timelineColRef}>
          <div className="tk-timeline-inner" style={{ width: TOTAL_DAYS * dayW }}>
            <div className="tk-timeline-head">
              <div className="tk-th-months">
                {months.map(m => <div key={m.label} className="tk-m" style={{ left: m.left, width: m.width }}>{m.label}</div>)}
                <div className="tk-today-flag" style={{ left: xFor(TODAY) }}>Hôm nay · {fmtFull(TODAY)}</div>
              </div>
              <div className="tk-th-weeks">
                {weeks.map(w => <div key={w.left} className="tk-w" style={{ left: w.left, width: 7 * dayW }}>{w.label}</div>)}
              </div>
            </div>
            <div className="tk-timeline-body" ref={timelineBodyRef} onScroll={() => syncScroll(timelineBodyRef, sidebarBodyRef)}>
              {visiblePhases.map(phase => (
                <Fragment key={phase.id}>
                  <div className="tk-tl-row-phase">{gridLines}</div>
                  {!collapsed.has(phase.id) && phase.tasks.map(t => (
                    <div key={t.id} className="tk-tl-row-task">
                      {gridLines}
                      {renderTimelineItem(t, statusOf(t), t.id === selectedTaskId)}
                    </div>
                  ))}
                  {!collapsed.has(phase.id) && <div className="tk-tl-row-task tk-tl-row-add">{gridLines}</div>}
                </Fragment>
              ))}
              <div className="tk-tl-row-phase">{gridLines}</div>
              <div className="tk-today-line" style={{ left: xFor(TODAY), height: rowCount * 38 }} />
            </div>
          </div>
        </div>
      </div>

      <GanttItemModal
        state={itemModal}
        phases={phases}
        assignees={knownAssignees}
        onClose={() => setItemModal(null)}
        onSaveTask={saveTask}
        onDeleteTask={deleteTask}
        onSavePhase={savePhase}
        onDeletePhase={deletePhase}
      />

      <TaskDrawer
        task={drawerTask}
        open={drawer.open}
        comments={comments}
        onClose={closeDrawer}
        onAddComment={addComment}
        onConfirm={confirmFinance}
      />
      <PurchaseBoard
        task={boardTask}
        items={boardTask ? purchaseItems[boardTask.id] : null}
        open={board.open}
        onClose={closeBoard}
        onMove={movePurchaseItem}
        onUpdateItems={(taskId, fn) => setPurchaseItems(prev => ({ ...prev, [taskId]: fn(prev[taskId] || []) }))}
      />
    </>
  )
}
