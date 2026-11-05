import { useEffect, useRef, useState } from 'react'
import {
  PO_STAGES, PO_PEOPLE, PO_DEPTS, PO_FLOW_TEMPLATES, TODAY, STATUS_LABEL, avatarColor, initials, parseD, dayDiff, fmt, fmtFull, statusOf, fmtMillion,
} from '../../../data/quanLyThietKeData'

const STEP_COLORS = ['var(--notstarted)', 'var(--accent)', 'var(--progress)', '#8b6fd6', '#2a9bb0', 'var(--done)', '#d9822b', '#c2185b', 'var(--overdue)']
const STEP_KIND = [
  { value: 'normal', label: 'Đang xử lý' },
  { value: 'received', label: 'Đã nhận hàng' },
  { value: 'closed', label: 'Hủy / đóng' },
]
const kindOf = s => (s.closed ? 'closed' : s.received ? 'received' : 'normal')
const stepDepts = s => s.depts || (s.dept ? [s.dept] : [])
const stepOwners = s => s.owners || (s.owner ? [s.owner] : [])
const normStep = s => ({ ...s, depts: stepDepts(s), owners: stepOwners(s) })
const personOf = name => PO_PEOPLE.find(p => p.name === name)
const peopleIn = dept => PO_PEOPLE.filter(p => p.dept === dept)
const nowLabel = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
// Người / phòng ban phụ trách của đơn (dữ liệu cũ chỉ có owner)
const assigneesOf = it => it.assignees || (it.owner ? [it.owner] : [])
const deptOfItem = it => (it.dept !== undefined ? it.dept : 'Phòng Mua hàng')

const Svg = ({ d, size = 14, sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const IcBell = <Svg d={<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>} />
const IcFlow = <Svg d={<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M6 9v3a3 3 0 0 0 3 3h6" /></>} />
const IcPlus = <Svg d={<path d="M12 5v14M5 12h14" />} sw={2.4} />
const IcX = <Svg d={<path d="M18 6 6 18M6 6l12 12" />} />
const IcUp = <Svg d={<path d="m18 15-6-6-6 6" />} size={13} />
const IcDown = <Svg d={<path d="m6 9 6 6 6-6" />} size={13} />
const IcTrash = <Svg d={<><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>} size={13} />
const IcUsers = <Svg d={<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2" /></>} size={12} />

const Avatar = ({ name, size = 22 }) => (
  <span className="tk-avatar-mini" title={name} style={{ background: avatarColor(name), width: size, height: size, marginRight: 0 }}>{initials(name)}</span>
)

/* Ô "+ Thêm" có tìm kiếm: gõ để lọc, ↑↓ chọn, Enter thêm, Esc đóng */
function SearchAdd({ placeholder, options, onPick }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
  const list = options.filter(o => !q.trim() || norm(o.label + ' ' + (o.sub || '')).includes(norm(q.trim())))
  const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 240) }) }
  const pick = o => { if (!o) return; onPick(o.value); setQ(''); setHi(0) }
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]) }
    else if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false); e.currentTarget.blur() }
  }
  let lastGroup = null
  return (
    <span className="tk-sa" ref={ref}>
      <input value={q} placeholder={placeholder} onFocus={() => { place(); setOpen(true) }} onBlur={() => setOpen(false)}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); place() }} onKeyDown={onKey} />
      {open && pos && (
        <div className="tk-sa-list" style={{ left: pos.left, top: pos.top, width: pos.width }} onMouseDown={e => e.preventDefault()}>
          {list.length === 0 && <div className="tk-sa-empty">Không tìm thấy "{q}"</div>}
          {list.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? (lastGroup = o.group) : null
            return (
              <div key={o.value}>
                {head && <div className="tk-sa-group">{head}</div>}
                <button type="button" className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                  {o.avatar && <Avatar name={o.value} size={20} />}
                  <span><b>{o.label}</b>{o.sub && <em>{o.sub}</em>}</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}

/* Trang chi tiết mua hàng dạng kanban — mở khi bấm công việc thuộc giai đoạn "Mua hàng & cung ứng".
   Mỗi đơn có người & phòng ban phụ trách; quy trình (các bước) chỉnh sửa / khởi tạo từ mẫu được cho từng công việc. */
export default function PurchaseBoard({ task, items, open, onClose, onMove, onUpdateItems, onSaveFlow }) {
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [detailId, setDetailId] = useState(null) // đơn đang xem chi tiết
  const [picker, setPicker] = useState(null) // ô chọn người phụ trách: { q }
  const [flowDraft, setFlowDraft] = useState(null) // trình chỉnh sửa quy trình: { steps, tpl, newTpl? }
  const [customTpls, setCustomTpls] = useState([]) // mẫu quy trình tự tạo ("+ Tạo thêm")
  const [notes, setNotes] = useState([]) // thông báo đã gửi
  const [bellOpen, setBellOpen] = useState(false)
  const [toast, setToast] = useState(null)

  // quy trình lưu trên máy chủ theo công việc (task.purchaseFlow); chưa lưu = quy trình mặc định
  const stages = (task && task.purchaseFlow && task.purchaseFlow.length && task.purchaseFlow) || PO_STAGES
  const byKey = Object.fromEntries(stages.map(s => [s.key, s]))

  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key !== 'Escape') return
      if (flowDraft) setFlowDraft(null)
      else if (picker) setPicker(null)
      else if (detailId) setDetailId(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, flowDraft, picker, detailId])
  useEffect(() => { if (!open) { setDetailId(null); setPicker(null); setFlowDraft(null); setBellOpen(false) } }, [open])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  const list = items || []
  const active = list.filter(it => !byKey[it.stage]?.closed)
  const total = active.reduce((s, it) => s + it.value, 0)
  const received = active.filter(it => byKey[it.stage]?.received)
  const receivedValue = received.reduce((s, it) => s + it.value, 0)
  const isPending = it => !byKey[it.stage]?.received && !byKey[it.stage]?.closed
  const lateCount = list.filter(it => isPending(it) && parseD(it.due) < TODAY).length
  const st = task ? statusOf(task) : 'notstarted'
  const detail = list.find(it => it.id === detailId)

  /* ---------- Thông báo (mô phỏng: lưu vào nhật ký + toast) ---------- */
  const notify = (to, text) => setNotes(n => [{ id: Date.now() + Math.random(), to, text, at: nowLabel() }, ...n])
  const updateItem = (itemId, patch) => onUpdateItems(task.id, l => l.map(it => (it.id === itemId ? { ...it, ...patch } : it)))

  function moveTo(it, stageKey) {
    if (!it || it.stage === stageKey) return
    onMove(task.id, it.id, stageKey)
    const s = byKey[stageKey]
    const owners = s ? stepOwners(s) : []
    owners.forEach(o => notify(o, `${it.code} — ${it.item} đã chuyển sang bước "${s.label}", cần bạn xử lý`))
    if (owners.length) setToast(`Đã chuyển ${it.code} sang "${s.label}" · thông báo tới ${owners.join(', ')}`)
  }
  function drop(stageKey) {
    if (dragId) moveTo(list.find(it => it.id === dragId), stageKey)
    setDragId(null)
    setOverStage(null)
  }
  function addAssignee(it, name) {
    const cur = assigneesOf(it)
    if (cur.includes(name)) return
    updateItem(it.id, { assignees: [...cur, name] })
    notify(name, `Bạn được giao phụ trách ${it.code} — ${it.item} (${task.name})`)
    setToast(`Đã giao ${it.code} cho ${name} · đã gửi thông báo`)
  }
  const removeAssignee = (it, name) => updateItem(it.id, { assignees: assigneesOf(it).filter(n => n !== name) })
  function setDept(it, dept) {
    updateItem(it.id, { dept })
    if (!dept) return
    const names = peopleIn(dept).map(p => p.name)
    notify(`${dept}${names.length ? ` (${names.join(', ')})` : ''}`, `Phòng ban được giao phụ trách ${it.code} — ${it.item}`)
    setToast(`Đã giao ${it.code} cho ${dept} · thông báo tới ${names.length || 0} người`)
  }

  /* ---------- Quy trình: chỉnh sửa / khởi tạo từ mẫu ---------- */
  const openFlow = addStep => {
    const steps = stages.map(normStep)
    if (addStep) steps.splice(Math.max(0, steps.findIndex(s => s.received || s.closed)), 0, newStep(steps.length))
    setFlowDraft({ steps, tpl: null })
  }
  const newStep = i => ({ key: 's' + Date.now().toString(36) + i, label: '', color: STEP_COLORS[i % STEP_COLORS.length], depts: [], owners: [] })
  const setStep = (i, patch) => setFlowDraft(d => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const moveStep = (i, dir) => setFlowDraft(d => {
    const steps = [...d.steps]; const j = i + dir
    if (j < 0 || j >= steps.length) return d
    ;[steps[i], steps[j]] = [steps[j], steps[i]]
    return { ...d, steps }
  })
  const removeStep = i => setFlowDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))
  const addStep = () => setFlowDraft(d => ({ ...d, steps: [...d.steps, newStep(d.steps.length)] }))
  const applyTemplate = t => setFlowDraft({ steps: t.stages.map(normStep), tpl: t.key })
  // "+ Tạo thêm": quy trình mới từ đầu, lưu lại thành mẫu dùng cho các lần sau
  const createTemplate = () => setFlowDraft({ steps: [{ key: 's1', label: '', color: STEP_COLORS[0], depts: [], owners: [] }, { key: 'done', label: 'Hoàn tất', color: 'var(--done)', depts: [], owners: [], received: true }], tpl: '__new', newTpl: '' })
  const addTo = (i, field, v) => setFlowDraft(d => ({ ...d, steps: d.steps.map((st, j) => {
    if (j !== i || !v || st[field].includes(v)) return st
    const next = { ...st, [field]: [...st[field], v] }
    // thêm phòng ban mà bước chưa có người → gợi ý người đầu tiên của phòng
    if (field === 'depts' && !st.owners.length && peopleIn(v)[0]) next.owners = [peopleIn(v)[0].name]
    return next
  }) }))
  const removeFrom = (i, field, v) => setFlowDraft(d => ({ ...d, steps: d.steps.map((st, j) => (j === i ? { ...st, [field]: st[field].filter(x => x !== v) } : st)) }))

  const draftFirst = flowDraft?.steps.find(s => !s.closed) || flowDraft?.steps[0]
  const draftKeys = new Set((flowDraft?.steps || []).map(s => s.key))
  const orphanCount = flowDraft ? list.filter(it => !draftKeys.has(it.stage)).length : 0
  const draftValid = flowDraft && flowDraft.steps.length > 0 && flowDraft.steps.every(s => s.label.trim()) && (flowDraft.newTpl === undefined || flowDraft.newTpl.trim())

  function saveFlow() {
    if (!draftValid) return
    const steps = flowDraft.steps.map(s => ({ ...s, label: s.label.trim() }))
    if (flowDraft.newTpl !== undefined) {
      const name = flowDraft.newTpl.trim()
      setCustomTpls(t => [...t, { key: 'c' + Date.now().toString(36), label: name, desc: `Mẫu tự tạo · ${steps.map(x => x.label).join(' → ')}`, stages: steps, custom: true }])
    }
    const first = steps.find(s => !s.closed) || steps[0]
    const keys = new Set(steps.map(s => s.key))
    onSaveFlow(task.id, steps, orphanCount ? (l => l.map(it => (keys.has(it.stage) ? it : { ...it, stage: first.key }))) : null)
    // Người mới được giao phụ trách 1 bước → gửi thông báo
    let sent = 0
    steps.forEach(s => {
      const before = byKey[s.key] ? stepOwners(byKey[s.key]) : []
      s.owners.filter(o => !before.includes(o)).forEach(o => { notify(o, `Bạn phụ trách bước "${s.label}" trong quy trình mua hàng — ${task.name}`); sent++ })
    })
    setFlowDraft(null)
    setToast(`Đã lưu quy trình${flowDraft.newTpl ? ` & mẫu "${flowDraft.newTpl.trim()}"` : ''} · ${steps.length} bước${orphanCount ? ` · ${orphanCount} đơn chuyển về "${first.label}"` : ''}${sent ? ` · ${sent} thông báo` : ''}`)
  }

  const pickList = picker && detail
    ? PO_PEOPLE.filter(p => !assigneesOf(detail).includes(p.name) && (!picker.q || (p.name + ' ' + p.role + ' ' + p.dept).toLowerCase().includes(picker.q.toLowerCase())))
      .sort((a, b) => (a.dept === deptOfItem(detail) ? -1 : 0) - (b.dept === deptOfItem(detail) ? -1 : 0))
    : []

  return (
    <>
      <div className={`tk-pb${open ? ' open' : ''}`} role="region" aria-label="Chi tiết mua hàng" aria-hidden={!open}>
        <div className="tk-pb-head">
          <button className="tk-pb-back" onClick={onClose} title="Quay lại Tiến độ (Esc)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            Tiến độ
          </button>
          <div className="tk-pb-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          </div>
          <div className="tk-pb-title">
            <span className="tk-pb-kicker">Tiến độ › Mua hàng &amp; cung ứng</span>
            <h2>{task ? task.name : '—'}</h2>
          </div>
          <span className="tk-pb-grow" />
          {task && <button className="tk-pb-btn" onClick={() => openFlow(false)} title="Chỉnh sửa / khởi tạo quy trình mua hàng">{IcFlow}Quy trình</button>}
          <div className="tk-pb-bell-wrap">
            <button className={`tk-pb-btn icon${bellOpen ? ' on' : ''}`} onClick={() => setBellOpen(o => !o)} title="Thông báo đã gửi">
              {IcBell}{notes.length > 0 && <span className="tk-pb-badge">{notes.length}</span>}
            </button>
            {bellOpen && (
              <div className="tk-pb-bell">
                <div className="tk-pb-bell-head">Thông báo đã gửi <span>{notes.length}</span></div>
                {notes.length === 0
                  ? <div className="tk-pb-bell-empty">Chưa có thông báo. Giao người / phòng ban phụ trách hoặc chuyển bước để gửi thông báo.</div>
                  : notes.map(n => (
                    <div key={n.id} className="tk-pb-note">
                      <span className="tk-pb-note-ic">{IcBell}</span>
                      <div><b>Tới {n.to}</b><span>{n.text}</span></div>
                      <em className="mono">{n.at}</em>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {task && (
          <div className="tk-pb-meta">
            <div className="tk-pb-meta-item"><span className="tk-fl">Thời gian</span><span className="mono">{fmtFull(parseD(task.start))} → {fmtFull(parseD(task.end))}</span></div>
            <div className="tk-pb-meta-item">
              <span className="tk-fl">Phụ trách</span>
              <span className="tk-pb-person"><span className="tk-avatar-mini" style={{ background: avatarColor(task.assignee) }}>{initials(task.assignee)}</span>{task.assignee}</span>
            </div>
            <div className="tk-pb-meta-item"><span className="tk-fl">Trạng thái</span><span className={`tk-status-badge tk-status-${st}`}><span className="tk-dot" />{STATUS_LABEL[st]}</span></div>
            <div className="tk-pb-meta-item"><span className="tk-fl">Tổng giá trị</span><span className="mono tk-pb-strong">{fmtMillion(total)}</span></div>
            <div className="tk-pb-meta-item"><span className="tk-fl">Đã nhận</span><span className="mono">{received.length}/{list.length} đơn · {fmtMillion(receivedValue)}</span></div>
            <div className="tk-pb-meta-item"><span className="tk-fl">Quá hạn giao</span><span className="mono" style={{ color: lateCount ? 'var(--overdue)' : 'var(--text-dim)' }}>{lateCount} đơn</span></div>
            <div className="tk-pb-meta-item"><span className="tk-fl">Quy trình</span><span>{stages.length} bước</span></div>
          </div>
        )}

        <div className="tk-pb-body">
          <div className="tk-pb-board" style={{ gridTemplateColumns: `repeat(${stages.length + 1}, minmax(220px, 1fr))` }}>
            {stages.map((stage, si) => {
              // đơn ở bước không có trong quy trình hiện tại hiện ở cột đầu (không bao giờ bị ẩn)
              const cards = list.filter(it => it.stage === stage.key || (si === 0 && !byKey[it.stage]))
              const sum = cards.reduce((s, it) => s + it.value, 0)
              return (
                <div
                  key={stage.key}
                  className={`tk-pb-col${overStage === stage.key ? ' over' : ''}`}
                  onDragOver={e => { if (dragId) { e.preventDefault(); setOverStage(stage.key) } }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverStage(null) }}
                  onDrop={e => { e.preventDefault(); drop(stage.key) }}
                >
                  <div className="tk-pb-col-head">
                    <span className="tk-pb-col-dot" style={{ background: stage.color }} />
                    <span className="tk-pb-col-name">{stage.label}</span>
                    <span className="tk-pb-col-count">{cards.length}</span>
                    <span className="tk-pb-col-sum mono">{sum ? fmtMillion(sum) : ''}</span>
                  </div>
                  <button className="tk-pb-col-owner" onClick={() => openFlow(false)} title={`Phụ trách: ${stepOwners(stage).join(', ') || 'chưa giao'}${stepDepts(stage).length ? ' · ' + stepDepts(stage).join(', ') : ''} — bấm để chỉnh quy trình`}>
                    {stepOwners(stage).length
                      ? <span className="tk-pb-avatars">{stepOwners(stage).slice(0, 3).map(n => <Avatar key={n} name={n} size={18} />)}</span>
                      : <span className="tk-pb-col-noowner">{IcUsers}</span>}
                    <span>{stepOwners(stage).length ? (stepOwners(stage).length > 1 ? `${stepOwners(stage)[0]} +${stepOwners(stage).length - 1}` : stepOwners(stage)[0]) : 'Chưa giao người phụ trách'}{stepDepts(stage).length ? <em> · {stepDepts(stage).join(', ')}</em> : null}</span>
                  </button>
                  <div className="tk-pb-cards">
                    {cards.length === 0 && <div className="tk-pb-empty">Kéo thả đơn vào đây</div>}
                    {cards.map(it => {
                      const late = isPending(it) && parseD(it.due) < TODAY
                      const soon = !late && isPending(it) && dayDiff(TODAY, parseD(it.due)) <= 7
                      const people = assigneesOf(it)
                      const dept = deptOfItem(it)
                      return (
                        <div
                          key={it.id}
                          className={`tk-pb-card${dragId === it.id ? ' dragging' : ''}${detailId === it.id ? ' selected' : ''}`}
                          style={{ borderLeftColor: stage.color }}
                          draggable
                          onClick={() => { setDetailId(it.id); setPicker(null) }}
                          onDragStart={e => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => { setDragId(null); setOverStage(null) }}
                        >
                          <div className="tk-pb-card-top">
                            <span className="mono tk-pb-code">{it.code}</span>
                            <span className="mono tk-pb-value">{fmtMillion(it.value)}</span>
                          </div>
                          <div className="tk-pb-item">{it.item}</div>
                          <div className="tk-pb-sub">{it.supplier} · <span className="mono">{it.qty}</span></div>
                          {dept && <span className="tk-pb-dept">{IcUsers}{dept}</span>}
                          <div className="tk-pb-card-foot">
                            <span className={`tk-pb-due mono${late ? ' late' : soon ? ' soon' : ''}`} title={late ? 'Quá hạn giao' : 'Ngày giao dự kiến'}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                              {fmt(parseD(it.due))}{late ? ' · trễ' : ''}
                            </span>
                            <span className="tk-pb-avatars" title={people.join(', ') || 'Chưa có người phụ trách'}>
                              {people.slice(0, 3).map(n => <Avatar key={n} name={n} size={20} />)}
                              {people.length > 3 && <span className="tk-pb-more">+{people.length - 3}</span>}
                              {people.length === 0 && <span className="tk-pb-noone">Chưa giao</span>}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {task && (
              <button className="tk-pb-col tk-pb-addcol" onClick={() => openFlow(true)}>
                {IcPlus}<b>Thêm bước quy trình</b><span>Chỉnh sửa, sắp xếp hoặc khởi tạo quy trình từ mẫu</span>
              </button>
            )}
          </div>

          {detail && (
            <aside className="tk-pb-detail">
              <div className="tk-pb-detail-head">
                <div><span className="mono tk-pb-code">{detail.code}</span><h3>{detail.item}</h3></div>
                <button className="tk-pb-btn icon" onClick={() => setDetailId(null)} title="Đóng">{IcX}</button>
              </div>
              <div className="tk-pb-kv"><span>Nhà cung cấp</span><b>{detail.supplier}</b></div>
              <div className="tk-pb-kv"><span>Khối lượng · Giá trị</span><b className="mono">{detail.qty} · {fmtMillion(detail.value)}</b></div>
              <div className="tk-pb-kv"><span>Ngày giao dự kiến</span><b className="mono">{fmtFull(parseD(detail.due))}</b></div>
              <label className="tk-pb-field">
                <span>Bước hiện tại</span>
                <select value={detail.stage} onChange={e => moveTo(detail, e.target.value)}>
                  {stages.map(s => <option key={s.key} value={s.key}>{s.label}{stepOwners(s).length ? ` — ${stepOwners(s).join(', ')}` : ''}</option>)}
                </select>
              </label>
              <label className="tk-pb-field">
                <span>Phòng ban phụ trách</span>
                <select value={deptOfItem(detail)} onChange={e => setDept(detail, e.target.value)}>
                  <option value="">— Chưa giao phòng ban —</option>
                  {PO_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <div className="tk-pb-field">
                <span>Người phụ trách</span>
                <div className="tk-pb-people">
                  {assigneesOf(detail).map(n => (
                    <span key={n} className="tk-pb-chip">
                      <Avatar name={n} size={20} />
                      <span><b>{n}</b><em>{personOf(n)?.role || ''}</em></span>
                      <button onClick={() => removeAssignee(detail, n)} title="Bỏ phụ trách">{IcX}</button>
                    </span>
                  ))}
                  {assigneesOf(detail).length === 0 && <span className="tk-pb-noone">Chưa có người phụ trách</span>}
                </div>
                {!picker
                  ? <button className="tk-pb-btn ghost" onClick={() => setPicker({ q: '' })}>{IcPlus}Thêm người phụ trách</button>
                  : (
                    <div className="tk-pb-picker">
                      <input autoFocus placeholder="Tìm người theo tên, chức danh, phòng ban…" value={picker.q} onChange={e => setPicker({ q: e.target.value })} />
                      <div className="tk-pb-picker-list">
                        {pickList.length === 0 && <div className="tk-pb-noone" style={{ padding: 10 }}>Không còn ai phù hợp</div>}
                        {pickList.map(p => (
                          <button key={p.name} onClick={() => addAssignee(detail, p.name)}>
                            <Avatar name={p.name} size={22} />
                            <span><b>{p.name}</b><em>{p.role} · {p.dept}</em></span>
                          </button>
                        ))}
                      </div>
                      <button className="tk-pb-btn ghost" onClick={() => setPicker(null)}>Xong</button>
                    </div>
                  )}
                <div className="tk-pb-hint">{IcBell}Người / phòng ban được giao sẽ nhận thông báo ngay.</div>
              </div>
              {(() => {
                const mine = notes.filter(n => n.text.includes(detail.code))
                return mine.length > 0 && (
                  <div className="tk-pb-field">
                    <span>Thông báo của đơn này</span>
                    {mine.map(n => <div key={n.id} className="tk-pb-note small"><div><b>Tới {n.to}</b><span>{n.text}</span></div><em className="mono">{n.at}</em></div>)}
                  </div>
                )
              })()}
            </aside>
          )}
        </div>

        {flowDraft && (
          <div className="tk-pf-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setFlowDraft(null) }}>
            <div className="tk-pf" role="dialog" aria-label="Quy trình mua hàng">
              <div className="tk-pf-head">
                <div><h3>Quy trình mua hàng</h3><span>{task?.name} · chỉnh sửa các bước hoặc khởi tạo từ mẫu</span></div>
                <button className="tk-pb-btn icon" onClick={() => setFlowDraft(null)} title="Đóng">{IcX}</button>
              </div>
              <div className="tk-pf-body">
                <div className="tk-pf-label">Khởi tạo quy trình từ mẫu</div>
                <div className="tk-pf-tpls">
                  {[...PO_FLOW_TEMPLATES.filter(t => t.key !== 'blank'), ...customTpls].map(t => (
                    <button key={t.key} className={`tk-pf-tpl${flowDraft.tpl === t.key ? ' active' : ''}${t.custom ? ' custom' : ''}`} onClick={() => applyTemplate(t)}>
                      <b>{t.label}</b><span>{t.desc}</span><em>{t.stages.length} bước{t.custom ? ' · mẫu tự tạo' : ''}</em>
                    </button>
                  ))}
                  <button className={`tk-pf-tpl add${flowDraft.tpl === '__new' ? ' active' : ''}`} onClick={createTemplate}>
                    <b>{IcPlus}Tạo thêm</b><span>Tạo quy trình mới từ đầu và lưu thành mẫu để dùng lại</span>
                  </button>
                </div>
                {flowDraft.newTpl !== undefined && (
                  <label className="tk-pf-newtpl">
                    <span>Tên mẫu quy trình mới *</span>
                    <input autoFocus value={flowDraft.newTpl} placeholder="VD: Mua vật tư MEP" className={flowDraft.newTpl.trim() ? '' : 'err'} onChange={e => setFlowDraft(d => ({ ...d, newTpl: e.target.value }))} />
                  </label>
                )}
                <div className="tk-pf-label">Các bước <span>· thứ tự từ trái sang phải trên bảng · mỗi bước có thể giao nhiều phòng ban & nhiều người</span></div>
                <div className="tk-pf-steps">
                  <div className="tk-pf-row head"><span /><span>Tên bước</span><span>Phòng ban phụ trách</span><span>Người phụ trách</span><span>Loại</span><span /></div>
                  {flowDraft.steps.map((s, i) => {
                    const count = list.filter(it => it.stage === s.key).length
                    return (
                      <div key={s.key} className="tk-pf-row">
                        <span className="tk-pf-order">
                          <button disabled={i === 0} onClick={() => moveStep(i, -1)} title="Lên trước">{IcUp}</button>
                          <button className="tk-pf-color" style={{ background: s.color }} title="Đổi màu" onClick={() => setStep(i, { color: STEP_COLORS[(STEP_COLORS.indexOf(s.color) + 1) % STEP_COLORS.length] })} />
                          <button disabled={i === flowDraft.steps.length - 1} onClick={() => moveStep(i, 1)} title="Xuống sau">{IcDown}</button>
                        </span>
                        <input value={s.label} placeholder={`Bước ${i + 1}`} className={s.label.trim() ? '' : 'err'} onChange={e => setStep(i, { label: e.target.value })} />
                        <div className="tk-pf-multi">
                          {s.depts.map(d => <span key={d} className="tk-pf-tag">{d}<button onClick={() => removeFrom(i, 'depts', d)} title="Bỏ phòng ban">{IcX}</button></span>)}
                          <SearchAdd placeholder={s.depts.length ? '+ Thêm…' : '+ Tìm phòng ban…'} onPick={v => addTo(i, 'depts', v)}
                            options={PO_DEPTS.filter(d => !s.depts.includes(d)).map(d => ({ value: d, label: d, sub: `${peopleIn(d).length} người` }))} />
                        </div>
                        <div className="tk-pf-multi">
                          {s.owners.map(o => <span key={o} className="tk-pf-tag person"><Avatar name={o} size={16} />{o}<button onClick={() => removeFrom(i, 'owners', o)} title="Bỏ người phụ trách">{IcX}</button></span>)}
                          <SearchAdd placeholder={s.owners.length ? '+ Thêm…' : '+ Tìm người phụ trách…'} onPick={v => addTo(i, 'owners', v)}
                            options={[
                              ...PO_PEOPLE.filter(p => s.depts.includes(p.dept) && !s.owners.includes(p.name)).map(p => ({ value: p.name, label: p.name, sub: `${p.role} · ${p.dept}`, avatar: true, group: 'Trong phòng ban đã chọn' })),
                              ...PO_PEOPLE.filter(p => !s.depts.includes(p.dept) && !s.owners.includes(p.name)).map(p => ({ value: p.name, label: p.name, sub: `${p.role} · ${p.dept}`, avatar: true, group: s.depts.length ? 'Khác' : 'Tất cả' })),
                            ]} />
                        </div>
                        <select value={kindOf(s)} onChange={e => setStep(i, { received: e.target.value === 'received', closed: e.target.value === 'closed' })}>
                          {STEP_KIND.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                        </select>
                        <button className="tk-pf-del" disabled={flowDraft.steps.length <= 1} onClick={() => removeStep(i)} title={count ? `Xoá bước — ${count} đơn sẽ chuyển về bước đầu` : 'Xoá bước'}>{IcTrash}{count > 0 && <em>{count}</em>}</button>
                      </div>
                    )
                  })}
                  <button className="tk-pb-btn ghost tk-pf-add" onClick={addStep}>{IcPlus}Thêm bước</button>
                </div>
                {orphanCount > 0 && draftFirst && <div className="tk-pf-warn">{orphanCount} đơn đang ở bước bị xoá / không có trong quy trình mới sẽ chuyển về "{draftFirst.label || 'bước đầu'}".</div>}
                <div className="tk-pb-hint">{IcBell}Người được giao phụ trách bước sẽ nhận thông báo khi lưu và mỗi khi có đơn chuyển tới bước đó.</div>
              </div>
              <div className="tk-pf-foot">
                <span className="tk-pb-grow" />
                <button className="tk-pb-btn ghost" onClick={() => setFlowDraft(null)}>Hủy</button>
                <button className="tk-pb-btn primary" disabled={!draftValid} onClick={saveFlow}>Lưu quy trình</button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className="tk-pb-toast">{IcBell}{toast}</div>}
      </div>
    </>
  )
}
