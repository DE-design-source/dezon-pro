import { useMemo, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { MONTHS, monthlySummary, deptOf, isFieldSite } from '../../../data/hrData'
import { PAYROLL_STATUS } from '../../../data/hrData2'
import { Avatar, Pill, Seg, Modal, Field, Empty, downloadCsv } from './shared'
import { useAccess, NoAccess } from './access'
import FixedCostTab from './FixedCostTab'

const vnd = v => Math.round(v).toLocaleString('vi-VN')
const pct = v => (v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + '%'

/* Thuế TNCN luỹ tiến từng phần theo bậc */
export function progressiveTax(income, brackets) {
  let tax = 0, prev = 0
  for (const b of brackets) {
    const top = b.upTo ?? Infinity
    if (income <= prev) break
    tax += (Math.min(income, top) - prev) * b.rate
    prev = top
  }
  return Math.max(0, tax)
}

/* Tính lương 1 nhân viên trong tháng theo cấu hình */
/* Mỗi vị trí trong phân bổ 1 màu riêng: giữ màu đơn vị nếu chưa trùng, trùng thì lấy màu kế tiếp chưa dùng */
const ALLOC_TONES = ['primary', 'attendance', 'finance', 'marketing', 'success', 'sales', 'qs', 'danger', 'muted']
export function distinctTones(parts) {
  const used = new Set()
  return parts.map(p => {
    const tone = !used.has(p.tone) ? p.tone : ALLOC_TONES.find(t => !used.has(t)) || p.tone
    used.add(tone)
    return tone === p.tone ? p : { ...p, tone }
  })
}

/* Tỉ trọng phân bổ chi phí lương: phòng ban chính + các ban kiêm nhiệm */
export function allocationOf(emp, conc = []) {
  const used = conc.reduce((s, c) => s + c.pct, 0)
  const home = deptOf(emp.dept)
  return distinctTones([{ key: emp.dept, label: home.name, short: home.name, tone: home.tone, pct: 100 - used }, ...conc.map(c => ({ key: c.unit.key, label: c.unit.name, short: c.unit.label, tone: c.unit.tone, pct: c.pct, title: c.title, allowance: Number(c.allowance) || 0 }))])
}

export function calcPay(emp, att, adj = [], cfg, conc = []) {
  const base = Number(emp.salary) || 0
  const ratio = att.std ? att.total / att.std : 0
  const basePay = base * ratio
  const lunch = att.worked > 0 ? cfg.lunch : 0
  const phone = cfg.phoneByLevel[emp.level] || 0
  const site = isFieldSite(emp.site) ? cfg.siteAllowance : 0 // phụ cấp công trường theo địa điểm (Ca & lịch làm việc)
  const otPay = att.std ? att.ot * (base / att.std / 8) * cfg.otRate : 0 // không có ngày công chuẩn (lịch toàn nghỉ) -> không tính được đơn giá giờ
  const bonus = adj.filter(a => a.kind === 'bonus').reduce((s, a) => s + a.amount, 0)
  const penalty = adj.filter(a => a.kind === 'penalty').reduce((s, a) => s + a.amount, 0)
  const sales = adj.filter(a => a.kind === 'sales').reduce((s, a) => s + a.amount, 0)
  const commission = sales * cfg.commissionRate
  const concAllowance = conc.reduce((s, c) => s + (Number(c.allowance) || 0), 0)
  const gross = basePay + lunch + phone + site + otPay + bonus + commission + concAllowance - penalty
  const insured = !!emp.insurance?.since
  const insBase = insured ? Math.min(Number(emp.insurance.base) || base, cfg.insCap) : 0
  const ins = { bhxh: insBase * cfg.emp.bhxh, bhyt: insBase * cfg.emp.bhyt, bhtn: insBase * cfg.emp.bhtn }
  const empIns = ins.bhxh + ins.bhyt + ins.bhtn
  const comBreak = { bhxh: insBase * cfg.com.bhxh, bhyt: insBase * cfg.com.bhyt, bhtn: insBase * cfg.com.bhtn }
  const comIns = comBreak.bhxh + comBreak.bhyt + comBreak.bhtn
  const deduction = cfg.personalDeduction + (emp.tax?.dependents || 0) * cfg.dependentDeduction
  const taxable = Math.max(0, gross - Math.min(lunch, 730000) - empIns - deduction)
  const pit = progressiveTax(taxable, cfg.brackets)
  const net = gross - empIns - pit
  const cost = gross + comIns
  const alloc = allocationOf(emp, conc).map(a => ({ ...a, amount: cost * a.pct / 100 }))
  return { comBreak, alloc, concAllowance, base, ratio, basePay, lunch, phone, site, otPay, bonus, penalty, sales, commission, gross, insBase, ins, empIns, comIns, deduction, taxable, pit, net, cost }
}

/* Bảng phân bổ chi tiết: mọi khoản trong bảng lương (thu nhập, BH NLĐ, BH công ty, thuế...) chia theo tỉ trọng kiêm nhiệm.
   Cột 100% là tổng giá trị của khoản đó; các cột đơn vị = 100% × tỉ lệ của đơn vị. */
export function AllocationMatrix({ p, title = 'Phân bổ chi tiết theo khoản lương', sub }) {
  const v = n => Math.round(n).toLocaleString('vi-VN')
  const groups = [
    { label: 'Thu nhập', rows: [
      ['Lương theo công', p.basePay], ['Phụ cấp (ăn trưa, điện thoại, công trường)', p.lunch + p.phone + p.site],
      ['Phụ cấp kiêm nhiệm', p.concAllowance], ['Làm thêm giờ (OT)', p.otPay], ['Thưởng / hoa hồng / phạt', p.bonus + p.commission - p.penalty],
      ['Tổng thu nhập (Gross)', p.gross, 'sum'],
    ] },
    { label: 'Người lao động đóng / khấu trừ', rows: [
      ['BHXH NLĐ (8%)', p.ins.bhxh], ['BHYT NLĐ (1,5%)', p.ins.bhyt], ['BHTN NLĐ (1%)', p.ins.bhtn], ['Thuế TNCN', p.pit],
      ['Thực nhận', p.net, 'sum'],
    ] },
    { label: 'Công ty đóng', rows: [
      ['BHXH công ty (17,5%)', p.comBreak.bhxh], ['BHYT công ty (3%)', p.comBreak.bhyt], ['BHTN công ty (1%)', p.comBreak.bhtn],
      ['Tổng chi phí công ty (Gross + BH công ty)', p.cost, 'total'],
    ] },
  ]
  return (
    <div className="cc-matrix-wrap">
      <div className="cc-row-between" style={{ marginBottom: 8 }}>
        <div><b className="cc-matrix-title">{title}</b>{sub && <div className="cc-sub">{sub}</div>}</div>
        <div className="cc-matrix-total"><span>100% =</span><b className="mono">{v(p.cost)} đ</b></div>
      </div>
      <div className="cc-table-wrap">
        <table className="cc-table2 compact cc-alloc-matrix">
          <thead><tr>
            <th>Khoản</th><th className="r">Tổng · 100%</th>
            {p.alloc.map(a => <th key={a.key} className="r"><span className="cc-alloc-name"><i className={`cc-dot cc-tone-${a.tone}`} />{a.short}</span><em>{a.pct}%</em></th>)}
          </tr></thead>
          <tbody>
            {groups.map(g => [
              <tr key={g.label} className="grp"><td colSpan={2 + p.alloc.length}>{g.label}</td></tr>,
              ...g.rows.filter(([, val, kind]) => kind || Math.round(val) !== 0).map(([label, val, kind]) => (
                <tr key={g.label + label} className={kind || ''}>
                  <td>{label}</td><td className="r mono">{v(val)}</td>
                  {p.alloc.map(a => <td key={a.key} className="r mono">{v(val * a.pct / 100)}</td>)}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* Phiếu lương (dùng chung cho modal & màn hình của nhân viên) */
function Payslip({ emp, att, p, monthLabel, adj }) {
  const Line = ({ k, v, neg, strong }) => <div className={`cc-ps-line${strong ? ' strong' : ''}`}><span>{k}</span><b className="mono">{neg ? '−' : ''}{vnd(v)}</b></div>
  return (
    <div className="cc-payslip">
      <div className="cc-ps-head">
        <div><div className="cc-kicker">PHIẾU LƯƠNG · {monthLabel.toUpperCase()}</div><h3>{emp.name}</h3><span className="cc-sub">{emp.code} · {emp.position} · {deptOf(emp.dept).name}</span></div>
        <div className="cc-ps-net"><span>Thực nhận</span><b className="mono">{vnd(p.net)} đ</b></div>
      </div>
      <div className="cc-ps-grid">
        <div>
          <h4>Thu nhập</h4>
          <Line k={`Lương theo công (${att.total}/${att.std} công × ${vnd(p.base)})`} v={p.basePay} />
          {p.lunch > 0 && <Line k="Phụ cấp ăn trưa" v={p.lunch} />}
          {p.phone > 0 && <Line k="Phụ cấp điện thoại / xăng xe" v={p.phone} />}
          {p.site > 0 && <Line k="Phụ cấp công trường" v={p.site} />}
          {p.otPay > 0 && <Line k={`Làm thêm giờ (${att.ot} giờ)`} v={p.otPay} />}
          {p.commission > 0 && <Line k={`Hoa hồng (doanh số ${vnd(p.sales)})`} v={p.commission} />}
          {p.alloc.filter(a => a.allowance).map(a => <Line key={a.key} k={`Phụ cấp kiêm nhiệm — ${a.short} (${a.title})`} v={a.allowance} />)}
          {adj.filter(a => a.kind === 'bonus').map((a, i) => <Line key={i} k={`Thưởng: ${a.label}`} v={a.amount} />)}
          {adj.filter(a => a.kind === 'penalty').map((a, i) => <Line key={i} k={`Phạt: ${a.label}`} v={a.amount} neg />)}
          <Line k="Tổng thu nhập (Gross)" v={p.gross} strong />
        </div>
        <div>
          <h4>Khấu trừ</h4>
          {p.insBase ? <>
            <Line k="BHXH 8%" v={p.ins.bhxh} neg /><Line k="BHYT 1,5%" v={p.ins.bhyt} neg /><Line k="BHTN 1%" v={p.ins.bhtn} neg />
          </> : <div className="cc-sub" style={{ padding: '6px 0' }}>Chưa tham gia bảo hiểm (thử việc)</div>}
          <Line k={`Thuế TNCN (thu nhập tính thuế ${vnd(p.taxable)})`} v={p.pit} neg />
          <Line k="Tổng khấu trừ" v={p.empIns + p.pit} strong />
          <div className="cc-ps-note">Giảm trừ gia cảnh: {vnd(p.deduction)} đ ({emp.tax?.dependents || 0} người phụ thuộc)<br />Công ty đóng BH: {vnd(p.comIns)} đ (không trừ vào lương)</div>
        </div>
      </div>
      {p.alloc.length > 1 && <AllocationMatrix p={p} title="Phân bổ theo đơn vị (kiêm nhiệm)" sub={`Mọi khoản trong phiếu lương được chia theo tỉ trọng: ${p.alloc.map(a => `${a.short} ${a.pct}%`).join(' · ')}`} />}
    </div>
  )
}

const TABS = [
  { value: 'run', label: 'Bảng lương', icon: 'table' },
  { value: 'ins', label: 'Bảo hiểm & thuế', icon: 'shield' },
  { value: 'fixed', label: 'Định phí theo phòng ban', icon: 'building' },
  { value: 'config', label: 'Cấu hình công thức', icon: 'layers' },
]

/* Phân hệ "Lương & bảo hiểm" */
/* payroll = { config, adjustments, runs, fixed } từ máy chủ; pay = thao tác ghi (ChamCong.jsx):
   addAdj(empId, tháng, {kind, label, amount}), removeAdj(id), run(tháng, action, payslips, okMsg), setCfg(patch), setFixed(unitKey, {fund, items}).
   Kỳ lương đã duyệt hiển thị bản chụp phiếu lương lưu lúc duyệt, không tính lại. */
export default function PayrollModule({ employees, units = [], concurrentOf = () => [], payroll, pay, maskDefault }) {
  const { can, canAll, user, role, log } = useAccess()
  const [tab, setTab] = useState('run')
  const [month, setMonth] = useState(MONTHS[0].key)
  const [q, setQ] = useState('')
  const [slip, setSlip] = useState(null)
  const [adjFor, setAdjFor] = useState(null)
  const [newAdj, setNewAdj] = useState({ kind: 'bonus', label: '', amount: '' })
  const [show, setShow] = useState(!maskDefault)
  const { config: cfg, adjustments, runs } = payroll
  const run = runs[month] || { status: 'draft' }
  const monthLabel = MONTHS.find(m => m.key === month).label

  const rows = useMemo(() => (run.payslips
    ? Object.entries(run.payslips).map(([id, x]) => { const emp = employees.find(e => e.id === Number(id)); return emp && { emp, att: { ...x.att, emp }, adj: x.adj || [], p: x.p } }).filter(Boolean)
    : monthlySummary(employees, month).map(att => {
      const adj = adjustments[month]?.[att.emp.id] || []
      return { emp: att.emp, att, adj, p: calcPay(att.emp, att, adj, cfg, concurrentOf(att.emp.id)) }
    })), [employees, month, adjustments, cfg, concurrentOf, run.payslips])

  if (!can('payroll', 'view')) return <NoAccess />

  /* Nhân viên: chỉ xem phiếu lương của mình */
  if (role === 'employee') {
    const mine = rows.find(r => r.emp.id === user.id)
    return (
      <div className="cc-stack">
        <div className="cc-toolbar">
          <select className="cc-select strong" value={month} onChange={e => setMonth(e.target.value)}>{MONTHS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          <Pill tone={PAYROLL_STATUS[run.status].tone} dot>{PAYROLL_STATUS[run.status].label}</Pill>
          <span className="cc-grow" /><button className="cc-btn ghost" onClick={() => window.print()}><Icon name="download" size={14} />In / lưu PDF</button>
        </div>
        {mine && run.status !== 'draft' ? <div className="cc-card cc-pad cc-print"><Payslip emp={mine.emp} att={mine.att} p={mine.p} adj={mine.adj} monthLabel={monthLabel} /></div>
          : <Empty icon="wallet" text="Phiếu lương tháng này chưa được phát hành" />}
      </div>
    )
  }

  const t = q.trim().toLowerCase()
  const shown = rows.filter(r => !t || r.emp.name.toLowerCase().includes(t))
  const sum = k => rows.reduce((s, r) => s + r.p[k], 0)
  const money = v => (show ? vnd(v) : '••••••')

  /* Duyệt: lưu bản chụp phiếu lương (công, các khoản) + chốt công tháng đó */
  function approve() {
    if (!confirm(`Duyệt bảng lương ${monthLabel}? Tổng chi ${vnd(sum('net'))} đ. Số liệu được chụp lại và chốt công tháng này.`)) return
    const payslips = Object.fromEntries(rows.map(({ emp, att, adj, p }) => {
      const { emp: _e, ...a } = att
      return [emp.id, { emp: { id: emp.id, code: emp.code, name: emp.name, dept: emp.dept, position: emp.position }, att: a, adj, p }]
    }))
    pay.run(month, 'approve', payslips, `Đã duyệt bảng lương ${monthLabel}`).then(ok => ok && log('payroll', 'approve', `Duyệt bảng lương ${monthLabel}`))
  }
  /* Chưa có gửi email / chuyển khoản: chỉ ghi nhận đã chi trả */
  function markPaid() {
    if (!confirm(`Đánh dấu đã chi trả bảng lương ${monthLabel} (${rows.length} người)?`)) return
    pay.run(month, 'pay', null, `Đã đánh dấu chi trả bảng lương ${monthLabel}`).then(ok => ok && log('payroll', 'edit', `Chi trả bảng lương ${monthLabel}`))
  }
  function exportCsv() {
    downloadCsv(`bang-luong-${month}.csv`, [
      ['Mã NV', 'Họ tên', 'Lương cơ bản', 'Công', 'Lương theo công', 'Phụ cấp', 'Phụ cấp kiêm nhiệm', 'OT', 'Thưởng', 'Hoa hồng', 'Phạt', 'Gross', 'BHXH', 'BHYT', 'BHTN', 'Thuế TNCN', 'Thực nhận', 'Công ty đóng BH', 'Tỉ trọng phân bổ'],
      ...rows.map(({ emp, att, p }) => [emp.code, emp.name, p.base, att.total, Math.round(p.basePay), p.lunch + p.phone + p.site, p.concAllowance, Math.round(p.otPay), p.bonus, Math.round(p.commission), p.penalty, Math.round(p.gross), Math.round(p.ins.bhxh), Math.round(p.ins.bhyt), Math.round(p.ins.bhtn), Math.round(p.pit), Math.round(p.net), Math.round(p.comIns), p.alloc.map(a => `${a.short} ${a.pct}%`).join('; ')]),
    ])
    log('payroll', 'export', `Bảng lương ${monthLabel} (CSV)`)
  }
  function addAdj() {
    const amount = Number(String(newAdj.amount).replace(/\D/g, ''))
    if (!newAdj.label.trim() || !amount) return
    pay.addAdj(adjFor.id, month, { kind: newAdj.kind, label: newAdj.label.trim(), amount }).then(ok => {
      if (!ok) return
      log('payroll', 'edit', `${newAdj.kind === 'penalty' ? 'Phạt' : newAdj.kind === 'sales' ? 'Doanh số' : 'Thưởng'} ${vnd(amount)} — ${adjFor.name}`)
      setNewAdj({ kind: 'bonus', label: '', amount: '' })
    })
  }
  const removeAdj = i => pay.removeAdj(adjList[i].id)
  const setCfg = pay.setCfg
  const editable = canAll('payroll', 'edit') && run.status === 'draft'
  const slipRow = slip && rows.find(r => r.emp.id === slip)
  const adjList = adjFor ? adjustments[month]?.[adjFor.id] || [] : []

  return (
    <div className="cc-stack">
      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={tab} onChange={setTab} options={TABS} />
        <span className="cc-grow" />
        <select className="cc-select strong" value={month} onChange={e => setMonth(e.target.value)}>{MONTHS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
        <button className="cc-btn ghost" onClick={() => setShow(s => !s)} title={show ? 'Ẩn số tiền' : 'Hiện số tiền'}><Icon name={show ? 'lock' : 'search'} size={14} />{show ? 'Ẩn số tiền' : 'Hiện số tiền'}</button>
      </div>

      {tab === 'run' && <>
        <div className="cc-kpis">
          <div className="cc-card cc-kpi2 cc-tone-primary"><span className="cc-ico"><Icon name="wallet" size={15} /></span><div><span>Tổng quỹ lương (Gross)</span><b>{money(sum('gross'))}</b><em>{rows.length} nhân sự · {monthLabel}</em></div></div>
          <div className="cc-card cc-kpi2 cc-tone-success"><span className="cc-ico"><Icon name="checkCircle" size={15} /></span><div><span>Tổng thực nhận</span><b>{money(sum('net'))}</b><em>sau BH & thuế TNCN</em></div></div>
          <div className="cc-card cc-kpi2 cc-tone-finance"><span className="cc-ico"><Icon name="shield" size={15} /></span><div><span>BH + thuế khấu trừ</span><b>{money(sum('empIns') + sum('pit'))}</b><em>NLĐ đóng {money(sum('empIns'))} · TNCN {money(sum('pit'))}</em></div></div>
          <div className="cc-card cc-kpi2 cc-tone-qs"><span className="cc-ico"><Icon name="building" size={15} /></span><div><span>Tổng chi phí công ty</span><b>{money(sum('cost'))}</b><em>gồm BH công ty đóng 21,5%</em></div></div>
        </div>

        <div className="cc-card cc-pad">
          <div className="cc-steps-bar">
            {['draft', 'approved', 'paid'].map((s, i) => {
              const idx = ['draft', 'approved', 'paid'].indexOf(run.status)
              return <div key={s} className={`cc-step-item${i < idx ? ' done' : i === idx ? ' current' : ''}`}><span>{i < idx ? <Icon name="check" size={11} stroke={3} /> : i + 1}</span>{['Tính lương (nháp)', 'Duyệt bảng lương', 'Chi trả'][i]}</div>
            })}
            <span className="cc-grow" />
            {can('payroll', 'export') && <button className="cc-btn ghost" onClick={exportCsv}><Icon name="download" size={14} />Xuất CSV</button>}
            {run.status === 'draft' && canAll('payroll', 'approve') && <button className="cc-btn" onClick={approve}><Icon name="check" size={14} stroke={2.6} />Duyệt bảng lương</button>}
            {run.status === 'approved' && canAll('payroll', 'approve') && <button className="cc-btn" onClick={markPaid}><Icon name="check" size={14} />Đánh dấu đã chi trả</button>}
            {run.status !== 'draft' && canAll('payroll', 'edit') && <button className="cc-link-btn" onClick={() => pay.run(month, 'reopen', null, `Đã mở lại bảng lương ${monthLabel}`).then(ok => ok && log('payroll', 'edit', `Mở lại bảng lương ${monthLabel}`))}>Mở lại</button>}
          </div>
          <div className="cc-toolbar" style={{ marginTop: 12 }}>
            <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm nhân viên..." value={q} onChange={e => setQ(e.target.value)} /></label>
            <span className="cc-sub">Lương theo công = lương cơ bản × công thực tế / công chuẩn · bấm vào dòng để xem phiếu lương</span>
          </div>
          {shown.length === 0 ? <Empty text="Không có dữ liệu" /> : (
            <div className="cc-table-wrap">
              <table className="cc-table2 hover cc-pay">
                <thead><tr><th>Nhân viên</th><th className="r">Lương CB</th><th className="r">Công</th><th className="r">Phụ cấp</th><th className="r">OT</th><th className="r">Thưởng / HH / phạt</th><th className="r">Gross</th><th className="r">BH NLĐ</th><th className="r">Thuế TNCN</th><th className="r strong">Thực nhận</th><th>Tỉ trọng phân bổ</th><th /></tr></thead>
                <tbody>
                  {shown.map(({ emp, att, p }) => {
                    const extra = p.bonus + p.commission - p.penalty
                    return (
                      <tr key={emp.id} onClick={() => setSlip(emp.id)}>
                        <td><div className="cc-person2"><Avatar emp={emp} size={28} /><div><b>{emp.name}</b><span>{emp.position}</span></div></div></td>
                        <td className="r mono">{money(p.base)}</td>
                        <td className="r mono">{att.total}/{att.std}</td>
                        <td className="r mono">{money(p.lunch + p.phone + p.site)}</td>
                        <td className="r mono">{p.otPay ? money(p.otPay) : '·'}</td>
                        <td className={`r mono${extra < 0 ? ' cc-warn' : ''}`}>{extra ? (extra > 0 ? '+' : '−') + money(Math.abs(extra)) : '·'}</td>
                        <td className="r mono">{money(p.gross)}</td>
                        <td className="r mono">{p.empIns ? money(p.empIns) : '·'}</td>
                        <td className="r mono">{p.pit ? money(p.pit) : '·'}</td>
                        <td className="r mono strong">{money(p.net)}</td>
                        <td>
                          <div className="cc-alloc-cell" title={p.alloc.map(a => `${a.label}: ${a.pct}%`).join('\n')}>
                            <div className="cc-alloc-bar small">{p.alloc.filter(a => a.pct > 0).map(a => <span key={a.key} className={`cc-tone-${a.tone}`} style={{ flex: a.pct }} />)}</div>
                            <span>{p.alloc.length > 1 ? p.alloc.map(a => `${a.short} ${a.pct}%`).join(' · ') : '100% ' + p.alloc[0].short}</span>
                          </div>
                        </td>
                        <td className="r" onClick={e => e.stopPropagation()}>
                          {run.status === 'paid' ? <span className="cc-gps ok"><Icon name="check" size={12} />Đã chi trả</span>
                            : editable && <button className="cc-link-btn" onClick={() => setAdjFor(emp)}>± Điều chỉnh</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot><tr><td>Tổng ({rows.length})</td><td colSpan={5} /><td className="r mono">{money(sum('gross'))}</td><td className="r mono">{money(sum('empIns'))}</td><td className="r mono">{money(sum('pit'))}</td><td className="r mono strong">{money(sum('net'))}</td><td /><td /></tr></tfoot>
              </table>
            </div>
          )}
        </div>
      </>}

      {tab === 'run' && (() => {
        const byUnit = {}
        rows.forEach(({ p }) => p.alloc.forEach(a => {
          const u = byUnit[a.key] || (byUnit[a.key] = { ...a, amount: 0, people: 0, fte: 0 })
          u.amount += a.amount; u.people += 1; u.fte += a.pct / 100
        }))
        const list = Object.values(byUnit).sort((a, b) => b.amount - a.amount)
        const totalCost = list.reduce((s, u) => s + u.amount, 0)
        return (
          <div className="cc-card cc-pad">
            <div className="cc-toolbar"><div><h3 className="cc-h3" style={{ margin: 0 }}>Chi phí lương theo đơn vị (đã phân bổ kiêm nhiệm)</h3><span className="cc-sub">Chi phí = Gross + BH công ty đóng, chia theo tỉ trọng công việc của từng nhân sự</span></div></div>
            <div className="cc-table-wrap">
              <table className="cc-table2 compact">
                <thead><tr><th>Đơn vị</th><th className="r">Nhân sự tham gia</th><th className="r">Quy đổi toàn thời gian</th><th className="r">Chi phí phân bổ</th><th>Tỉ trọng</th></tr></thead>
                <tbody>{list.map(u => (
                  <tr key={u.key}>
                    <td><span className="cc-alloc-name"><i className={`cc-dot cc-tone-${u.tone}`} />{u.label}</span></td>
                    <td className="r mono">{u.people}</td><td className="r mono">{u.fte.toFixed(2).replace('.', ',')}</td>
                    <td className="r mono">{money(u.amount)}</td>
                    <td><div className="cc-leave-cell"><div className="cc-bar"><span style={{ width: (totalCost ? u.amount / totalCost * 100 : 0) + '%', background: 'var(--c)' }} className={`cc-tone-${u.tone}`} /></div><b className="mono">{totalCost ? (u.amount / totalCost * 100).toFixed(1).replace('.', ',') : 0}%</b></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {tab === 'fixed' && (
        <FixedCostTab
          rows={rows} units={units} fixed={payroll.fixed || {}} editable={canAll('payroll', 'edit')} money={money} monthLabel={monthLabel} log={log} employees={employees} cfg={cfg} adjustments={adjustments} runs={runs} concurrentOf={concurrentOf} month={month}
          setFixed={pay.setFixed}
        />
      )}

      {tab === 'ins' && (
        <div className="cc-card cc-pad">
          <div className="cc-toolbar">
            <div><h3 className="cc-h3" style={{ margin: 0 }}>Trích nộp bảo hiểm & thuế TNCN — {monthLabel}</h3><span className="cc-sub">Số liệu dùng để lập hồ sơ nộp BHXH (D02-LT) và tờ khai thuế TNCN (05/KK)</span></div>
            <span className="cc-grow" />
            <button className="cc-btn ghost" onClick={() => { downloadCsv(`bao-hiem-thue-${month}.csv`, [['Mã NV', 'Họ tên', 'Mức đóng BH', 'BHXH NLĐ', 'BHYT NLĐ', 'BHTN NLĐ', 'BH công ty', 'Thu nhập tính thuế', 'Thuế TNCN'], ...rows.map(({ emp, p }) => [emp.code, emp.name, p.insBase, Math.round(p.ins.bhxh), Math.round(p.ins.bhyt), Math.round(p.ins.bhtn), Math.round(p.comIns), Math.round(p.taxable), Math.round(p.pit)])]); log('payroll', 'export', `Báo cáo BH & thuế ${monthLabel}`) }}><Icon name="download" size={14} />Xuất CSV</button>
          </div>
          <div className="cc-ins-sum">
            {[['BHXH', 'bhxh'], ['BHYT', 'bhyt'], ['BHTN', 'bhtn']].map(([lb, k]) => {
              const empPart = rows.reduce((s, r) => s + r.p.ins[k], 0)
              const comPart = rows.reduce((s, r) => s + r.p.insBase * cfg.com[k], 0)
              return <div key={k}><span>{lb}</span><b className="mono">{money(empPart + comPart)}</b><em>NLĐ {pct(cfg.emp[k])}: {money(empPart)} · Cty {pct(cfg.com[k])}: {money(comPart)}</em></div>
            })}
            <div><span>Thuế TNCN khấu trừ</span><b className="mono">{money(sum('pit'))}</b><em>{rows.filter(r => r.p.pit > 0).length} người phát sinh thuế</em></div>
          </div>
          <div className="cc-table-wrap">
            <table className="cc-table2">
              <thead><tr><th>Nhân viên</th><th className="r">Mức đóng BH</th><th className="r">BHXH</th><th className="r">BHYT</th><th className="r">BHTN</th><th className="r">Cty đóng</th><th className="r">Giảm trừ</th><th className="r">TN tính thuế</th><th className="r strong">Thuế TNCN</th></tr></thead>
              <tbody>
                {rows.map(({ emp, p }) => (
                  <tr key={emp.id}>
                    <td><div className="cc-person2"><Avatar emp={emp} size={26} /><div><b>{emp.name}</b><span>{emp.insurance?.bhxhNo || 'Chưa có sổ BHXH'}</span></div></div></td>
                    <td className="r mono">{p.insBase ? money(p.insBase) : <Pill tone="finance">Thử việc</Pill>}</td>
                    <td className="r mono">{p.insBase ? money(p.ins.bhxh) : '·'}</td><td className="r mono">{p.insBase ? money(p.ins.bhyt) : '·'}</td><td className="r mono">{p.insBase ? money(p.ins.bhtn) : '·'}</td>
                    <td className="r mono">{p.insBase ? money(p.comIns) : '·'}</td><td className="r mono">{money(p.deduction)}</td>
                    <td className="r mono">{p.taxable ? money(p.taxable) : '·'}</td><td className="r mono strong">{p.pit ? money(p.pit) : '·'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className="cc-grid2">
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Công thức tính lương</h3>
            <div className="cc-formula">
              <code>Gross = Lương CB × Công thực tế / Công chuẩn + Phụ cấp + OT + Thưởng + Hoa hồng − Phạt</code>
              <code>OT = Số giờ OT × (Lương CB / Công chuẩn / 8) × Hệ số OT</code>
              <code>Thực nhận = Gross − BH người lao động − Thuế TNCN</code>
            </div>
            <div className="cc-form" style={{ marginTop: 12 }}>
              <Field label="Phụ cấp ăn trưa (đ)"><input inputMode="numeric" disabled={!canAll('payroll', 'edit')} value={vnd(cfg.lunch)} onChange={e => setCfg({ lunch: Number(e.target.value.replace(/\D/g, '')) })} /></Field>
              <Field label="Phụ cấp công trường (đ)"><input inputMode="numeric" disabled={!canAll('payroll', 'edit')} value={vnd(cfg.siteAllowance)} onChange={e => setCfg({ siteAllowance: Number(e.target.value.replace(/\D/g, '')) })} /></Field>
              <Field label="Hệ số OT ngày thường"><input type="number" step="0.1" min="1" disabled={!canAll('payroll', 'edit')} value={cfg.otRate} onChange={e => setCfg({ otRate: Number(e.target.value) })} /></Field>
              <Field label="Hoa hồng kinh doanh (% doanh số)"><input type="number" step="0.1" min="0" disabled={!canAll('payroll', 'edit')} value={+(cfg.commissionRate * 100).toFixed(2)} onChange={e => setCfg({ commissionRate: Number(e.target.value) / 100 })} /></Field>
            </div>
            <h3 className="cc-h3" style={{ marginTop: 16 }}>Phụ cấp điện thoại / xăng xe theo cấp bậc</h3>
            {Object.entries(cfg.phoneByLevel).map(([lv, v]) => (
              <div key={lv} className="cc-kv"><span>{lv}</span>
                <input className="cc-inline-num" inputMode="numeric" disabled={!canAll('payroll', 'edit')} value={vnd(v)} onChange={e => setCfg({ phoneByLevel: { ...cfg.phoneByLevel, [lv]: Number(e.target.value.replace(/\D/g, '')) } })} />
              </div>
            ))}
          </div>
          <div className="cc-card cc-pad">
            <h3 className="cc-h3">Bảo hiểm bắt buộc</h3>
            <table className="cc-table2 compact"><thead><tr><th>Loại</th><th className="r">Người lao động</th><th className="r">Công ty</th></tr></thead>
              <tbody>{[['BHXH', 'bhxh'], ['BHYT', 'bhyt'], ['BHTN', 'bhtn']].map(([lb, k]) => <tr key={k}><td>{lb}</td><td className="r mono">{pct(cfg.emp[k])}</td><td className="r mono">{pct(cfg.com[k])}</td></tr>)}</tbody>
            </table>
            <div className="cc-kv"><span>Trần mức đóng BHXH/BHYT</span><input className="cc-inline-num" disabled={!canAll('payroll', 'edit')} value={vnd(cfg.insCap)} onChange={e => setCfg({ insCap: Number(e.target.value.replace(/\D/g, '')) })} /></div>
            <h3 className="cc-h3" style={{ marginTop: 16 }}>Thuế TNCN</h3>
            <div className="cc-kv"><span>Giảm trừ bản thân</span><input className="cc-inline-num" disabled={!canAll('payroll', 'edit')} value={vnd(cfg.personalDeduction)} onChange={e => setCfg({ personalDeduction: Number(e.target.value.replace(/\D/g, '')) })} /></div>
            <div className="cc-kv"><span>Giảm trừ mỗi người phụ thuộc</span><input className="cc-inline-num" disabled={!canAll('payroll', 'edit')} value={vnd(cfg.dependentDeduction)} onChange={e => setCfg({ dependentDeduction: Number(e.target.value.replace(/\D/g, '')) })} /></div>
            <table className="cc-table2 compact" style={{ marginTop: 8 }}><thead><tr><th>Bậc</th><th>Thu nhập tính thuế / tháng</th><th className="r">Thuế suất</th></tr></thead>
              <tbody>{cfg.brackets.map((b, i) => <tr key={i}><td>{i + 1}</td><td>{i === 0 ? 'Đến ' : `Trên ${vnd(cfg.brackets[i - 1].upTo)} `}{b.upTo ? (i === 0 ? vnd(b.upTo) : `đến ${vnd(b.upTo)}`) : ''}</td><td className="r mono">{pct(b.rate)}</td></tr>)}</tbody>
            </table>
            <div className="cc-ps-note">Mức giảm trừ & biểu thuế là giá trị mặc định có thể chỉnh — cần đối chiếu văn bản pháp luật hiện hành trước khi chạy lương thật.</div>
          </div>
        </div>
      )}

      <Modal open={!!slipRow} onClose={() => setSlip(null)} width={780} icon="file" title="Phiếu lương" sub={slipRow ? `${slipRow.emp.name} · ${monthLabel}` : ''}
        footer={<><span className="cc-grow cc-sub">{run.status === 'paid' ? 'Đã chi trả' : run.status === 'approved' ? 'Đã duyệt, chưa chi trả' : 'Bảng lương nháp'}</span>
          <button className="cc-btn ghost" onClick={() => window.print()}><Icon name="download" size={14} />In / lưu PDF</button></>}>
        {slipRow && <div className="cc-print"><Payslip emp={slipRow.emp} att={slipRow.att} p={slipRow.p} adj={slipRow.adj} monthLabel={monthLabel} /></div>}
      </Modal>

      <Modal open={!!adjFor} onClose={() => setAdjFor(null)} width={560} icon="wallet" tone="finance" title="Thưởng / phạt / doanh số" sub={adjFor ? `${adjFor.name} · ${monthLabel}` : ''}
        footer={<button className="cc-btn" onClick={() => setAdjFor(null)}>Xong</button>}>
        {adjFor && <>
          {adjList.length === 0 && <Empty icon="wallet" text="Chưa có khoản điều chỉnh" />}
          {adjList.map((a, i) => (
            <div key={i} className="cc-doc">
              <Pill tone={a.kind === 'penalty' ? 'danger' : a.kind === 'sales' ? 'primary' : 'success'}>{a.kind === 'penalty' ? 'Phạt' : a.kind === 'sales' ? 'Doanh số' : 'Thưởng'}</Pill>
              <div className="cc-grow"><b>{a.label}</b></div><b className="mono">{vnd(a.amount)} đ</b>
              <button className="cc-icon-btn sm danger" onClick={() => removeAdj(i)}><Icon name="x" size={13} /></button>
            </div>
          ))}
          <div className="cc-adj-add">
            <select className="cc-select" value={newAdj.kind} onChange={e => setNewAdj({ ...newAdj, kind: e.target.value })}><option value="bonus">Thưởng</option><option value="penalty">Phạt</option><option value="sales">Doanh số (tính hoa hồng)</option></select>
            <input placeholder="Nội dung" value={newAdj.label} onChange={e => setNewAdj({ ...newAdj, label: e.target.value })} />
            <input placeholder="Số tiền" inputMode="numeric" value={newAdj.amount ? vnd(Number(String(newAdj.amount).replace(/\D/g, ''))) : ''} onChange={e => setNewAdj({ ...newAdj, amount: e.target.value.replace(/\D/g, '') })} />
            <button className="cc-btn" onClick={addAdj}><Icon name="plus" size={14} stroke={2.4} />Thêm</button>
          </div>
        </>}
      </Modal>
    </div>
  )
}
