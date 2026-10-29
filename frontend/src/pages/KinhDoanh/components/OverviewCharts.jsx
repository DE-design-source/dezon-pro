import { useEffect, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL } from '../../../data/kinhDoanhData'
import { FONT_STACK, stageAccent, startOfWeek } from '../utils'

/* Các biểu đồ của tab Tổng quan — bản HTML ghép chuỗi SVG/HTML, ở đây tính từ dữ liệu ra JSX */

/* ---------- Doanh số theo thời gian ---------- */
export function ovTrendData(allLeads, period) {
  /* Doanh số = tổng giá trị các khách hàng chốt (wonAt) rơi vào từng mốc: 7 ngày tuần này / 6 tháng gần nhất / 4 năm gần nhất */
  const now = new Date()
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  let buckets
  if (period === 'week') {
    const mon = startOfWeek(now)
    buckets = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((label, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); const k = iso(d); return { label, hit: w => w === k } })
  } else if (period === 'year') {
    buckets = [3, 2, 1, 0].map(n => { const y = String(now.getFullYear() - n); return { label: y, hit: w => w.slice(0, 4) === y } })
  } else {
    buckets = [5, 4, 3, 2, 1, 0].map(n => { const d = new Date(now.getFullYear(), now.getMonth() - n, 1); const k = iso(d).slice(0, 7); return { label: 'Th' + (d.getMonth() + 1), hit: w => w.slice(0, 7) === k } })
  }
  const values = buckets.map(b => +allLeads.reduce((s, l) => s + (l.wonAt && b.hit(l.wonAt) ? l.value : 0), 0).toFixed(1))
  return { labels: buckets.map(b => b.label), values }
}

/* Đo kích thước thật của khung chứa để biểu đồ vẽ vừa khít widget (to ra / nhỏ lại theo khi kéo giãn) */
function useBoxSize() {
  const ref = useRef(null)
  const [size, setSize] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

const PAD_L = 24, PAD_R = 24, PAD_TOP = 32, PAD_BOTTOM = 30
const TREND_BOX = { flex: 1, minHeight: 0, position: 'relative' }
const TREND_SVG = { position: 'absolute', inset: 0, overflow: 'visible' }

/* Khung vẽ = đúng kích thước widget (px), nên chữ giữ nguyên cỡ còn đường/cột giãn theo khung */
function trendFrame(size) {
  const W = Math.max(160, size ? size.w : 600)
  const H = Math.max(90, size ? size.h : 190)
  return { W, H, plotH: H - PAD_TOP - PAD_BOTTOM, font: H >= 260 ? 12.5 : 11 }
}

function GridLines({ W, plotH }) {
  return [0, 0.5, 1].map(f => {
    const y = (PAD_TOP + f * plotH).toFixed(1)
    return <line key={f} x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="3,4" />
  })
}

export function TrendLine({ labels, values }) {
  const [boxRef, size] = useBoxSize()
  const { W, H, plotH, font } = trendFrame(size)
  const max = Math.max(...values) * 1.18
  const stepX = (W - PAD_L - PAD_R) / ((labels.length - 1) || 1)
  const points = values.map((v, i) => [PAD_L + i * stepX, PAD_TOP + (1 - v / max) * plotH])
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
  const areaPath = linePath + ` L${points[points.length - 1][0].toFixed(1)},${PAD_TOP + plotH} L${points[0][0].toFixed(1)},${PAD_TOP + plotH} Z`
  const lastIdx = points.length - 1
  return (
    <div ref={boxRef} style={TREND_BOX}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={TREND_SVG}>
        <defs>
          <linearGradient id="kdOvTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <GridLines W={W} plotH={plotH} />
        <path d={areaPath} fill="url(#kdOvTrendGrad)" />
        <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={`c${i}`} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r={i === lastIdx ? 5 : 3.5} fill={i === lastIdx ? 'var(--primary)' : 'var(--surface)'} stroke="var(--primary)" strokeWidth="2" />)}
        {points.map((p, i) => <text key={`l${i}`} x={p[0].toFixed(1)} y={H - 8} textAnchor="middle" fontSize={font} fill="var(--text-muted)" fontFamily={FONT_STACK}>{labels[i]}</text>)}
        {points.map((p, i) => <text key={`v${i}`} x={p[0].toFixed(1)} y={(p[1] - 13).toFixed(1)} textAnchor="middle" fontSize={font} fontWeight="700" fill="var(--primary)" fontFamily={FONT_STACK}>{values[i]}</text>)}
      </svg>
    </div>
  )
}

export function TrendBar({ labels, values }) {
  const [boxRef, size] = useBoxSize()
  const { W, H, plotH, font } = trendFrame(size)
  const max = Math.max(...values) * 1.18
  const stepX = (W - PAD_L - PAD_R) / labels.length
  const barW = stepX * 0.55
  const bars = values.map((v, i) => {
    const cx = PAD_L + stepX * i + stepX / 2
    const barH = (v / max) * plotH
    const y = PAD_TOP + plotH - barH
    return { cx, y, barH, v, label: labels[i] }
  })
  return (
    <div ref={boxRef} style={TREND_BOX}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={TREND_SVG}>
        <defs>
          <linearGradient id="kdOvTrendBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <GridLines W={W} plotH={plotH} />
        {bars.map((b, i) => <rect key={`b${i}`} x={(b.cx - barW / 2).toFixed(1)} y={b.y.toFixed(1)} width={barW.toFixed(1)} height={b.barH.toFixed(1)} rx="4" fill="url(#kdOvTrendBarGrad)" />)}
        {bars.map((b, i) => <text key={`l${i}`} x={b.cx.toFixed(1)} y={H - 8} textAnchor="middle" fontSize={font} fill="var(--text-muted)" fontFamily={FONT_STACK}>{b.label}</text>)}
        {bars.map((b, i) => <text key={`v${i}`} x={b.cx.toFixed(1)} y={(b.y - 8).toFixed(1)} textAnchor="middle" fontSize={font} fontWeight="700" fill="var(--primary)" fontFamily={FONT_STACK}>{b.v}</text>)}
      </svg>
    </div>
  )
}

/* ---------- Phễu bán hàng ---------- */
const isRedStage = s => s === 'bao-gia' || s === 'bao-gia-thi-cong'
const stageCounts = leads => STAGES.map(s => leads.filter(l => l.stage === s).length)

export function FunnelBars({ leads }) {
  const counts = stageCounts(leads)
  const max = Math.max(1, ...counts)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, height: '100%', minHeight: 70, overflowY: 'auto', paddingRight: 2, boxSizing: 'border-box', justifyContent: 'center' }}>
      {STAGES.map((s, i) => {
        const c = counts[i]
        const pct = Math.max(4, Math.round(c / max * 100))
        const accent = stageAccent(s)
        const barColor = isRedStage(s) ? 'var(--danger)' : (accent ? accent.border : 'var(--sales)')
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 120, flex: 'none', fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={STAGE_LABEL[s]}>{STAGE_LABEL[s]}</span>
            <div style={{ flex: 1, minWidth: 0, background: 'var(--surface-alt)', borderRadius: 5, height: 18, position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 5, transition: 'width .3s ease' }} />
            </div>
            <span className="mono" style={{ width: 22, flex: 'none', fontSize: 11.5, fontWeight: 700, textAlign: 'right', color: barColor }}>{c}</span>
          </div>
        )
      })}
    </div>
  )
}

export function FunnelColumns({ leads }) {
  const counts = stageCounts(leads)
  const max = Math.max(1, ...counts)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%', minHeight: 70, overflowX: 'auto', paddingBottom: 2, boxSizing: 'border-box' }}>
      {STAGES.map((s, i) => {
        const c = counts[i]
        const h = Math.max(16, Math.round(c / max * 100))
        const accent = stageAccent(s)
        const isRed = isRedStage(s)
        const barColor = isRed ? 'var(--danger)' : (accent ? accent.border : 'var(--sales-tint)')
        const textColor = (isRed || accent) ? '#fff' : 'var(--sales)'
        return (
          <div key={s} style={{ flex: 1, minWidth: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ width: '100%', height: `${h}%`, background: barColor, borderRadius: '6px 6px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 4 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: textColor }}>{c}</span>
            </div>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2 }}>{STAGE_LABEL[s]}</span>
          </div>
        )
      })}
    </div>
  )
}

export function FunnelDonut({ leads }) {
  const [boxRef, size] = useBoxSize()
  const counts = stageCounts(leads)
  const total = counts.reduce((a, b) => a + b, 0) || 1
  const colors = STAGES.map(s => {
    const accent = stageAccent(s)
    return isRedStage(s) ? 'var(--danger)' : (accent ? accent.border : 'var(--sales)')
  })
  const cx = 70, cy = 70, r = 55, strokeW = 26
  const circumference = 2 * Math.PI * r
  let offsetAcc = 0
  const segments = STAGES.map((s, i) => {
    const dash = counts[i] / total * circumference
    const seg = (
      <circle
        key={s} cx={cx} cy={cy} r={r} fill="none" stroke={colors[i]} strokeWidth={strokeW}
        strokeDasharray={`${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`}
        strokeDashoffset={(-offsetAcc).toFixed(2)} transform={`rotate(-90 ${cx} ${cy})`}
      />
    )
    offsetAcc += dash
    return seg
  })
  /* Vòng tròn lớn theo khung (giới hạn bởi chiều cao và ~40% chiều rộng); chú thích xếp theo cột cho vừa chiều cao */
  const boxW = size ? size.w : 480
  const boxH = size ? size.h : 140
  const donut = Math.max(56, Math.min(boxH, boxW * 0.4))
  const big = boxH >= 200
  const rowH = big ? 26 : 19
  const rows = Math.max(1, Math.min(STAGES.length, Math.floor(boxH / rowH)))
  const cols = Math.ceil(STAGES.length / rows)
  const usedRows = Math.ceil(STAGES.length / cols)
  return (
    <div ref={boxRef} style={{ display: 'flex', alignItems: 'center', gap: big ? 28 : 18, flex: 1, minHeight: 0, minWidth: 0 }}>
      <svg width={donut} height={donut} viewBox="0 0 140 140" style={{ flex: 'none' }}>
        {segments}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text)" fontFamily={FONT_STACK}>{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9.5" fill="var(--text-muted)" fontFamily={FONT_STACK}>cơ hội</text>
      </svg>
      <div style={{ flex: 1, minWidth: 0, maxHeight: '100%', overflow: 'auto', display: 'grid', gridAutoFlow: 'column', gridTemplateRows: `repeat(${usedRows}, auto)`, gridAutoColumns: 'minmax(140px, 260px)', gap: big ? '9px 28px' : '5px 16px', alignContent: 'safe center' }}>
        {STAGES.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: big ? 8 : 6, fontSize: big ? 12.5 : 10.5, minWidth: 0 }}>
            <span style={{ width: big ? 11 : 9, height: big ? 11 : 9, borderRadius: 2, background: colors[i], flex: 'none' }} />
            <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={STAGE_LABEL[s]}>{STAGE_LABEL[s]}</span>
            <span className="mono" style={{ fontWeight: 700, color: colors[i] }}>{counts[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
