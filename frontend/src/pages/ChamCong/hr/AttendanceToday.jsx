import { useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { SITES, HR_TODAY_LABEL, TODAY_IDX, attendanceStatus, lateMinutes } from '../../../data/hrData'
import { Avatar, Pill, Seg, Empty, downloadCsv } from './shared'
import { useAccess } from './access'

const SOURCE = {
  machine: { label: 'Máy chấm công', icon: 'fingerprint', tone: 'primary' },
  gps: { label: 'GPS di động', icon: 'mapPin', tone: 'attendance' },
  import: { label: 'Import Excel', icon: 'upload', tone: 'qs' },
  manual: { label: 'HR bổ sung', icon: 'edit', tone: 'finance' },
}
const ST = {
  ok: { label: 'Đúng giờ', tone: 'success' },
  late: { label: 'Đi muộn', tone: 'finance' },
  absent: { label: 'Chưa chấm công', tone: 'danger' },
  leave: { label: 'Nghỉ phép', tone: 'qs' },
  off: { label: 'Nghỉ theo lịch', tone: 'muted' },
}
const nowHM = () => new Date().toTimeString().slice(0, 5)

/* Khoảng cách (m) giữa 2 toạ độ — công thức haversine */
function distance(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

/* Bảng công hôm nay + các nguồn dữ liệu chấm công (máy chấm công / GPS / import) */
export default function AttendanceToday({ employees, logs, setLogs, shifts, schedule, toast, meId }) {
  const { can, log: audit } = useAccess()
  const hr = can('attendance', 'edit')
  const [filter, setFilter] = useState('all')
  const [site, setSite] = useState('all')
  const [q, setQ] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState('07:30')
  const [gpsBusy, setGpsBusy] = useState(false)
  const fileRef = useRef(null)

  const rows = useMemo(() => employees.filter(e => e.status !== 'left').map(e => {
    const shiftId = schedule[e.id]?.[TODAY_IDX] || 'off'
    const shift = shifts.find(s => s.id === shiftId)
    const log = logs.find(l => l.empId === e.id)
    const st = shiftId === 'off' && !log?.in ? 'off' : attendanceStatus(log, shift)
    return { e, shift, log, st }
  }), [employees, logs, shifts, schedule])

  const counts = rows.reduce((c, r) => { c[r.st] = (c[r.st] || 0) + 1; return c }, {})
  const outZone = rows.filter(r => r.log?.gps === 'out').length
  const present = (counts.ok || 0) + (counts.late || 0)
  const expected = rows.length - (counts.off || 0)

  const t = q.trim().toLowerCase()
  const shown = rows.filter(r =>
    (filter === 'all' || (filter === 'outzone' ? r.log?.gps === 'out' : r.st === filter)) &&
    (site === 'all' || r.e.site === site) && (!t || (r.e.name + ' ' + r.e.code).toLowerCase().includes(t)))

  function sync() {
    setSyncing(true)
    setTimeout(() => {
      // Giả lập: máy chấm công trả về lượt chấm của nhân sự đang "chưa chấm"
      const missing = rows.filter(r => r.st === 'absent' && r.e.site === 'Văn phòng HCM' && !r.log?.leave)
      setLogs(prev => prev.map(l => (missing.some(m => m.e.id === l.empId) ? { ...l, in: '08:12', source: 'machine' } : l)))
      setSyncing(false)
      setLastSync(nowHM())
      toast(missing.length ? `Đã đồng bộ ${missing.length} lượt chấm công mới từ máy chấm công` : 'Đã đồng bộ — không có lượt chấm mới')
    }, 1200)
  }

  /* Import CSV: mã NV, giờ vào, giờ ra */
  function onFile(ev) {
    const file = ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    if (!/\.csv$/i.test(file.name)) { toast('Bản prototype hỗ trợ file .csv (Excel → Lưu thành CSV UTF-8)', 'danger'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const lines = String(reader.result).replace(/^﻿/, '').split(/\r?\n/).map(l => l.split(/[,;]/).map(c => c.replace(/"/g, '').trim())).filter(c => c[0])
      let n = 0
      const next = [...logs]
      lines.forEach(([code, inT, outT]) => {
        const emp = employees.find(e => e.code.toLowerCase() === code.toLowerCase())
        if (!emp || !/^\d{1,2}:\d{2}$/.test(inT || '')) return
        n++
        const i = next.findIndex(l => l.empId === emp.id)
        const rec = { empId: emp.id, in: inT.padStart(5, '0'), out: /^\d{1,2}:\d{2}$/.test(outT || '') ? outT.padStart(5, '0') : null, source: 'import', gps: null }
        if (i >= 0) next[i] = { ...next[i], ...rec, leave: undefined }; else next.push(rec)
      })
      setLogs(next)
      toast(n ? `Đã import ${n} dòng chấm công từ ${file.name}` : 'Không tìm thấy dòng hợp lệ (cần: Mã NV, Giờ vào, Giờ ra)', n ? 'success' : 'danger')
    }
    reader.readAsText(file, 'utf-8')
  }

  /* Chấm công GPS cho chính mình: lấy vị trí, so với địa điểm làm việc */
  function gpsCheck() {
    const me = employees.find(e => e.id === meId)
    const target = SITES.find(s => s.name === me.site) || SITES[0]
    const mine = logs.find(l => l.empId === meId)
    const apply = (dist, real) => {
      const inZone = dist <= target.radius
      setLogs(prev => {
        const has = prev.some(l => l.empId === meId)
        const patch = mine?.in ? { out: nowHM() } : { in: nowHM() }
        const rec = { ...patch, source: 'gps', gps: inZone ? 'in' : 'out', dist }
        return has ? prev.map(l => (l.empId === meId ? { ...l, ...rec } : l)) : [...prev, { empId: meId, out: null, ...rec }]
      })
      setGpsBusy(false)
      toast(`${mine?.in ? 'Chấm ra' : 'Chấm vào'} lúc ${nowHM()} · ${inZone ? 'trong' : 'NGOÀI'} vùng ${target.name} (${dist.toLocaleString('vi-VN')} m${real ? '' : ', vị trí mô phỏng'})`, inZone ? 'success' : 'danger')
    }
    setGpsBusy(true)
    if (!navigator.geolocation) { apply(48, false); return }
    navigator.geolocation.getCurrentPosition(
      p => apply(distance({ lat: p.coords.latitude, lng: p.coords.longitude }, target), true),
      () => apply(48, false),
      { timeout: 6000, maximumAge: 60000 },
    )
  }

  function manualFix(r) {
    const v = prompt(`Bổ sung giờ vào cho ${r.e.name} (HH:MM):`, r.shift?.start || '08:00')
    if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return
    setLogs(prev => {
      const rec = { in: v.padStart(5, '0'), source: 'manual', gps: null, leave: undefined, note: 'HR bổ sung' }
      return prev.some(l => l.empId === r.e.id) ? prev.map(l => (l.empId === r.e.id ? { ...l, ...rec } : l)) : [...prev, { empId: r.e.id, out: null, ...rec }]
    })
    audit('attendance', 'edit', `Bổ sung chấm công ${v} — ${r.e.name}`)
    toast(`Đã bổ sung chấm công cho ${r.e.name}`)
  }

  const myLog = logs.find(l => l.empId === meId)

  return (
    <div className="cc-stack">
      <div className="cc-kpis five">
        <div className="cc-card cc-kpi2 cc-tone-attendance"><span className="cc-ico"><Icon name="users" size={15} /></span><div><span>Có mặt</span><b>{present}<small>/{expected}</small></b><em>{Math.round(present / Math.max(1, expected) * 100)}% chuyên cần</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-finance"><span className="cc-ico"><Icon name="clock" size={15} /></span><div><span>Đi muộn</span><b>{counts.late || 0}</b><em>so với giờ vào ca</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-danger"><span className="cc-ico"><Icon name="alert" size={15} /></span><div><span>Chưa chấm công</span><b>{counts.absent || 0}</b><em>cần liên hệ / bổ sung</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-qs"><span className="cc-ico"><Icon name="calendar" size={15} /></span><div><span>Nghỉ phép</span><b>{counts.leave || 0}</b><em>đơn đã duyệt</em></div></div>
        <div className={`cc-card cc-kpi2 cc-tone-${outZone ? 'danger' : 'muted'}`}><span className="cc-ico"><Icon name="mapPin" size={15} /></span><div><span>Ngoài vùng GPS</span><b>{outZone}</b><em>cần xác minh</em></div></div>
      </div>

      <div className="cc-sources">
        <div className="cc-card cc-source">
          <span className="cc-ico cc-tone-primary"><Icon name="fingerprint" size={16} /></span>
          <div className="cc-grow"><b>Máy chấm công (API)</b><span>3 thiết bị · đồng bộ lần cuối {lastSync}</span></div>
          <button className="cc-btn ghost" onClick={sync} disabled={syncing || !hr} title={hr ? '' : 'Cần quyền sửa chấm công'}><Icon name="refresh" size={14} className={syncing ? 'spin' : ''} />{syncing ? 'Đang đồng bộ...' : 'Đồng bộ'}</button>
        </div>
        <div className="cc-card cc-source">
          <span className="cc-ico cc-tone-qs"><Icon name="upload" size={16} /></span>
          <div className="cc-grow"><b>Import Excel / CSV</b><span>Cột: Mã NV, Giờ vào, Giờ ra · <button className="cc-link-btn" onClick={() => downloadCsv('mau-cham-cong.csv', [['Mã NV', 'Giờ vào', 'Giờ ra'], ['NV015', '07:05', '16:35'], ['NV016', '06:58', '16:40']])}>Tải file mẫu</button></span></div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={onFile} />
          <button className="cc-btn ghost" onClick={() => fileRef.current.click()} disabled={!hr} title={hr ? '' : 'Cần quyền sửa chấm công'}><Icon name="upload" size={14} />Chọn file</button>
        </div>
        <div className="cc-card cc-source">
          <span className="cc-ico cc-tone-attendance"><Icon name="mapPin" size={16} /></span>
          <div className="cc-grow"><b>Chấm công GPS (của bạn)</b><span>{myLog?.in ? `Đã vào ${myLog.in}${myLog.out ? ' · ra ' + myLog.out : ''}` : 'Chưa chấm công hôm nay'}</span></div>
          <button className="cc-btn" onClick={gpsCheck} disabled={gpsBusy}><Icon name="mapPin" size={14} />{gpsBusy ? 'Đang định vị...' : myLog?.in ? 'Chấm ra' : 'Chấm vào'}</button>
        </div>
      </div>

      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <div><h3 className="cc-h3" style={{ margin: 0 }}>Bảng công hôm nay</h3><span className="cc-sub">{HR_TODAY_LABEL}</span></div>
          <span className="cc-grow" />
          <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm nhân viên..." value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="cc-select" value={site} onChange={e => setSite(e.target.value)}>
            <option value="all">Mọi địa điểm</option>{SITES.map(s => <option key={s.name}>{s.name}</option>)}
          </select>
        </div>
        <Seg value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'Tất cả', count: rows.length },
          { value: 'ok', label: 'Đúng giờ', count: counts.ok || 0 },
          { value: 'late', label: 'Đi muộn', count: counts.late || 0 },
          { value: 'absent', label: 'Chưa chấm', count: counts.absent || 0 },
          { value: 'leave', label: 'Nghỉ phép', count: counts.leave || 0 },
          { value: 'outzone', label: 'Ngoài vùng', count: outZone },
        ]} />
        {shown.length === 0 ? <Empty text="Không có nhân sự phù hợp" /> : (
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Nhân viên</th><th>Ca hôm nay</th><th>Giờ vào</th><th>Giờ ra</th><th>Nguồn</th><th>Vị trí</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {shown.map(({ e, shift, log, st }) => {
                  const src = log?.source && SOURCE[log.source]
                  return (
                    <tr key={e.id}>
                      <td><div className="cc-person2"><Avatar emp={e} /><div><b>{e.name}</b><span>{e.site}</span></div></div></td>
                      <td>{shift ? <Pill tone={shift.tone}>{shift.name} {shift.start}–{shift.end}</Pill> : <span className="cc-muted">Nghỉ</span>}</td>
                      <td className="mono">{log?.in || '—'}</td>
                      <td className="mono">{log?.out || '—'}</td>
                      <td>{src ? <span className={`cc-src cc-tone-${src.tone}`} title={log.note || src.label}><Icon name={src.icon} size={12} />{src.label}</span> : <span className="cc-muted">—</span>}</td>
                      <td>{log?.gps === 'in' && <span className="cc-gps ok"><Icon name="mapPin" size={12} />Trong vùng · {log.dist} m</span>}
                        {log?.gps === 'out' && <span className="cc-gps out"><Icon name="alert" size={12} />Ngoài vùng · {(log.dist / 1000).toFixed(1)} km</span>}
                        {!log?.gps && <span className="cc-muted">—</span>}</td>
                      <td><Pill tone={ST[st].tone} dot>{st === 'late' ? `Muộn ${lateMinutes(log.in, shift.start)} phút` : st === 'leave' ? log.leave : ST[st].label}</Pill></td>
                      <td className="r">{st === 'absent' && hr && <button className="cc-link-btn" onClick={() => manualFix({ e, shift })}>Bổ sung</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
