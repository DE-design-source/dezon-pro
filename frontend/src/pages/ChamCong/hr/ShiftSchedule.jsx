import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, WEEK_DAYS, TODAY_IDX, HR_TODAY, addDaysIso, shiftCodeOn } from '../../../data/hrData'
import { Avatar, Modal, Field, Empty } from './shared'
import { useAccess } from './access'

const TONES = ['primary', 'attendance', 'finance', 'qs', 'success', 'danger', 'marketing', 'sales']
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const shiftHours = s => Math.max(0, (toMin(s.end) - toMin(s.start) + (toMin(s.end) < toMin(s.start) ? 1440 : 0) - (Number(s.breakMin) || 0)) / 60)
const BLANK = { id: '', name: '', start: '08:00', end: '17:00', breakMin: 60, tone: 'primary', note: '' }

/* Ca làm việc (CRUD) + lịch làm việc: tuần lặp lại (gán ca theo thứ) hoặc tuần cụ thể (đổi ca / nghỉ riêng từng ngày,
   chọn lại đúng ca của lịch tuần thì bỏ lịch riêng). onSave(ops, okMsg) ghi lên máy chủ (POST /hr/shifts) rồi tải lại; trả Promise<boolean> */
export default function ShiftSchedule({ employees, shifts, schedule, overrides = {}, sites = [], onSave }) {
  const { canAll } = useAccess()
  const hr = canAll('attendance', 'edit') // ca & lịch là thiết lập cấp công ty
  const [editing, setEditing] = useState(null) // ca đang sửa / tạo mới
  const [siteForm, setSiteForm] = useState(null) // địa điểm đang sửa / tạo mới
  function saveSite() {
    const f = siteForm
    if (!f.name.trim()) return
    onSave({ sites: [{ ...f, name: f.name.trim(), orig: f.orig || f.name.trim() }] }, f.orig ? `Đã cập nhật ${f.name.trim()}` : `Đã thêm địa điểm ${f.name.trim()}`)
      .then(ok => ok && setSiteForm(null))
  }
  const [err, setErr] = useState('')
  const [dept, setDept] = useState('all')
  const [week, setWeek] = useState(null) // null = lịch tuần lặp lại; số = tuần cách tuần này
  const days = week == null ? null : WEEK_DAYS.map((_, i) => addDaysIso(HR_TODAY, i - TODAY_IDX + 7 * week))
  const dm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7)
  const isToday = i => (days ? days[i] === HR_TODAY : i === TODAY_IDX)
  const cell = (empId, i) => (days ? shiftCodeOn(empId, days[i], schedule, overrides) : schedule[empId]?.[i]) || 'off'
  const isOverride = (empId, i) => !!days && overrides[empId]?.[days[i]] !== undefined

  const staff = employees.filter(e => e.status !== 'left' && (dept === 'all' || e.dept === dept))
  const usage = id => Object.values(schedule).reduce((n, row) => n + row.filter(x => x === id).length, 0)

  function saveShift() {
    const s = editing
    const code = s.id.trim().toUpperCase()
    if (!code || !s.name.trim()) { setErr('Cần nhập mã ca và tên ca'); return }
    if (!s._orig && shifts.some(x => x.id === code)) { setErr('Mã ca đã tồn tại'); return }
    const { _orig, ...rec } = { ...s, id: code, name: s.name.trim(), breakMin: Number(s.breakMin) || 0 }
    // đổi mã ca: lịch tuần đi theo (máy chủ nối lịch với ca bằng id)
    onSave({ shifts: [{ ...rec, orig: _orig || code }] }, _orig ? `Đã cập nhật ca ${rec.name}` : `Đã thêm ca ${rec.name}`)
      .then(ok => ok && setEditing(null))
  }
  function removeShift(s) {
    const n = usage(s.id)
    if (!confirm(n ? `Ca "${s.name}" đang được gán ${n} lượt trong tuần. Xoá ca và chuyển các lượt đó thành "Nghỉ"?` : `Xoá ca "${s.name}"?`)) return
    onSave({ deleteShifts: [s.id] }, `Đã xoá ca ${s.name}`)
  }
  const assign = (empId, i, v) => (days
    ? onSave({ overrides: [{ empId, date: days[i], shift: v === (schedule[empId]?.[i] || 'off') ? '' : v }] })
    : onSave({ schedule: { [empId]: (schedule[empId] || WEEK_DAYS.map(() => 'off')).map((x, j) => (j === i ? v : x)) } }))
  const fillRow = empId => {
    const first = schedule[empId]?.[0] && schedule[empId][0] !== 'off' ? schedule[empId][0] : shifts[0]?.id
    if (first) onSave({ schedule: { [empId]: WEEK_DAYS.map((_, i) => (i < 5 ? first : 'off')) } })
  }

  return (
    <div className="cc-stack">
      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Địa điểm làm việc</h3><span className="cc-sub">Dùng cho nơi làm việc trong hồ sơ, chấm công GPS (toạ độ + bán kính) và phụ cấp công trường</span></div>
          <span className="cc-grow" />
          {hr && <button className="cc-btn ghost" onClick={() => setSiteForm({ name: '', lat: '', lng: '', radius: 200, isField: false })}><Icon name="plus" size={14} stroke={2.4} />Thêm địa điểm</button>}
        </div>
        {!sites.length ? <Empty text="Chưa có địa điểm nào" /> : (
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Địa điểm</th><th>Toạ độ GPS</th><th className="r">Bán kính</th><th>Loại</th><th /></tr></thead>
              <tbody>{sites.map(st => (
                <tr key={st.name}>
                  <td><b>{st.name}</b></td>
                  <td className="mono">{st.lat != null ? `${st.lat}, ${st.lng}` : <span className="cc-muted">Chưa có (không chấm GPS được)</span>}</td>
                  <td className="r mono">{st.radius} m</td>
                  <td>{st.isField ? 'Công trường' : 'Văn phòng / kho'}</td>
                  <td className="r">{hr && <><button className="cc-link-btn" onClick={() => setSiteForm({ ...st, lat: st.lat ?? '', lng: st.lng ?? '', orig: st.name })}>Sửa</button>
                    <button className="cc-link-btn danger" style={{ marginLeft: 12 }} onClick={() => { if (confirm(`Xoá địa điểm "${st.name}"? Hồ sơ đang ghi nơi làm việc này giữ nguyên tên.`)) onSave({ deleteSites: [st.name] }, `Đã xoá ${st.name}`) }}>Xoá</button></>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

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
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Lịch làm việc</h3><span className="cc-sub">{days ? 'Đổi ca / nghỉ riêng từng ngày (viền nét đứt) · chọn lại ca của lịch tuần để bỏ lịch riêng' : 'Lặp lại mỗi tuần · chọn ca trong từng ô để phân ca'} · tổng giờ tính tự động</span></div>
          <span className="cc-grow" />
          <button className={`cc-btn ${week == null ? '' : 'ghost'}`} onClick={() => setWeek(null)}>Lặp lại hằng tuần</button>
          <button className={`cc-btn ${week == null ? 'ghost' : ''}`} onClick={() => setWeek(w => w ?? 0)}>Tuần cụ thể</button>
          {days && <><button className="cc-icon-btn" title="Tuần trước" onClick={() => setWeek(w => w - 1)}>‹</button>
            <span className="cc-sub mono">{dm(days[0])} – {dm(days[6])}</span>
            <button className="cc-icon-btn" title="Tuần sau" disabled={week >= 8} onClick={() => setWeek(w => w + 1)}>›</button></>}
          <select className="cc-select" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="all">Tất cả phòng ban</option>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </div>
        {staff.length === 0 ? <Empty text="Không có nhân sự" /> : (
          <div className="cc-table-wrap">
            <table className="cc-table2 cc-sched">
              <thead><tr><th>Nhân viên</th>{WEEK_DAYS.map((d, i) => <th key={d.key} className={isToday(i) ? 'today' : ''}>{d.key}<span>{days ? dm(days[i]) : d.date}</span></th>)}<th className="r">Tổng giờ</th><th /></tr></thead>
              <tbody>
                {staff.map(e => {
                  const row = WEEK_DAYS.map((_, i) => cell(e.id, i))
                  const hours = row.reduce((h, id) => h + (shifts.find(s => s.id === id) ? shiftHours(shifts.find(s => s.id === id)) : 0), 0)
                  return (
                    <tr key={e.id}>
                      <td><div className="cc-person2"><Avatar emp={e} size={28} /><div><b>{e.name}</b><span>{e.position}</span></div></div></td>
                      {row.map((id, i) => {
                        const s = shifts.find(x => x.id === id)
                        return (
                          <td key={i} className={isToday(i) ? 'today' : ''}>
                            <label className={`cc-shift-pick ${s ? 'cc-tone-' + s.tone : 'off'}`} style={isOverride(e.id, i) ? { outline: '2px dashed var(--c, var(--primary))', outlineOffset: -2 } : undefined}
                              title={(isOverride(e.id, i) ? 'Lịch riêng ngày này · ' : '') + (s ? `${s.name} ${s.start}–${s.end} · bấm để đổi ca` : 'Nghỉ · bấm để phân ca')}>
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
                      <td className="r">{hr && !days && <button className="cc-link-btn" title="Áp dụng ca của T2 cho T2–T6" onClick={() => fillRow(e.id)}>T2→T6</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!siteForm} onClose={() => setSiteForm(null)} icon="mapPin" width={520} title={siteForm?.orig ? `Sửa ${siteForm.orig}` : 'Thêm địa điểm làm việc'}
        sub="Toạ độ lấy từ Google Maps (bấm chuột phải vào điểm -> sao chép toạ độ)"
        footer={<><span className="cc-grow" /><button className="cc-btn ghost" onClick={() => setSiteForm(null)}>Hủy</button><button className="cc-btn" onClick={saveSite}><Icon name="check" size={14} stroke={2.6} />Lưu</button></>}>
        {siteForm && (
          <div className="cc-form">
            <Field label="Tên địa điểm *" full><input value={siteForm.name} placeholder="VD: Văn phòng Hà Nội" onChange={e => setSiteForm({ ...siteForm, name: e.target.value })} /></Field>
            <Field label="Vĩ độ"><input inputMode="decimal" value={siteForm.lat} placeholder="10.8411" onChange={e => setSiteForm({ ...siteForm, lat: e.target.value })} /></Field>
            <Field label="Kinh độ"><input inputMode="decimal" value={siteForm.lng} placeholder="106.8099" onChange={e => setSiteForm({ ...siteForm, lng: e.target.value })} /></Field>
            <Field label="Bán kính chấm công (m)"><input type="number" min="10" value={siteForm.radius} onChange={e => setSiteForm({ ...siteForm, radius: e.target.value })} /></Field>
            <label className="cc-check-line"><input type="checkbox" checked={siteForm.isField} onChange={e => setSiteForm({ ...siteForm, isField: e.target.checked })} />Công trường (có phụ cấp công trường, lịch mẫu T2–T7)</label>
          </div>
        )}
      </Modal>
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

