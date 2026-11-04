import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { REQUEST_TYPES, HR_TODAY } from '../../../data/hrData'
import { Avatar, Pill, Seg, Empty } from './shared'
import { useAccess } from './access'

const STATE_LABEL = { done: 'Đã duyệt', active: 'Đang chờ duyệt', waiting: 'Chưa tới lượt', rejected: 'Từ chối' }
export function reqStatus(r) {
  if (r.steps.some(s => s.state === 'rejected')) return 'rejected'
  if (r.steps.every(s => s.state === 'done')) return 'approved'
  return 'pending'
}
const STATUS = { pending: { label: 'Chờ duyệt', tone: 'finance' }, approved: { label: 'Đã duyệt', tone: 'success' }, rejected: { label: 'Từ chối', tone: 'danger' } }
const nowLabel = () => HR_TODAY.split('-').reverse().join('/') + ' · ' + new Date().toTimeString().slice(0, 5)

/* Đơn từ (nghỉ phép / đi muộn – về sớm / OT) với luồng duyệt nhiều cấp — góc nhìn HR / quản lý */
export default function LeaveRequests({ employees, requests: allRequests, setRequests, toast }) {
  const { can, log, user } = useAccess()
  // Chỉ thấy đơn của nhân sự trong phạm vi được phân quyền
  const requests = allRequests.filter(r => employees.some(e => e.id === r.empId))
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('pending')
  const [open, setOpen] = useState(() => new Set(requests.filter(r => reqStatus(r) === 'pending').slice(0, 1).map(r => r.id))) // mở sẵn đơn chờ duyệt đầu tiên (id thật từ máy chủ)
  const [notes, setNotes] = useState({})

  const emp = id => employees.find(e => e.id === id)
  const cnt = s => requests.filter(r => (type === 'all' || r.type === type) && (s === 'all' || reqStatus(r) === s)).length
  const shown = requests.filter(r => (type === 'all' || r.type === type) && (status === 'all' || reqStatus(r) === status))

  function act(r, approve) {
    const note = (notes[r.id] || '').trim()
    if (!approve && !note) { toast('Vui lòng nhập lý do từ chối', 'danger'); return }
    setRequests(prev => prev.map(x => {
      if (x.id !== r.id) return x
      const i = x.steps.findIndex(s => s.state === 'active')
      const steps = x.steps.map((s, j) => {
        if (j === i) return { ...s, state: approve ? 'done' : 'rejected', time: nowLabel(), note: note || undefined }
        if (approve && j === i + 1) return { ...s, state: 'active' }
        return s
      })
      return { ...x, steps }
    }))
    setNotes(n => ({ ...n, [r.id]: '' }))
    const e = emp(r.empId)
    log('attendance', approve ? 'approve' : 'reject', `${REQUEST_TYPES[r.type].label} — ${e.name} (cấp ${r.steps.findIndex(s => s.state === 'active') + 1})`)
    toast(approve ? `Đã duyệt đơn của ${e.name}` : `Đã từ chối đơn của ${e.name}`, approve ? 'success' : 'danger')
  }
  const toggle = id => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="cc-stack">
      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Đơn từ & phê duyệt</h3><span className="cc-sub">Nhân viên gửi đơn từ Bàn làm việc · đơn đi lần lượt qua từng cấp duyệt</span></div>
          <span className="cc-grow" />
          <Seg value={type} onChange={setType} options={[{ value: 'all', label: 'Mọi loại' }, ...Object.entries(REQUEST_TYPES).map(([k, t]) => ({ value: k, label: t.label, icon: t.icon }))]} />
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
                    {active && can('attendance', 'approve') && r.empId !== user.id && (
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
    </div>
  )
}
