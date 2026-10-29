import { useState } from 'react'
import {
  STAGE_LABEL, OV_ITEM_DEFS, OV_ITEM_ORDER, OV_LAYOUT_KEY, OV_PERIODS,
  OV_TREND_CHART_OPTIONS, OV_FUNNEL_CHART_OPTIONS,
} from '../../../data/kinhDoanhData'
import { FONT_STACK, fmtTy } from '../utils'
import { DeptFilter, TimeFilter } from './Filters'
import OverviewGrid from './OverviewGrid'
import { ovTrendData, TrendLine, TrendBar, FunnelBars, FunnelColumns, FunnelDonut } from './OverviewCharts'

/* ===================== Tab Tổng quan (Overview dashboard) ===================== */

function loadPeriod() {
  try { return localStorage.getItem('siteflow-ov-period') || 'month' } catch { return 'month' }
}
function loadChartType() {
  try { return Object.assign({ trend: 'line', funnel: 'donut' }, JSON.parse(localStorage.getItem('siteflow-ov-chart-type-v2'))) }
  catch { return { trend: 'line', funnel: 'donut' } }
}

function DragDots() {
  return (
    <span className="kd-ov-kpi-drag-dots">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6" /><circle cx="16" cy="6" r="1.6" /><circle cx="8" cy="12" r="1.6" /><circle cx="16" cy="12" r="1.6" /><circle cx="8" cy="18" r="1.6" /><circle cx="16" cy="18" r="1.6" /></svg>
    </span>
  )
}

function ChartTypeSelect({ value, options, onChange }) {
  return (
    <select
      title="Chọn dạng biểu đồ" value={value} onChange={e => onChange(e.target.value)}
      style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', fontSize: 10.5, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }}
    >
      {options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
    </select>
  )
}

function ovComputeStats(leads) {
  const total = leads.length
  const closedWon = leads.filter(l => l.stage === 'chot-hd' || l.stage === 'thiet-ke' || l.stage === 'thi-cong')
  const closedLost = leads.filter(l => l.stage === 'truot-thau')
  const pipelineValue = leads.reduce((s, l) => s + l.value, 0)
  const closedValue = closedWon.reduce((s, l) => s + l.value, 0)
  const closeRate = total ? (closedWon.length / total * 100) : 0
  const lostRate = total ? (closedLost.length / total * 100) : 0
  const partnerCount = closedWon.filter(l => l.partner).length
  const partnerRate = closedWon.length ? (partnerCount / closedWon.length * 100) : 0
  return { total, closedWon, closedLost, pipelineValue, closedValue, closeRate, lostRate, partnerRate }
}

export default function OverviewTab({ allLeads, leads, dept, onDeptChange, timeFilter, onTimeFilterChange }) {
  const [ovPeriod, setOvPeriod] = useState(loadPeriod)
  const [ovChartType, setOvChartType] = useState(loadChartType)

  function changePeriod(key) {
    setOvPeriod(key)
    try { localStorage.setItem('siteflow-ov-period', key) } catch { /* bỏ qua */ }
  }
  function changeChartType(widget, value) {
    const next = { ...ovChartType, [widget]: value }
    setOvChartType(next)
    try { localStorage.setItem('siteflow-ov-chart-type-v2', JSON.stringify(next)) } catch { /* bỏ qua */ }
  }

  const s = ovComputeStats(leads)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const newThisMonth = leads.filter(l => (l.createdAt || '').slice(0, 7) === thisMonth).length
  const wonThisMonth = s.closedWon.filter(l => (l.wonAt || '').slice(0, 7) === thisMonth)
  /* [nhãn, giá trị, chú thích, màu] */
  const kpis = {
    'kpi-pipeline': ['Tổng giá trị pipeline', fmtTy(s.pipelineValue), `${s.total} cơ hội đang theo dõi`, 'var(--sales)'],
    'kpi-leads': ['Khách hàng tiềm năng', s.total, `+${newThisMonth} trong tháng này`],
    'kpi-close-rate': ['Tỷ lệ chốt hợp đồng', s.closeRate.toFixed(0) + '%', 'Trên tổng số cơ hội', 'var(--success)'],
    'kpi-closed-value': ['Đã chốt tháng này', fmtTy(wonThisMonth.reduce((x, l) => x + l.value, 0)), `${wonThisMonth.length} hợp đồng`, 'var(--success)'],
    'kpi-lost-rate': ['Tỷ lệ hợp đồng rớt', s.lostRate.toFixed(0) + '%', `${s.closedLost.length} cơ hội trượt thầu`, 'var(--danger)'],
    'kpi-partner-rate': ['Chuyển giao cho đối tác', s.partnerRate.toFixed(0) + '%', 'Trên các hợp đồng đã chốt', 'var(--primary)'],
  }

  function widgetHeader(id) {
    if (id === 'trend') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flex: 'none' }}>
            {OV_PERIODS.map(([key, label]) => (
              <button
                key={key} draggable={false} onClick={() => changePeriod(key)}
                style={{ border: 'none', cursor: 'pointer', padding: '6px 11px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', background: ovPeriod === key ? 'var(--primary-tint)' : 'none', color: ovPeriod === key ? 'var(--primary)' : 'var(--text-muted)' }}
              >{label}</button>
            ))}
          </div>
          <ChartTypeSelect value={ovChartType.trend} options={OV_TREND_CHART_OPTIONS} onChange={v => changeChartType('trend', v)} />
        </div>
      )
    }
    if (id === 'funnel') return <ChartTypeSelect value={ovChartType.funnel} options={OV_FUNNEL_CHART_OPTIONS} onChange={v => changeChartType('funnel', v)} />
    return null
  }

  function widgetBody(id) {
    if (id === 'trend') {
      const data = ovTrendData(allLeads, ovPeriod)
      return ovChartType.trend === 'bar' ? <TrendBar {...data} /> : <TrendLine {...data} />
    }
    if (id === 'funnel') {
      if (ovChartType.funnel === 'columns') return <FunnelColumns leads={leads} />
      if (ovChartType.funnel === 'donut') return <FunnelDonut leads={leads} />
      return <FunnelBars leads={leads} />
    }
    /* Cơ hội sắp chốt */
    const items = leads.filter(l => l.stage === 'bao-gia' || l.stage === 'dam-phan').sort((a, b) => b.value - a.value).slice(0, 4)
    if (!items.length) return <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '12px 0' }}>Chưa có cơ hội nào sắp chốt.</div>
    return items.map((l, i) => (
      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', ...(i < items.length - 1 ? { borderBottom: '1px solid var(--border)' } : null) }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{l.name}{l.type ? ' — ' + l.type : ''}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{STAGE_LABEL[l.stage]}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--sales)' }}>{fmtTy(l.value)}</span>
      </div>
    ))
  }

  function renderItem(id) {
    const def = OV_ITEM_DEFS[id]
    if (def.kind === 'kpi') {
      const [label, value, caption, color] = kpis[id]
      return (
        <div className="kd-ov-kpi-card kd-grid-drag-handle" title="Kéo để di chuyển">
          <DragDots />
          <div style={{ fontFamily: FONT_STACK, fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
          <div className="mono" style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: 24, ...(color ? { color } : null) }}>{value}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{caption}</div>
        </div>
      )
    }
    return (
      <div className="kd-ov-widget-card">
        {/* Khung hẹp: tiêu đề cắt bằng dấu …, cụm nút tự xuống dòng thay vì tràn ra ngoài */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14, flex: 'none' }}>
          <div className="kd-grid-drag-handle kd-ov-widget-title-handle" title="Kéo để di chuyển" style={{ minWidth: 0, maxWidth: '100%' }}>
            <DragDots />
            <h3 style={{ fontSize: 14.5, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.title}</h3>
          </div>
          {widgetHeader(id)}
        </div>
        <div className="kd-ov-widget-body">{widgetBody(id)}</div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Số liệu tổng hợp theo phòng ban &amp; mốc thời gian đã chọn</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DeptFilter dept={dept} onChange={onDeptChange} />
          <TimeFilter filter={timeFilter} onChange={onTimeFilterChange} />
        </div>
      </div>
      <OverviewGrid order={OV_ITEM_ORDER} defs={OV_ITEM_DEFS} storageKey={OV_LAYOUT_KEY} renderItem={renderItem} />
    </>
  )
}
