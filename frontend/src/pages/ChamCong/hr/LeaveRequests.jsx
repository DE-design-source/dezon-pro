import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { REQUEST_TYPES, LEAVE_KINDS, HR_TODAY, reqStatus, leaveDaysOf } from '../../../data/hrData'
import { Avatar, Pill, Seg, Empty, Modal, Field } from './shared'
import { useAccess } from './access'

const STATE_LABEL = { done: 'Đã duyệt', active: 'Đang chờ duyệt', waiting: 'Chưa tới lượt', rejected: 'Từ chối' }
const STATUS = { pending: { label: 'Chờ duyệt', tone: 'finance' }, approved: { label: 'Đã duyệt', tone: 'success' }, rejected: { label: 'Từ chối', tone: 'danger' } }

const BLANK = { empId: '', type: 'leave', leaveKind: 'annual', from: HR_TODAY, to: HR_TODAY, days: 1, hours: 2, reason: '' }

/* Đơn từ (nghỉ phép / đi muộn – về sớm / OT) với luồng duyệt nhiều cấp — góc nhìn HR / quản lý.
   onCreate(đơn) / onDecide(đơn, duyệt?, ghi chú, okMsg) ghi lên máy chủ, trả Promise<boolean> */
export default function LeaveRequests({ employees, requests: allRequests, onCreate, onDecide, toast }) {
  const { can, canDecide, log } = useAccess()
  // Chỉ thấy đơn của nhân sự trong phạm vi được phân quyền
  const requests = allRequests.filter(r => employees.some(e => e.id === r.empId))
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('pending')
  const [open, setOpen] = useState(() => new Set())
  const [notes, setNotes] = useState({})
  const [form, setForm] = useState(null)

  const emp = id => employees.find(e => e.id === id)
  const cnt = s => requests.filter(r => (type === 'all' || r.type === type) && (s === 'all' || reqStatus(r) === s)).length
  const shown = requests.filter(r => (type === 'all' || r.type === type) && (status === 'all' || reqStatus(r) === status))

  function act(r, approve) {
    const note = (notes[r.id] || '').trim()
    if (!approve && !note) { toast('Vui lòng nhập lý do từ chối', 'danger'); return }
    const e = emp(r.empId)
    onDecide(r, approve, note, approve ? `Đã duyệt đơn của ${e.name}` : `Đã từ chối đơn của ${e.name}`).then(ok => {
      if (!ok) return
      setNotes(n => ({ ...n, [r.id]: '' }))
      log('attendance', approve ? 'approve' : 'reject', `${REQUEST_TYPES[r.type].label} — ${e.name} (cấp ${r.steps.findIndex(s => s.state === 'active') + 1})`)
    })
  }
  function submit() {
    const f = form
    if (!f.empId) { toast('Chọn nhân viên', 'danger'); return }
    const body = { empId: Number(f.empId), type: f.type, from: f.from, reason: f.reason.trim() }
    if (f.type === 'leave') Object.assign(body, { leaveKind: f.leaveKind, to: f.to, days: Number(f.days) })
    if (f.type === 'ot') body.hours = Number(f.hours)
    onCreate(body).then(ok => ok && setForm(null))
  }
  const setF = patch => setForm(f => {
    const n = { ...f, ...patch }
    // gợi ý số ngày = số ngày có ca theo lịch của người đó (cùng cách tính với Tổng hợp công)
    if (('from' in patch || 'to' in patch || 'empId' in patch) && n.type === 'leave') { if (n.to < n.from) n.to = n.from; n.days = Math.max(0.5, leaveDaysOf(Number(n.empId), n.from, n.to)) }
    return n
  })
  const toggle = id => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="cc-stack">
      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Đơn từ & phê duyệt</h3><span className="cc-sub">Nhân viên gửi đơn từ Bàn làm việc · đơn đi lần lượt qua từng cấp duyệt</span></div>
          <span className="cc-grow" />
          <Seg value={type} onChange={setType} options={[{ value: 'all', label: 'Mọi loại' }, ...Object.entries(REQUEST_TYPES).map(([k, t]) => ({ value: k, label: t.label, icon: t.icon }))]} />
          {can('attendance', 'create') && <button className="cc-btn" onClick={() => setForm({ ...BLANK })}><Icon name="plus" size={14} stroke={2.4} />Tạo đơn</button>}
        </div>
        <Seg value={status} onChange={setStatus} options={[
          { value: 'pending', label: 'Chờ duyệt', count: cnt('pending') }, { value: 'approved', label: 'Đã duyệt', count: cnt('approved') },
          { value: 'rejected', label: 'Từ chối', count: cnt('rejected') }, { value: 'all', label: 'Tất cả', count: cnt('all') },
        ]} />

        {shown.length === 0 && <Empty icon="checkCircle" text={status === 'pending' ? 'Không còn đơn nào chờ duyệt' : 'Không có đơn trong mục này'} />}
        <div className="cc-reqs">
          {shown.map(r => {
            const e = emp(r.empId)
            const t = REQUEST_TYPES[r.type]
            const st = reqStatus(r)
            const active = r.steps.find(s => s.state === 'active')
            const isOpen = open.has(r.id)
            return (
              <div key={r.id} className={`cc-req${isOpen ? ' open' : ''}`}>
                <button className="cc-req-head" onClick={() => toggle(r.id)} aria-expanded={isOpen}>
                  <span className={`cc-ico cc-tone-${t.tone}`}><Icon name={t.icon} size={15} /></span>
                  <span className="cc-grow cc-req-main">
                    <b>{r.title}</b>
                    <span><Avatar emp={e} size={18} />{e.name} · {e.position} · gửi {r.createdAt}</span>
                  </span>
                  <span className="cc-steps-mini">
                    {r.steps.map((s, i) => <i key={i} className={s.state} title={`${s.role}: ${s.name} — ${STATE_LABEL[s.state]}`} />)}
                  </span>
                  <Pill tone={STATUS[st].tone} dot>{STATUS[st].label}</Pill>
                  <span className={`cc-chev${isOpen ? ' open' : ''}`}><Icon name="chevron" size={15} /></span>
                </button>
                {isOpen && (
                  <div className="cc-req-body">
                    <div className="cc-req-info">
                      <div className="cc-kv"><span>Loại đơn</span><b>{t.label}</b></div>
                      {r.days && <div className="cc-kv"><span>Số ngày</span><b>{r.days} ngày</b></div>}
                      {r.hours && <div className="cc-kv"><span>Số giờ OT</span><b>{r.hours} giờ</b></div>}
                      <div className="cc-kv"><span>Lý do</span><b>{r.reason}</b></div>
                    </div>
                    <ol className="cc-flow">
                      <li className="done"><span className="cc-flow-dot"><Icon name="send" size={11} stroke={2.4} /></span><div><b>Tạo đơn · {e.name}</b><span>{r.createdAt}</span></div></li>
                      {r.steps.map((s, i) => (
                        <li key={i} className={s.state}>
                          <span className="cc-flow-dot">{s.state === 'done' ? <Icon name="check" size={11} stroke={3} /> : s.state === 'rejected' ? <Icon name="x" size={11} stroke={3} /> : i + 1}</span>
                          <div>
                            <b>Cấp {i + 1} · {s.name} <em>{s.role}</em></b>
                            <span>{STATE_LABEL[s.state]}{s.time ? ' · ' + s.time : ''}</span>
                            {s.note && <q>{s.note}</q>}
                          </div>
                        </li>
                      ))}
                    </ol>
                    {active && canDecide(r) && (
                      <div className="cc-req-act">
                        <input placeholder={`Ghi chú cho ${active.name} (bắt buộc khi từ chối)...`} value={notes[r.id] || ''} onChange={ev => setNotes(n => ({ ...n, [r.id]: ev.target.value }))} />
                        <button className="cc-btn ghost danger" onClick={() => act(r, false)}><Icon name="x" size={14} />Từ chối</button>
                        <button className="cc-btn" onClick={() => act(r, true)}><Icon name="check" size={14} stroke={2.6} />Duyệt cấp {r.steps.indexOf(active) + 1}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} icon="checkCircle" width={560} title="Tạo đơn" sub="Đơn đi lần lượt: quản lý trực tiếp → Nhân sự (HR)"
        footer={<><span className="cc-grow" /><button className="cc-btn ghost" onClick={() => setForm(null)}>Hủy</button><button className="cc-btn" onClick={submit}><Icon name="send" size={14} />Gửi đơn</button></>}>
        {form && (
          <div className="cc-form">
            <Field label="Nhân viên *"><select value={form.empId} onChange={e => setF({ empId: e.target.value })}>
              <option value="">— Chọn —</option>{employees.filter(e => e.status !== 'left').map(e => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
            </select></Field>
            <Field label="Loại đơn"><select value={form.type} onChange={e => setF({ type: e.target.value })}>
              {Object.entries(REQUEST_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select></Field>
            {form.type === 'leave' && <Field label="Loại nghỉ"><select value={form.leaveKind} onChange={e => setF({ leaveKind: e.target.value })}>
              {Object.entries(LEAVE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></Field>}
            <Field label={form.type === 'leave' ? 'Từ ngày' : 'Ngày'}><input type="date" value={form.from} onChange={e => setF({ from: e.target.value })} /></Field>
            {form.type === 'leave' && <Field label="Đến ngày"><input type="date" value={form.to} min={form.from} onChange={e => setF({ to: e.target.value })} /></Field>}
            {form.type === 'leave' && <Field label="Số ngày (bước 0,5)"><input type="number" min="0.5" step="0.5" value={form.days} onChange={e => setF({ days: e.target.value })} /></Field>}
            {form.type === 'ot' && <Field label="Số giờ OT"><input type="number" min="0.5" max="24" step="0.5" value={form.hours} onChange={e => setF({ hours: e.target.value })} /></Field>}
            <Field label="Lý do" full><input value={form.reason} onChange={e => setF({ reason: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
