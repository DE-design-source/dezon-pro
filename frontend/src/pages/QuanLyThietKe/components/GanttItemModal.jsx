import { useEffect, useRef, useState } from 'react'
import { INITIAL_HR_EMPLOYEES, DEPTS, deptOf } from '../../../data/hrData'
import { CORE_PHASES } from '../delivery'

const HR_PEOPLE = INITIAL_HR_EMPLOYEES.filter(e => e.status !== 'left').map(e => ({ value: e.name, sub: `${e.position} · ${deptOf(e.dept).name}` }))
const HR_DEPTS = DEPTS.map(d => d.name)
const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()

/* Ô chọn nhiều (thẻ + tìm kiếm); cho phép gõ tên mới rồi Enter (VD: "Đội thi công A") */
function MultiPick({ value, onChange, options, placeholder, allowNew }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef(null)
  const t = norm(q.trim())
  const list = options.filter(o => !value.includes(o.value) && (!t || norm(o.value + ' ' + (o.sub || '')).includes(t))).slice(0, 30)
  const canNew = allowNew && q.trim() && !value.includes(q.trim()) && !options.some(o => norm(o.value) === t)
  const add = v => { if (!v) return; onChange([...value, v]); setQ(''); setHi(0) }
  return (
    <div className="tk-gm-multi" ref={ref} onClick={() => ref.current?.querySelector('input')?.focus()}>
      {value.map(v => <span key={v} className="tk-gm-chip">{v}<button type="button" onClick={e => { e.stopPropagation(); onChange(value.filter(x => x !== v)) }} title="Bỏ">×</button></span>)}
      <span className="tk-gm-multi-in">
        <input value={q} placeholder={value.length ? '+ Thêm…' : placeholder} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (list[hi]) add(list[hi].value); else if (canNew) add(q.trim()) }
            else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
            else if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false) }
          }} />
        {open && (list.length > 0 || canNew) && (
          <div className="tk-gm-multi-list" onMouseDown={e => e.preventDefault()}>
            {list.map((o, i) => <button type="button" key={o.value} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => add(o.value)}><b>{o.value}</b>{o.sub && <em>{o.sub}</em>}</button>)}
            {canNew && <button type="button" className="new" onClick={() => add(q.trim())}><b>+ Thêm "{q.trim()}"</b><em>Đội / người ngoài danh sách HR</em></button>}
          </div>
        )}
      </span>
    </div>
  )
}

/* Hộp thoại tạo / sửa đề mục (giai đoạn) và công việc trên bảng Tiến độ */
export default function GanttItemModal({ state, phases, assignees, onClose, onSaveTask, onDeleteTask, onSavePhase, onDeletePhase }) {
  const isTask = state?.kind === 'task'
  const editing = state?.mode === 'edit'
  const blankTask = () => ({ name: '', phaseId: state?.phaseId || phases[0]?.id || '', milestone: false, start: '', end: '', desc: '', depts: [], owners: [], progress: 0, critical: false })
  const [f, setF] = useState(blankTask)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!state) return
    setErr('')
    if (state.kind === 'task') setF(state.task ? { ...blankTask(), ...state.task, owners: state.task.owners || (state.task.assignee ? [state.task.assignee] : []), depts: state.task.depts || [], phaseId: state.phaseId } : blankTask())
    else setF({ name: state.phase?.name || '' })
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, onClose])
  if (!state) return null

  const set = patch => { setErr(''); setF(x => ({ ...x, ...patch })) }
  function save() {
    if (!f.name.trim()) { setErr(isTask ? 'Nhập tên công việc' : 'Nhập tên đề mục'); return }
    if (!isTask) { onSavePhase(f.name.trim()); return }
    if (!f.phaseId) { setErr('Chọn đề mục cho công việc'); return }
    if (!f.start) { setErr(f.milestone ? 'Chọn ngày của mốc' : 'Chọn ngày bắt đầu'); return }
    const end = f.milestone ? f.start : f.end
    if (!end) { setErr('Chọn ngày kết thúc'); return }
    if (end < f.start) { setErr('Ngày kết thúc phải sau ngày bắt đầu'); return }
    // cột "Phụ trách" trên bảng hiển thị người đầu tiên (hoặc phòng ban nếu chưa có người)
    onSaveTask({ ...f, name: f.name.trim(), desc: (f.desc || '').trim(), end, assignee: f.owners[0] || f.depts[0] || '', progress: Math.max(0, Math.min(100, Number(f.progress) || 0)) })
  }
  const days = f.start && f.end && !f.milestone && f.end >= f.start ? Math.round((new Date(f.end) - new Date(f.start)) / 86400000) + 1 : null

  return (
    <div className="tk-gm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tk-gm-modal" role="dialog" aria-label={isTask ? 'Công việc' : 'Đề mục'}>
        <div className="tk-gm-head">
          <h3>{isTask ? (editing ? 'Sửa công việc' : 'Thêm công việc') : (editing ? 'Sửa đề mục' : 'Thêm đề mục')}</h3>
          <button className="tk-gm-x" onClick={onClose} title="Đóng (Esc)">×</button>
        </div>
        <div className="tk-gm-body">
          <label className="tk-gm-field full">
            <span>{isTask ? 'Tên công việc *' : 'Tên đề mục (giai đoạn) *'}</span>
            <input autoFocus value={f.name} readOnly={!isTask && CORE_PHASES.includes(state.phase?.name)} placeholder={isTask ? 'VD: Đổ bê tông sàn tầng 6' : 'VD: Thi công phần mái'} onChange={e => set({ name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') save() }} />
          </label>
          {isTask && (
            <>
              <label className="tk-gm-field">
                <span>Đề mục</span>
                <select value={f.phaseId} onChange={e => set({ phaseId: Number(e.target.value) })}>{phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <div className="tk-gm-field">
                <span>Loại</span>
                <div className="tk-gm-seg">
                  <button type="button" className={!f.milestone ? 'active' : ''} onClick={() => set({ milestone: false })}>Công việc</button>
                  <button type="button" className={f.milestone ? 'active' : ''} onClick={() => set({ milestone: true })}>◆ Mốc quan trọng</button>
                </div>
              </div>
              <label className="tk-gm-field">
                <span>{f.milestone ? 'Ngày của mốc' : 'Bắt đầu'}</span>
                <input type="date" value={f.start} onChange={e => set({ start: e.target.value, ...(f.end && e.target.value > f.end ? { end: e.target.value } : {}) })} />
              </label>
              {!f.milestone && (
                <label className="tk-gm-field">
                  <span>Kết thúc{days ? ` · ${days} ngày` : ''}</span>
                  <input type="date" value={f.end} min={f.start || undefined} onChange={e => set({ end: e.target.value })} />
                </label>
              )}
              <label className="tk-gm-field full">
                <span>Mô tả chi tiết</span>
                <textarea rows={3} value={f.desc} placeholder="Phạm vi công việc, yêu cầu kỹ thuật, tài liệu liên quan…" onChange={e => set({ desc: e.target.value })} />
              </label>
              <div className="tk-gm-field full">
                <span>Phòng ban phụ trách</span>
                <MultiPick value={f.depts} onChange={v => set({ depts: v })} options={HR_DEPTS.map(d => ({ value: d }))} placeholder="Tìm phòng ban…" />
              </div>
              <div className="tk-gm-field full">
                <span>Người phụ trách</span>
                <MultiPick value={f.owners} onChange={v => set({ owners: v })} allowNew placeholder="Tìm người (HR) hoặc gõ tên đội rồi Enter…"
                  options={[
                    ...HR_PEOPLE.filter(p => f.depts.some(d => p.sub.endsWith(d))).map(p => ({ ...p })),
                    ...assignees.filter(a => !HR_PEOPLE.some(p => p.value === a)).map(a => ({ value: a, sub: 'Đã dùng trong tiến độ' })),
                    ...HR_PEOPLE.filter(p => !f.depts.some(d => p.sub.endsWith(d))),
                  ]} />
              </div>
              <label className="tk-gm-field">
                <span>Tiến độ · {Number(f.progress) || 0}%</span>
                <input type="range" min="0" max="100" step="5" value={Number(f.progress) || 0} onChange={e => set({ progress: Number(e.target.value) })} />
              </label>
              {!f.milestone && (
                <label className="tk-gm-check full">
                  <input type="checkbox" checked={!!f.critical} onChange={e => set({ critical: e.target.checked })} />
                  Thuộc đường găng (công việc trễ sẽ làm trễ cả dự án)
                </label>
              )}
            </>
          )}
          {!isTask && editing && <p className="tk-gm-note full">Đề mục có {state.phase?.tasks.length || 0} công việc.</p>}
        </div>
        <div className="tk-gm-foot">
          {editing && !(!isTask && CORE_PHASES.includes(state.phase?.name)) && (
            <button className="tk-gm-del" onClick={() => (isTask ? onDeleteTask(state.task.id) : onDeletePhase(state.phase.id))}>
              Xoá {isTask ? 'công việc' : 'đề mục'}
            </button>
          )}
          {err && <span className="tk-gm-err">{err}</span>}
          <span style={{ flex: 1 }} />
          <button className="tk-gm-btn ghost" onClick={onClose}>Hủy</button>
          <button className="tk-gm-btn primary" onClick={save}>{editing ? 'Lưu' : (isTask ? 'Thêm công việc' : 'Thêm đề mục')}</button>
        </div>
      </div>
    </div>
  )
}
