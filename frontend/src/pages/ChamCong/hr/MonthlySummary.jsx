import { useMemo, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, MONTHS, monthlySummary, deptOf } from '../../../data/hrData'
import { Avatar, Empty, Pill, downloadCsv } from './shared'
import { useAccess } from './access'

const n1 = v => (Number.isInteger(v) ? v : v.toFixed(1)).toString().replace('.', ',')

/* Tổng hợp công & phép tồn theo tháng — chốt công, xuất CSV cho bộ phận lương */
export default function MonthlySummary({ employees, toast, locked, setLocked }) {
  const { can, log } = useAccess()
  const [month, setMonth] = useState(MONTHS[0].key)
  const [dept, setDept] = useState('all')
  const [q, setQ] = useState('')

  const all = useMemo(() => monthlySummary(employees, month), [employees, month])
  const t = q.trim().toLowerCase()
  const rows = all.filter(r => (dept === 'all' || r.emp.dept === dept) && (!t || r.emp.name.toLowerCase().includes(t)))
  const sum = k => rows.reduce((s, r) => s + r[k], 0)
  const label = MONTHS.find(m => m.key === month).label
  const isLocked = locked.has(month)

  function exportCsv() {
    downloadCsv(`tong-hop-cong-${month}.csv`, [
      ['Mã NV', 'Họ tên', 'Phòng ban', 'Công chuẩn', 'Công thực tế', 'Nghỉ phép (có lương)', 'Nghỉ không lương', 'Đi muộn (lần)', 'Về sớm (lần)', 'OT (giờ)', 'Tổng công tính lương', 'Phép năm định mức', 'Phép đã tích luỹ', 'Phép đã dùng', 'Phép còn lại'],
      ...rows.map(r => [r.emp.code, r.emp.name, deptOf(r.emp.dept).name, r.std, r.worked, r.paidLeave, r.unpaid, r.late, r.early, r.ot, r.total, r.yearQuota, r.accrued, r.used, r.remain]),
    ])
  }

  return (
    <div className="cc-stack">
      <div className="cc-kpis">
        <div className="cc-card cc-kpi2 cc-tone-attendance"><span className="cc-ico"><Icon name="calendar" size={15} /></span><div><span>Tổng công tính lương</span><b>{n1(sum('total'))}</b><em>{rows.length} nhân sự · {label}</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-qs"><span className="cc-ico"><Icon name="moon" size={15} /></span><div><span>Tổng giờ OT</span><b>{sum('ot')}</b><em>cần đối chiếu đơn OT đã duyệt</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-finance"><span className="cc-ico"><Icon name="clock" size={15} /></span><div><span>Đi muộn / về sớm</span><b>{sum('late') + sum('early')}</b><em>lượt trong tháng</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-success"><span className="cc-ico"><Icon name="sun" size={15} /></span><div><span>Phép tồn toàn công ty</span><b>{n1(sum('remain'))}</b><em>ngày phép năm chưa dùng</em></div></div>
      </div>

      <div className="cc-card cc-pad">
        <div className="cc-toolbar">
          <select className="cc-select strong" value={month} onChange={e => setMonth(e.target.value)}>{MONTHS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          {isLocked ? <Pill tone="success" dot>Đã chốt công</Pill> : <Pill tone="finance" dot>Đang mở — chưa chốt</Pill>}
          <span className="cc-grow" />
          <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm nhân viên..." value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="cc-select" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="all">Tất cả phòng ban</option>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
          {can('attendance', 'export') && <button className="cc-btn ghost" onClick={exportCsv}><Icon name="download" size={14} />Xuất CSV</button>}
          {!isLocked && can('attendance', 'approve') && employees.length > 1 && <button className="cc-btn" onClick={() => { if (confirm(`Chốt công ${label}? Sau khi chốt, số liệu được chuyển sang tính lương.`)) { setLocked(s => new Set(s).add(month)); log('attendance', 'approve', `Chốt công ${label}`); toast(`Đã chốt công ${label}`) } }}><Icon name="lock" size={14} />Chốt công</button>}
        </div>

        {rows.length === 0 ? <Empty text="Không có dữ liệu" /> : (
          <div className="cc-table-wrap">
            <table className="cc-table2 cc-sum">
              <thead>
                <tr className="group"><th rowSpan={2}>Nhân viên</th><th colSpan={8} className="c">Chấm công {label.toLowerCase()}</th><th colSpan={4} className="c">Phép năm {month.slice(0, 4)}</th></tr>
                <tr>
                  <th className="r">Công chuẩn</th><th className="r">Thực tế</th><th className="r">Phép</th><th className="r">Không lương</th>
                  <th className="r">Muộn</th><th className="r">Về sớm</th><th className="r">OT (h)</th><th className="r strong">Tổng công</th>
                  <th className="r">Định mức</th><th className="r">Tích luỹ</th><th className="r">Đã dùng</th><th>Còn lại</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.emp.id}>
                    <td><div className="cc-person2"><Avatar emp={r.emp} size={28} /><div><b>{r.emp.name}</b><span>{deptOf(r.emp.dept).name}{r.emp.status === 'probation' ? ' · thử việc' : ''}</span></div></div></td>
                    <td className="r mono">{r.std}</td><td className="r mono">{n1(r.worked)}</td>
                    <td className="r mono">{r.paidLeave || '·'}</td><td className={`r mono${r.unpaid ? ' cc-warn' : ''}`}>{r.unpaid || '·'}</td>
                    <td className={`r mono${r.late >= 2 ? ' cc-warn' : ''}`}>{r.late || '·'}</td><td className="r mono">{r.early || '·'}</td>
                    <td className="r mono">{r.ot || '·'}</td><td className="r mono strong">{n1(r.total)}</td>
                    <td className="r mono">{r.yearQuota}</td><td className="r mono">{n1(r.accrued)}</td><td className="r mono">{n1(r.used)}</td>
                    <td><div className="cc-leave-cell"><div className="cc-bar"><span style={{ width: `${r.accrued ? r.remain / r.accrued * 100 : 0}%` }} /></div><b className="mono">{n1(r.remain)}</b></div></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Tổng ({rows.length})</td><td className="r mono">—</td><td className="r mono">{n1(sum('worked'))}</td><td className="r mono">{sum('paidLeave')}</td><td className="r mono">{sum('unpaid')}</td><td className="r mono">{sum('late')}</td><td className="r mono">{sum('early')}</td><td className="r mono">{sum('ot')}</td><td className="r mono strong">{n1(sum('total'))}</td><td colSpan={3} /><td className="mono"><b>{n1(sum('remain'))}</b></td></tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="cc-sub" style={{ marginTop: 10 }}>Phép năm: 12 ngày/năm, +1 ngày cho mỗi 5 năm thâm niên, tích luỹ theo tháng; nhân sự thử việc chưa được tích luỹ phép.</div>
      </div>
    </div>
  )
}
