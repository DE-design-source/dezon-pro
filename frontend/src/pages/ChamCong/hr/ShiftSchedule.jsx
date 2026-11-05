import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, WEEK_DAYS } from '../../../data/hrData'
import { Avatar, Modal, Field, Empty } from './shared'
import { useAccess } from './access'

const TONES = ['primary', 'attendance', 'finance', 'qs', 'success', 'danger', 'marketing', 'sales']
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const shiftHours = s => Math.max(0, (toMin(s.end) - toMin(s.start) + (toMin(s.end) < toMin(s.start) ? 1440 : 0) - (Number(s.breakMin) || 0)) / 60)
const BLANK = { id: '', name: '', start: '08:00', end: '17:00', breakMin: 60, tone: 'primary', note: '' }

/* Ca làm việc (CRUD) + lịch làm việc theo tuần (gán ca cho từng nhân sự) */
export default function ShiftSchedule({ employees, shifts, setShifts, schedule, setSchedule, toast }) {
  const { can } = useAccess()
  const hr = can('attendance', 'edit')
  const [editing, setEditing] = useState(null) // ca đang sửa / tạo mới
  const [err, setErr] = useState('')
  const [dept, setDept] = useState('all')

  const staff = employees.filter(e => e.status !== 'left' && (dept === 'all' || e.dept === dept))
  const usage = id => Object.values(schedule).reduce((n, row) => n + row.filter(x => x === id).length, 0)

  function saveShift() {
    const s = editing
    const code = s.id.trim().toUpperCase()
    if (!code || !s.name.trim()) { setErr('Cần nhập mã ca và tên ca'); return }
    if (!s._orig && shifts.some(x => x.id === code)) { setErr('Mã ca đã tồn tại'); return }
    const rec = { ...s, id: code, name: s.name.trim(), breakMin: Number(s.breakMin) || 0 }
    delete rec._orig
    setShifts(prev => (s._orig ? prev.map(x => (x.id === s._orig ? rec : x)) : [...prev, rec]))
    if (s._orig && s._orig !== code) setSchedule(prev => Object.fromEntries(Object.entries(prev).map(([k, row]) => [k, row.map(x => (x === s._orig ? code : x))])))
    setEditing(null)
    toast(s._orig ? `Đã cập nhật ca ${rec.name}` : `Đã thêm ca ${rec.name}`)
  }
  function removeShift(s) {
    const n = usage(s.id)
    if (!confirm(n ? `Ca "${s.name}" đang được gán ${n} lượt trong tuần. Xoá ca và chuyển các lượt đó thành "Nghỉ"?` : `Xoá ca "${s.name}"?`)) return
    setShifts(prev => prev.filter(x => x.id !== s.id))
    setSchedule(prev => Object.fromEntries(Object.entries(prev).map(([k, row]) => [k, row.map(x => (x === s.id ? 'off' : x))])))
    toast(`Đã xoá ca ${s.name}`)
  }
  const assign = (empId, i, v) => setSchedule(prev => ({ ...prev, [empId]: (prev[empId] || WEEK_DAYS.map(() => 'off')).map((x, j) => (j === i ? v : x)) }))
  const fillRow = empId => { const first = schedule[empId]?.[0] || 'HC'; setSchedule(prev => ({ ...prev, [empId]: WEEK_DAYS.map((_, i) => (i < 5 ? first : 'off')) })) }

  return (
    <div className="cc-stack">
      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Ca làm việc</h3><span className="cc-sub">Định nghĩa giờ vào/ra, nghỉ giữa ca — dùng để xác định đi muộn, về sớm và tính công</span></div>
          <span className="cc-grow" />
          {hr && <button className="cc-btn" onClick={() => { setErr(''); setEditing({ ...BLANK }) }}><Icon name="plus" size={14} stroke={2.4} />Thêm ca</button>}
        </div>
        <div className="cc-shift-grid">
          {shifts.map(s => (
            <div key={s.id} className={`cc-shift cc-tone-${s.tone}`}>
              <div className="cc-shift-top"><span className="cc-shift-code">{s.id}</span><b>{s.name}</b>
                <span className="cc-grow" />
                {hr && <><button className="cc-icon-btn sm" title="Sửa ca" onClick={() => { setErr(''); setEditing({ ...s, _orig: s.id }) }}><Icon name="edit" size={13} /></button>
                <button className="cc-icon-btn sm danger" title="Xoá ca" onClick={() => removeShift(s)}><Icon name="trash" size={13} /></button></>}
              </div>
              <div className="cc-shift-time mono">{s.start} – {s.end}</div>
              <div className="cc-shift-meta"><span>{shiftHours(s).toFixed(1).replace('.0', '')} giờ công</span><span>Nghỉ {s.breakMin} phút</span><span>{usage(s.id)} lượt/tuần</span></div>
              {s.note && <div className="cc-sub">{s.note}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Lịch làm việc tuần {WEEK_DAYS[0].date} – {WEEK_DAYS[6].date}</h3><span className="cc-sub">Chọn ca trong từng ô để phân ca · tổng giờ được tính tự động</span></div>
          <span className="cc-grow" />
          <select className="cc-select" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="all">Tất cả phòng ban</option>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </div>
        {staff.length === 0 ? <Empty text="Không có nhân sự" /> : (
          <div className="cc-table-wrap">
            <table className="cc-table2 cc-sched">
              <thead><tr><th>Nhân viên</th>{WEEK_DAYS.map((d, i) => <th key={d.key} className={i === 2 ? 'today' : ''}>{d.key}<span>{d.date}</span></th>)}<th className="r">Tổng giờ</th><th /></tr></thead>
              <tbody>
                {staff.map(e => {
                  const row = schedule[e.id] || WEEK_DAYS.map(() => 'off')
                  const hours = row.reduce((h, id) => h + (shifts.find(s => s.id === id) ? shiftHours(shifts.find(s => s.id === id)) : 0), 0)
                  return (
                    <tr key={e.id}>
                      <td><div className="cc-person2"><Avatar emp={e} size={28} /><div><b>{e.name}</b><span>{e.position}</span></div></div></td>
                      {row.map((id, i) => {
                        const s = shifts.find(x => x.id === id)
                        return (
                          <td key={i} className={i === 2 ? 'today' : ''}>
                            <label className={`cc-shift-pick ${s ? 'cc-tone-' + s.tone : 'off'}`} title={s ? `${s.name} ${s.start}–${s.end} · bấm để đổi ca` : 'Nghỉ · bấm để phân ca'}>
                              {s ? <><b>{s.id}</b><small>{s.start}</small></> : 'Nghỉ'}
                              <select disabled={!hr} value={s ? id : 'off'} onChange={ev => assign(e.id, i, ev.target.value)} aria-label={`Ca ${WEEK_DAYS[i].key} của ${e.name}`}>
                                <option value="off">Nghỉ</option>
                                {shifts.map(x => <option key={x.id} value={x.id}>{x.id} · {x.name} ({x.start}–{x.end})</option>)}
                              </select>
                            </label>
                          </td>
                        )
                      })}
                      <td className={`r mono${hours > 48 ? ' cc-warn' : ''}`} title={hours > 48 ? 'Vượt 48 giờ/tuần theo Bộ luật Lao động' : ''}>{hours.toFixed(1).replace('.0', '')}h</td>
                      <td className="r">{hr && <button className="cc-link-btn" title="Áp dụng ca của T2 cho T2–T6" onClick={() => fillRow(e.id)}>T2→T6</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} icon="clock" width={520}
        title={editing?._orig ? `Sửa ca ${editing._orig}` : 'Thêm ca làm việc'} sub="Giờ công = giờ ra − giờ vào − thời gian nghỉ"
        footer={<>
          <span className="cc-grow cc-sub" style={{ color: err ? 'var(--danger)' : undefined }}>{err || (editing ? `≈ ${shiftHours(editing).toFixed(1)} giờ công / ca` : '')}</span>
          <button className="cc-btn ghost" onClick={() => setEditing(null)}>Hủy</button>
          <button className="cc-btn" onClick={saveShift}><Icon name="check" size={14} stroke={2.6} />Lưu ca</button>
        </>}>
        {editing && (
          <div className="cc-form">
            <Field label="Mã ca *"><input value={editing.id} maxLength={4} placeholder="VD: HC" onChange={e => setEditing({ ...editing, id: e.target.value })} /></Field>
            <Field label="Tên ca *"><input value={editing.name} placeholder="VD: Hành chính" onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Giờ vào"><input type="time" value={editing.start} onChange={e => setEditing({ ...editing, start: e.target.value })} /></Field>
            <Field label="Giờ ra"><input type="time" value={editing.end} onChange={e => setEditing({ ...editing, end: e.target.value })} /></Field>
            <Field label="Nghỉ giữa ca (phút)"><input type="number" min="0" step="15" value={editing.breakMin} onChange={e => setEditing({ ...editing, breakMin: e.target.value })} /></Field>
            <Field label="Màu hiển thị">
              <div className="cc-tone-pick">{TONES.map(t => <button type="button" key={t} className={`cc-tone-${t}${editing.tone === t ? ' active' : ''}`} onClick={() => setEditing({ ...editing, tone: t })} aria-label={t} />)}</div>
            </Field>
            <Field label="Ghi chú" full><input value={editing.note} placeholder="VD: Áp dụng cho đội thi công" onChange={e => setEditing({ ...editing, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

