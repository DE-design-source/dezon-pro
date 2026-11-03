import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { MONTHS, monthlySummary, isBlockLevel, motherRoots } from '../../../data/hrData'
import { Pill, Seg, downloadCsv } from './shared'
import { calcPay } from './PayrollModule'

const vnd = v => Math.round(v).toLocaleString('vi-VN')
const short = v => (v >= 1e9 ? (v / 1e9).toFixed(2).replace('.', ',') + ' tỷ' : Math.round(v / 1e6).toLocaleString('vi-VN') + ' tr')
const nextMonth = key => { const [y, m] = key.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
/* Dự kiến: 3 tháng ngay sau tháng hiện tại (MONTHS[0]) */
const FORECAST = []
for (let k = MONTHS[0].key, i = 0; i < 3; i++) { k = nextMonth(k); FORECAST.push({ key: k, label: `Tháng ${Number(k.slice(5))}/${k.slice(0, 4)}` }) }
const payDate = key => { const [y, m] = nextMonth(key).split('-'); return `05/${m}/${y}` }
const monthShort = key => `T${Number(key.slice(5))}/${key.slice(2, 4)}`
const STATUS = {
  paid: { label: 'Đã trả', tone: 'success', icon: 'checkCircle' },
  approved: { label: 'Đã duyệt · chờ chi', tone: 'primary', icon: 'clock' },
  draft: { label: 'Đang tính lương', tone: 'finance', icon: 'edit' },
  forecast: { label: 'Dự kiến', tone: 'muted', icon: 'trending' },
}

/* Chi phí lương theo tháng, chia theo đơn vị (đã phân bổ kiêm nhiệm):
   - Lịch sử: tháng đã có bảng công (đã trả / đã duyệt / đang tính)
   - Dự kiến: 3 tháng tới — đủ công chuẩn, OT trung bình hiện tại, tính cả nhân sự mới vào làm & nhân sự hết thử việc (bắt đầu đóng BH) */
function buildSeries(employees, cfg, adjustments, runs, concurrentOf) {
  const agg = list => {
    const byUnit = {}
    let total = 0
    list.forEach(p => p.alloc.forEach(a => {
      const u = byUnit[a.key] || (byUnit[a.key] = { cost: 0, gross: 0, ins: 0, fte: 0, people: 0 })
      u.gross += p.gross * a.pct / 100; u.ins += p.comIns * a.pct / 100; u.cost += p.cost * a.pct / 100
      u.fte += a.pct / 100; u.people += 1
    }))
    list.forEach(p => { total += p.cost })
    return { byUnit, total }
  }
  const hist = [...MONTHS].sort((a, b) => a.key.localeCompare(b.key)).map(m => {
    // tháng đã duyệt / đã trả: dùng bản chụp phiếu lương lúc duyệt (không tính lại theo cấu hình / lương hiện tại)
    const slips = runs[m.key]?.payslips
    const pays = slips ? Object.values(slips).map(x => x.p).filter(p => p && p.alloc)
      : monthlySummary(employees, m.key).map(att => calcPay(att.emp, att, adjustments[m.key]?.[att.emp.id] || [], cfg, concurrentOf(att.emp.id)))
    return { key: m.key, label: m.label, kind: runs[m.key]?.status || 'draft', payDate: payDate(m.key), heads: pays.length, ...agg(pays) }
  })
  const lastOt = {}
  monthlySummary(employees, MONTHS[0].key).forEach(a => { lastOt[a.emp.id] = a.ot })
  const fc = FORECAST.map(m => {
    const pays = employees.filter(e => e.status !== 'left' && e.joinDate <= m.key + '-31').map(e => {
      const probEnd = e.contracts?.find(c => c.type === 'Thử việc' && c.status === 'active')?.end
      const emp = e.status === 'probation' && probEnd && probEnd < m.key + '-01'
        ? { ...e, insurance: { ...e.insurance, since: probEnd, base: e.salary } } : e
      const att = { emp, std: 26, total: 26, worked: 26, ot: lastOt[e.id] || 0 }
      return calcPay(emp, att, [], cfg, concurrentOf(e.id))
    })
    return { key: m.key, label: m.label, kind: 'forecast', payDate: payDate(m.key), heads: pays.length, ...agg(pays) }
  })
  return [...hist, ...fc]
}

/* Biểu đồ cột: chi phí lương theo tháng (1 chuỗi) + vạch quỹ lương kế hoạch; cột dự kiến dùng nền sọc */
function CostChart({ series, valueOf, fund, tone }) {
  const [hover, setHover] = useState(null)
  const vals = series.map(valueOf)
  const max = Math.max(fund || 0, ...vals, 1) * 1.12
  const H = 180
  return (
    <div className={`cc-chart cc-tone-${tone}`}>
      <div className="cc-chart-plot" style={{ height: H }}>
        {[0.25, 0.5, 0.75, 1].map(t => <div key={t} className="cc-chart-grid" style={{ bottom: t * H }}><span>{short(max * t)}</span></div>)}
        {fund > 0 && <div className="cc-chart-fund" style={{ bottom: fund / max * H }}><span>Quỹ KH {short(fund)}</span></div>}
        <div className="cc-chart-cols">
          {series.map((s, i) => {
            const v = vals[i]
            return (
              <div key={s.key} className="cc-chart-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                aria-label={`${s.label}: ${vnd(v)} đ, ${STATUS[s.kind].label}`}>
                <div className={`cc-chart-bar${s.kind === 'forecast' ? ' forecast' : ''}${hover === i ? ' hover' : ''}`} style={{ height: Math.max(2, v / max * H) }} />
                {hover === i && (
                  <div className="cc-chart-tip">
                    <b>{s.label}</b>
                    <span>Chi phí lương: <b className="mono">{vnd(v)} đ</b></span>
                    {fund > 0 && <span>So với quỹ: <b className="mono">{(v / fund * 100).toFixed(1).replace('.', ',')}%</b></span>}
                    <span>{STATUS[s.kind].label} · chi ngày {s.payDate}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="cc-chart-x">{series.map(s => <span key={s.key}>{monthShort(s.key)}{s.kind === 'forecast' && <em>dự kiến</em>}</span>)}</div>
      <div className="cc-chart-legend"><span><i className="solid" />Thực tế (lịch sử)</span><span><i className="hatch" />Dự kiến</span>{fund > 0 && <span><i className="line" />Quỹ lương kế hoạch</span>}</div>
    </div>
  )
}

/* Tab "Định phí theo phòng ban": sơ đồ cơ cấu tổ chức → bấm đơn vị để xem quỹ lương, định phí khác,
   lịch sử trả lương & dự kiến chi các tháng tới. Có thêm dạng bảng để so sánh nhanh. */
export default function FixedCostTab({ rows, units, fixed, setFixed, editable, money, monthLabel, log, employees, cfg, adjustments, runs, concurrentOf, month }) {
  const [view, setView] = useState('chart')
  const [sel, setSel] = useState('company')
  const detailRef = useRef(null)
  const orgWrapRef = useRef(null)
  const orgRef = useRef(null)
  const [zoom, setZoom] = useState(0.82)
  const firstSel = useRef(true)

  const series = useMemo(() => buildSeries(employees, cfg, adjustments, runs, concurrentOf), [employees, cfg, adjustments, runs, concurrentOf])
  const cur = series.find(s => s.key === month) || series[series.length - FORECAST.length - 1]

  const lineOf = key => {
    const f = fixed[key] || { fund: 0, items: [] }
    const a = cur.byUnit[key] || { cost: 0, gross: 0, ins: 0, fte: 0, people: 0 }
    const other = f.items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    return { f, a, other, act: a.cost, total: f.fund + other, usage: f.fund ? a.cost / f.fund : (a.cost ? Infinity : 0) }
  }
  const company = (() => {
    const ls = units.map(u => lineOf(u.key))
    const fund = ls.reduce((s, l) => s + l.f.fund, 0), other = ls.reduce((s, l) => s + l.other, 0)
    return { f: { fund, items: [] }, other, act: cur.total, total: fund + other, usage: fund ? cur.total / fund : 0, a: { fte: ls.reduce((s, l) => s + l.a.fte, 0), people: cur.heads } }
  })()
  const usageTone = r => (r > 1 ? 'danger' : r >= 0.9 ? 'finance' : 'success')
  const over = units.filter(u => { const l = lineOf(u.key); return l.f.fund && l.usage > 1 })

  const setFund = (key, v) => setFixed(key, { ...(fixed[key] || { items: [] }), fund: v })
  const setItems = (key, items) => setFixed(key, { ...(fixed[key] || { fund: 0 }), items })
  const moneyIn = (value, onChange, title) => (editable
    ? <input className="cc-inline-num" inputMode="numeric" title={title} value={vnd(value)} onClick={e => e.stopPropagation()} onChange={e => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
    : <span className="mono">{money(value)}</span>)

  // Thu phóng sơ đồ cho vừa độ rộng khung (đo tổng độ rộng các nút gốc ở mức zoom hiện tại)
  useEffect(() => {
    const fit = () => {
      const w = orgWrapRef.current, o = orgRef.current
      if (!w || !o) return
      const z = parseFloat(o.style.zoom) || 1
      const natural = [...o.querySelectorAll(':scope > ul > li')].reduce((t, li) => t + li.getBoundingClientRect().width, 0) / z + 40
      setZoom(Math.max(0.45, Math.min(1, Math.floor((w.clientWidth - 32) / natural * 100) / 100)))
    }
    const id = requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', fit) }
  }, [view, units])

  // Chọn đơn vị trên sơ đồ → cuộn tới phần chi tiết
  useEffect(() => {
    if (firstSel.current) { firstSel.current = false; return }
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sel])

  /* ---------- Sơ đồ cơ cấu (cùng bố cục với Sơ đồ tổ chức) ---------- */
  const kids = key => units.filter(u => u.parent === key && u.type !== 'board')
  const boards = key => units.filter(u => u.parent === key && u.type === 'board')
  const Card = ({ u, small }) => {
    const l = lineOf(u.key)
    const tone = l.f.fund ? usageTone(l.usage) : 'muted'
    return (
      <button className={`cc-fc-card cc-tone-${u.tone}${sel === u.key ? ' active' : ''}${small ? ' small' : ''} type-${u.type}`} onClick={() => setSel(u.key)}>
        <b>{u.label}</b>
        {!small && <span className="cc-fc-total mono">{money(l.total)}</span>}
        <span className={`cc-fc-usage cc-tone-${tone}`}><i><s style={{ width: Math.min(100, isFinite(l.usage) ? l.usage * 100 : 100) + '%' }} /></i><em>{l.f.fund ? (isFinite(l.usage) ? Math.round(l.usage * 100) + '%' : '—') : 'Chưa đặt quỹ'}</em>{l.f.fund && l.usage > 1 && <Icon name="alert" size={11} />}</span>
      </button>
    )
  }
  const render = (u, drop) => {
    const ch = kids(u.key)
    const side = boards(u.key)
    const hasExec = ch.some(isBlockLevel)
    return (
      <li key={u.key} className={drop ? 'drop' : undefined}>
        <div className="cc-unit-row">
          <Card u={u} />
          {side.length > 0 && <div className="cc-unit-side">{side.map(b => <div key={b.key} className="cc-unit-side-item"><Card u={b} small /></div>)}</div>}
        </div>
        {ch.length > 0 && <ul>{ch.map(c => render(c, hasExec && !isBlockLevel(c)))}</ul>}
      </li>
    )
  }
  const roots = motherRoots(units)

  /* ---------- Chi tiết đơn vị đang chọn ---------- */
  const isCompany = sel === 'company'
  const unit = isCompany ? { key: 'company', name: 'Dezon — toàn công ty', label: 'Dezon', tone: 'primary', type: 'company' } : units.find(u => u.key === sel)
  const L = isCompany ? company : lineOf(sel)
  const valueOf = s => (isCompany ? s.total : (s.byUnit[sel]?.cost || 0))
  const histRows = series.map(s => ({ s, v: valueOf(s), g: isCompany ? Object.values(s.byUnit).reduce((t, x) => t + x.gross, 0) : (s.byUnit[sel]?.gross || 0), i: isCompany ? Object.values(s.byUnit).reduce((t, x) => t + x.ins, 0) : (s.byUnit[sel]?.ins || 0), n: isCompany ? s.heads : (s.byUnit[sel]?.people || 0) }))
  const fcTotal = histRows.filter(r => r.s.kind === 'forecast').reduce((t, r) => t + r.v, 0)

  function exportCsv() {
    downloadCsv(`lich-su-du-kien-luong-${unit.label}.csv`, [
      ['Đơn vị', 'Tháng', 'Trạng thái', 'Ngày chi', 'Nhân sự', 'Lương & phụ cấp (Gross)', 'BH công ty', 'Tổng chi phí lương', 'Quỹ lương KH', 'So với quỹ (%)'],
      ...histRows.map(r => [unit.name, r.s.label, STATUS[r.s.kind].label, r.s.payDate, r.n, Math.round(r.g), Math.round(r.i), Math.round(r.v), L.f.fund, L.f.fund ? (r.v / L.f.fund * 100).toFixed(1) : '']),
    ])
    log('payroll', 'export', `Lịch sử & dự kiến trả lương — ${unit.name}`)
  }

  return (
    <div className="cc-stack">
      <div className="cc-kpis">
        <div className="cc-card cc-kpi2 cc-tone-primary"><span className="cc-ico"><Icon name="building" size={15} /></span><div><span>Tổng định phí / tháng</span><b>{money(company.total)}</b><em>quỹ lương + định phí khác · toàn Dezon</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-attendance"><span className="cc-ico"><Icon name="wallet" size={15} /></span><div><span>Chi phí lương {monthLabel}</span><b>{money(company.act)}</b><em>quỹ kế hoạch {money(company.f.fund)}</em></div></div>
        <div className={`cc-card cc-kpi2 cc-tone-${usageTone(company.usage)}`}><span className="cc-ico"><Icon name="trending" size={15} /></span><div><span>Sử dụng quỹ lương</span><b>{(company.usage * 100).toFixed(1).replace('.', ',')}%</b><em>đã phân bổ kiêm nhiệm</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-qs"><span className="cc-ico"><Icon name="calendar" size={15} /></span><div><span>Dự kiến chi 3 tháng tới</span><b>{money(series.filter(s => s.kind === 'forecast').reduce((t, s) => t + s.total, 0))}</b><em>{FORECAST[0].label.replace('Tháng ', 'T')}–{FORECAST[2].label.replace('Tháng ', 'T')} · {over.length ? `${over.length} đơn vị đang vượt quỹ` : 'không đơn vị nào vượt quỹ'}</em></div></div>
      </div>

      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={view} onChange={setView} options={[{ value: 'chart', label: 'Theo cơ cấu tổ chức', icon: 'sitemap' }, { value: 'table', label: 'Dạng bảng', icon: 'table' }]} />
        <span className="cc-sub">Bấm vào một đơn vị để xem quỹ lương, định phí, lịch sử & dự kiến trả lương</span>
      </div>

      {view === 'chart' && (
        <div className="cc-card cc-fc-wrap" ref={orgWrapRef}>
          <button className={`cc-fc-company${sel === 'company' ? ' active' : ''}`} onClick={() => setSel('company')}>
            <span className="cc-ico cc-tone-primary"><Icon name="building" size={15} /></span>
            <span className="cc-grow"><b>Dezon — toàn công ty</b><em>{units.filter(u => u.type === 'dept').length} phòng ban · {company.a.people} nhân sự</em></span>
            <span className="cc-fc-total mono">{money(company.total)}</span>
            <span className={`cc-fc-usage cc-tone-${usageTone(company.usage)}`} style={{ width: 160 }}><i><s style={{ width: Math.min(100, company.usage * 100) + '%' }} /></i><em>{Math.round(company.usage * 100)}% quỹ</em></span>
          </button>
          <div className="cc-org cc-org-units cc-fc-org" ref={orgRef} style={{ zoom }}><ul>{roots.map(r => render(r))}</ul></div>
          <div className="cc-fc-legend"><span><i className="cc-tone-success" />Dưới 90% quỹ</span><span><i className="cc-tone-finance" />90–100%</span><span><i className="cc-tone-danger" />Vượt quỹ</span><span className="cc-sub">Số trên mỗi ô = tổng định phí / tháng (quỹ lương + định phí khác)</span></div>
        </div>
      )}

      {view === 'table' && (
        <div className="cc-card cc-pad">
          <div className="cc-table-wrap">
            <table className="cc-table2 hover cc-fixed">
              <thead><tr><th>Đơn vị</th><th className="r">Nhân sự quy đổi</th><th className="r">Quỹ lương KH</th><th className="r">Chi phí lương thực tế</th><th>Sử dụng quỹ</th><th className="r">Định phí khác</th><th className="r strong">Tổng định phí</th></tr></thead>
              <tbody>
                <tr className="company" onClick={() => setSel('company')}><td><b>Dezon — toàn công ty</b></td><td className="r mono">{company.a.fte.toFixed(1).replace('.', ',')}</td><td className="r mono">{money(company.f.fund)}</td><td className="r mono">{money(company.act)}</td><td><Usage r={company.usage} tone={usageTone(company.usage)} /></td><td className="r mono">{money(company.other)}</td><td className="r mono strong">{money(company.total)}</td></tr>
                {units.map(u => {
                  const l = lineOf(u.key)
                  return (
                    <tr key={u.key} className={sel === u.key ? 'selected' : ''} onClick={() => setSel(u.key)}>
                      <td><span className="cc-fixed-name"><i className={`cc-dot cc-tone-${u.tone}`} /><b>{u.name}</b></span></td>
                      <td className="r mono">{l.a.fte ? l.a.fte.toFixed(2).replace('.', ',') : '·'}</td>
                      <td className="r">{moneyIn(l.f.fund, v => setFund(u.key, v), 'Quỹ lương kế hoạch / tháng')}</td>
                      <td className="r mono">{l.act ? money(l.act) : '·'}</td>
                      <td>{l.f.fund ? <Usage r={l.usage} tone={usageTone(l.usage)} /> : <span className="cc-muted">Chưa đặt quỹ</span>}</td>
                      <td className="r mono">{l.other ? money(l.other) : '·'}</td>
                      <td className="r mono strong">{money(l.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- Chi tiết đơn vị ---------- */}
      {unit && (
        <div ref={detailRef} className={`cc-card cc-pad cc-fc-detail cc-tone-${unit.tone}`}>
          <div className="cc-job-top">
            <span className="cc-ico"><Icon name={isCompany ? 'building' : 'sitemap'} size={16} /></span>
            <div className="cc-grow"><span className="cc-kicker">{isCompany ? 'Toàn công ty' : 'Định phí đơn vị'}</span><b style={{ fontSize: 17 }}>{unit.name}</b></div>
            <button className="cc-btn ghost" onClick={exportCsv}><Icon name="download" size={14} />Xuất lịch sử & dự kiến</button>
          </div>

          <div className="cc-fc-stats">
            <div><span>Quỹ lương kế hoạch / tháng</span>{isCompany ? <b className="mono">{money(L.f.fund)}</b> : moneyIn(L.f.fund, v => setFund(sel, v), 'Quỹ lương kế hoạch / tháng')}</div>
            <div><span>Chi phí lương {monthLabel}</span><b className="mono">{money(L.act)}</b></div>
            <div className={`cc-tone-${L.f.fund ? usageTone(L.usage) : 'muted'}`}><span>Sử dụng quỹ</span><b className="mono" style={{ color: 'var(--c)' }}>{L.f.fund ? (isFinite(L.usage) ? (L.usage * 100).toFixed(1).replace('.', ',') + '%' : '—') : 'Chưa đặt quỹ'}</b>{L.f.fund > 0 && L.usage > 1 && <em><Icon name="alert" size={11} /> Vượt quỹ {money(L.act - L.f.fund)}</em>}</div>
            <div><span>Định phí khác / tháng</span><b className="mono">{money(L.other)}</b></div>
            <div><span>Tổng định phí / tháng</span><b className="mono">{money(L.total)}</b></div>
            <div><span>Dự kiến chi 3 tháng tới</span><b className="mono">{money(fcTotal)}</b></div>
          </div>

          <div className="cc-fc-grid">
            <div>
              <h3 className="cc-h3">Lịch sử & dự kiến trả lương</h3>
              <CostChart series={series} valueOf={valueOf} fund={L.f.fund} tone={unit.tone} />
            </div>
            <div>
              <h3 className="cc-h3">Chi tiết theo kỳ lương</h3>
              <div className="cc-table-wrap">
                <table className="cc-table2 compact">
                  <thead><tr><th>Kỳ lương</th><th>Trạng thái</th><th>Ngày chi</th><th className="r">NS</th><th className="r">Tổng chi phí</th><th className="r">So với quỹ</th></tr></thead>
                  <tbody>{histRows.map(r => (
                    <tr key={r.s.key} className={r.s.kind === 'forecast' ? 'cc-fc-fc' : ''}>
                      <td><b>{r.s.label}</b></td>
                      <td><Pill tone={STATUS[r.s.kind].tone}><Icon name={STATUS[r.s.kind].icon} size={11} />{STATUS[r.s.kind].label}</Pill></td>
                      <td className="mono">{r.s.payDate}</td>
                      <td className="r mono">{r.n}</td>
                      <td className="r mono">{money(r.v)}</td>
                      <td className={`r mono${L.f.fund && r.v > L.f.fund ? ' cc-warn' : ''}`}>{L.f.fund ? (r.v / L.f.fund * 100).toFixed(0) + '%' : '·'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="cc-sub" style={{ marginTop: 6 }}>Lương tháng N chi ngày 05 tháng N+1. Dự kiến = đủ công chuẩn, OT trung bình hiện tại, đã tính nhân sự mới & nhân sự hết thử việc bắt đầu đóng BH.</div>
            </div>
          </div>

          {!isCompany && (
            <div style={{ marginTop: 16 }}>
              <div className="cc-row-between"><h3 className="cc-h3" style={{ margin: 0 }}>Định phí khác / tháng</h3>{editable && <button className="cc-link-btn" onClick={() => setItems(sel, [...L.f.items, { name: 'Khoản định phí mới', amount: 0 }])}><Icon name="plus" size={13} stroke={2.4} />Thêm khoản</button>}</div>
              {L.f.items.length === 0 && <div className="cc-sub" style={{ padding: '8px 0' }}>Chưa có khoản định phí (thuê mặt bằng, bản quyền, khấu hao...)</div>}
              {L.f.items.map((it, i) => (
                <div key={i} className="cc-fixed-item">
                  {editable ? <input value={it.name} onChange={e => setItems(sel, L.f.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /> : <span>{it.name}</span>}
                  {moneyIn(it.amount, v => setItems(sel, L.f.items.map((x, j) => (j === i ? { ...x, amount: v } : x))))}
                  {editable && <button className="cc-icon-btn sm danger" title="Xoá khoản" onClick={() => setItems(sel, L.f.items.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Usage({ r, tone }) {
  const pct = isFinite(r) ? r * 100 : 999
  return (
    <div className={`cc-usage cc-tone-${tone}`}>
      <div className="cc-bar"><span style={{ width: Math.min(100, pct) + '%', background: 'var(--c)' }} /></div>
      <b className="mono">{isFinite(r) ? pct.toFixed(0) + '%' : '—'}</b>
    </div>
  )
}
