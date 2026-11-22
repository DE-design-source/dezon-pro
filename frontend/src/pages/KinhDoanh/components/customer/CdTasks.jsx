import { useCallback, useEffect, useRef, useState } from 'react'
import { listTasks, addTask, updateTask, deleteTask, emitLeadChange, useLeadChange } from '../../customerApi'
import { listStaff } from '../../api'
import DatePicker from '../../../../components/ui/DatePicker'
import { Ic, IC_EDIT, IC_X, IC_PLUS, todayIso, fmtDM, peopleOf } from './CdCare'
import './care.css'

/* Khối "Danh sách Task" của khách hàng: việc cần làm có hạn, người làm, ghi chú; tick = xong (gạch ngang).
   Lưu database (/sales/leads/:id/tasks). Khối AI "Tạo task" báo qua emitLeadChange(..., 'tasks'). */

let staffP = null   // tài khoản công ty (tên hiển thị -> tên đăng nhập), nạp 1 lần
const staffMap = () => {
  if (!staffP) staffP = listStaff().then(list => {
    const m = {}
    ;(list || []).forEach(s => { if (s && s.name && s.username) m[String(s.name).trim()] = s.username })
    return m
  }, () => { staffP = null; return {} })
  return staffP
}
const blank = () => ({ title: '', dueDate: '', assignees: [], note: '' })
const sortTasks = list => list.slice().sort((a, b) => {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1
  const da = a.dueDate || '9999', db = b.dueDate || '9999'
  return da === db ? String(a.createdAt || '').localeCompare(String(b.createdAt || '')) : da.localeCompare(db)
})
const names = t => (Array.isArray(t.assignees) ? t.assignees : []).map(x => (x && typeof x === 'object' ? x.name || x.username : x)).filter(Boolean)

function TaskForm({ init, people, onCancel, onSave }) {
  const [f, setF] = useState(() => (init ? { title: init.title || '', dueDate: init.dueDate || '', assignees: names(init), note: init.note || '' } : blank()))
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const opts = [...new Set(people.concat(f.assignees))]
  const tog = n => setF(x => ({ ...x, assignees: x.assignees.indexOf(n) >= 0 ? x.assignees.filter(y => y !== n) : x.assignees.concat([n]) }))
  const addExtra = () => { const t = extra.trim(); if (t && f.assignees.indexOf(t) < 0) setF(x => ({ ...x, assignees: x.assignees.concat([t]) })); setExtra('') }
  const save = async () => {
    if (!f.title.trim() || busy) return
    setBusy(true)
    try { await onSave({ ...f, title: f.title.trim(), note: f.note.trim() }) } finally { setBusy(false) }
  }
  return (
    <div className="cd-task-form" data-cd-busy="1" onKeyDown={e => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) { e.preventDefault(); e.stopPropagation(); onCancel() } }}>
      <input autoFocus className="cd-task-in" value={f.title} placeholder="Tên task (VD: Gửi báo giá khái toán)" aria-label="Tên task"
        onChange={e => setF({ ...f, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save() } }} />
      <div className="cd-task-row">
        <span className="cd-task-lbl">Hạn</span>
        <DatePicker value={f.dueDate} onChange={v => setF(x => ({ ...x, dueDate: v || '' }))} clearable ariaLabel="Hạn task" />
      </div>
      <div className="cd-task-row top">
        <span className="cd-task-lbl">Người làm</span>
        <div className="cd-task-ppl">
          {opts.map(n => <button key={n} type="button" className={f.assignees.indexOf(n) >= 0 ? 'on' : ''} aria-pressed={f.assignees.indexOf(n) >= 0} onClick={() => tog(n)}>{n}</button>)}
          <input value={extra} placeholder="+ Tên khác" aria-label="Thêm người làm"
            onChange={e => setExtra(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra() } }} onBlur={addExtra} />
        </div>
      </div>
      <input className="cd-task-in sm" value={f.note} placeholder="Ghi chú (VD: Sau buổi hẹn 24/11)" aria-label="Ghi chú task" onChange={e => setF({ ...f, note: e.target.value })} />
      <div className="cd-care-foot">
        <button type="button" className="cd-cbtn" onClick={onCancel}>Hủy</button>
        <button type="button" className="cd-cbtn-or" disabled={!f.title.trim() || busy} onClick={save}>{init ? 'Lưu task' : 'Thêm task'}</button>
      </div>
    </div>
  )
}

export default function CdTasks({ lead, me, people }) {
  const leadId = lead ? lead.id : ''
  const [tasks, setTasks] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)   // null | 'new' | id task đang sửa
  const load = useCallback(() => {
    if (!leadId) return Promise.resolve()
    return listTasks(leadId).then(list => { setTasks(Array.isArray(list) ? list : []); setErr(''); setLoaded(true) },
      e => { setErr('Lỗi tải task: ' + ((e && e.message) || e)); setLoaded(true) })
  }, [leadId])
  useEffect(() => { setTasks([]); setLoaded(false); setEdit(null); load() }, [load])
  // sự kiện do chính khối này phát (đã tự tải lại) thì bỏ qua, tránh GET 2 lần; sự kiện từ khối khác (AI "Tạo task") vẫn tải lại
  const selfEmit = useRef(false)
  useLeadChange(leadId, ['tasks'], () => { if (!selfEmit.current) load() })
  if (!lead) return null

  const ppl = peopleOf(lead, me, people)
  const today = todayIso()
  const after = () => {
    selfEmit.current = true
    try { emitLeadChange(leadId, 'tasks') } finally { selfEmit.current = false }
    return load()
  }
  const fail = e => { alert('Không lưu được task: ' + ((e && e.message) || e)); load() }
  const toBody = async f => {
    const m = await staffMap()
    return { title: f.title, dueDate: f.dueDate || '', note: f.note || '', assignees: f.assignees.map(n => ({ name: n, username: m[n] || '' })) }
  }
  const save = async (f, t) => {
    try {
      const body = await toBody(f)
      if (t) await updateTask(t.id, body)
      else await addTask(leadId, { ...body, done: false })
      setEdit(null); await after()
    } catch (e) { alert('Không lưu được task: ' + ((e && e.message) || e)) }
  }
  const toggle = t => {
    setTasks(list => list.map(x => (x.id === t.id ? { ...x, done: !t.done } : x)))
    updateTask(t.id, { done: !t.done }).then(after, fail)
  }
  const del = t => { if (window.confirm('Xoá task "' + (t.title || '') + '"?')) deleteTask(t.id).then(after, fail) }
  const list = sortTasks(tasks)
  const open = list.filter(t => !t.done).length

  return (
    <section className="cd-cc cd-tasks" aria-label="Danh sách Task">
      <div className="cd-cc-h">
        <h3 className="cd-cc-t sm">Danh sách Task</h3>
        {tasks.length > 0 && <span className="cd-task-n">{open}/{tasks.length} chưa xong</span>}
      </div>
      {edit === 'new' && <TaskForm people={ppl} onCancel={() => setEdit(null)} onSave={f => save(f, null)} />}
      {!loaded && <div className="cd-task-none">Đang tải task…</div>}
      {loaded && err && <div className="cd-task-none err">{err}</div>}
      {loaded && !err && !tasks.length && edit !== 'new' && (
        <div className="cd-task-none">Chưa có task nào cho khách hàng này.
          <button type="button" className="cd-cbtn-or" onClick={() => setEdit('new')}><Ic d={IC_PLUS} size={13} />Thêm task</button>
        </div>
      )}
      {list.map(t => {
        if (edit === t.id) return <TaskForm key={t.id} init={t} people={ppl} onCancel={() => setEdit(null)} onSave={f => save(f, t)} />
        const due = t.dueDate ? String(t.dueDate).slice(0, 10) : ''
        const late = due && !t.done && due < today
        const sub = [names(t).join(', '), t.note].filter(Boolean).join(' · ')
        return (
          <div key={t.id} className={'cd-task' + (t.done ? ' done' : '') + (late ? ' late' : '')}>
            <div className="cd-task-date" title={due ? 'Hạn ' + due.split('-').reverse().join('/') + (late ? ' (quá hạn)' : '') : 'Chưa đặt hạn'}>
              {due ? <><b>{fmtDM(due).slice(0, 2)}</b><span>TH {Number(due.slice(5, 7))}</span></> : <><b>--</b><span>Chưa hạn</span></>}
            </div>
            <div className="cd-task-b">
              <span className="cd-task-t">{t.title}{t.source === 'ai' && <em className="cd-task-ai" title="Task do AI gợi ý">AI</em>}</span>
              {sub && <span className="cd-task-s">{sub}</span>}
            </div>
            <span className="cd-task-a">
              <button type="button" title="Sửa task" aria-label="Sửa task" onClick={() => setEdit(t.id)}><Ic d={IC_EDIT} size={13} /></button>
              <button type="button" title="Xoá task" aria-label="Xoá task" onClick={() => del(t)}><Ic d={IC_X} size={13} /></button>
            </span>
            <button type="button" className="cd-cchk lg" role="checkbox" aria-checked={!!t.done} title={t.done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'} onClick={() => toggle(t)}>{t.done ? '✓' : ''}</button>
          </div>
        )
      })}
      {/* đã có task: nút thêm nằm cuối danh sách (bỏ nút ở góc trên thẻ) */}
      {loaded && !err && tasks.length > 0 && edit !== 'new' && (
        <div className="cd-task-add"><button type="button" className="cd-cbtn-or" onClick={() => setEdit('new')}><Ic d={IC_PLUS} size={13} />Thêm task</button></div>
      )}
    </section>
  )
}
