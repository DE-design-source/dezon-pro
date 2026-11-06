import { useState } from 'react'

/* Biểu đồ của "Ghi nhận dữ liệu nhập" (ImportStats): nhiều dạng, đổi bằng TypeSw, dạng chọn nhớ trong máy.
   TrendChart: số sản phẩm theo thời gian - Cột · Đường · Cột chồng (đã duyệt / chưa duyệt).
   RankChart: xếp hạng (người nhập, thương hiệu) - Thanh ngang · Tròn · Cột. */
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']   // màu phân loại, gán theo thứ tự cố định
const OTHER = '#a8a7a1'
export const niceMax = v => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); return [1, 2, 5, 10].map(k => k * p).find(x => x >= v) }

export function usePref(key, def) {
  const [v, setV] = useState(() => { try { return localStorage.getItem(key) || def } catch (e) { return def } })
  const set = x => { setV(x); try { localStorage.setItem(key, x) } catch (e) { /* bỏ qua */ } }
  return [v, set]
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const ICONS = {
  bar: <path d="M4 20h16M7 20v-8M12 20V5M17 20v-5" {...P} />,
  line: <path d="M4 20h16M4 16l5-6 4 3 7-8" {...P} />,
  stack: <path d="M4 20h16M7 20v-5M7 15v-4M12 20V12M12 12V5M17 20v-4M17 16v-5" {...P} />,
  list: <path d="M4 6h12M4 12h16M4 18h8" {...P} />,
  donut: <><circle cx="12" cy="12" r="8" {...P} /><path d="M12 4a8 8 0 0 1 8 8h-8z" {...P} /></>,
  col: <path d="M4 20h16M7 20v-11M12 20v-7M17 20v-4" {...P} />,
}
export const TREND_TYPES = [['bar', 'Cột'], ['line', 'Đường'], ['stack', 'Duyệt / chưa duyệt']]
export const RANK_TYPES = [['list', 'Thanh ngang'], ['donut', 'Tròn'], ['col', 'Cột']]

export function TypeSw({ types, val, onChange, text }) {
  return (
    <div className={'qsi-tsw' + (text ? ' text' : '')} role="group" aria-label="Dạng biểu đồ">
      {types.map(([k, l]) => (
        <button type="button" key={k} className={val === k ? 'on' : ''} title={'Biểu đồ ' + l.toLowerCase()} aria-pressed={val === k} onClick={() => onChange(k)}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">{ICONS[k]}</svg>{text && <span>{l}</span>}
        </button>
      ))}
    </div>
  )
}

/* bars: [[nhãn, tổng, đã duyệt]] */
export function TrendChart({ bars, type, big, onClick }) {
  const max = Math.max(1, ...bars.map(b => b[1]))
  const yMax = big ? niceMax(max) : max
  const n = bars.length
  const step = Math.max(1, Math.ceil(n / 16))
  const iMax = bars.reduce((m, b, i) => (b[1] > bars[m][1] ? i : m), 0)
  const showVal = (b, i) => big && b[1] > 0 && (n <= 16 || i === iMax)
  const h = v => (v / yMax * 100) + '%'
  const pts = bars.map((b, i) => [(i + 0.5), 100 - b[1] / yMax * 100])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ')
  return (
    <div className={'qsi-ch' + (big ? ' big' : '') + ' t-' + type} onClick={onClick}>
      {big && <div className="y">{[yMax, yMax / 2, 0].map(v => <span key={v}>{Math.round(v)}</span>)}</div>}
      <div className="plot" role="img" aria-label="Số sản phẩm nhập theo thời gian">
        <div className="grid">{big && <><i /><i /></>}<i /></div>
        {type === 'line' && n > 0 && (
          <svg className="ln" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
            <path d={line + ` L${pts[n - 1][0]} 100 L${pts[0][0]} 100 Z`} className="area" />
            <path d={line} className="stroke" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        {bars.map((b, i) => (
          <div key={b[0]} className="col" title={b[0] + ': ' + b[1] + ' sản phẩm' + (type === 'stack' ? ' (đã duyệt ' + b[2] + ', chưa duyệt ' + (b[1] - b[2]) + ')' : '')}>
            <div className="bar">
              {type === 'bar' && <i style={{ height: h(b[1]) }} className={b[1] ? '' : 'zero'}>{showVal(b, i) && <em>{b[1]}</em>}</i>}
              {type === 'stack' && (b[1] ? (
                <div className="stk" style={{ height: h(b[1]) }}>
                  {showVal(b, i) && <em>{b[1]}</em>}
                  {b[1] - b[2] > 0 && <i className="p" style={{ flexGrow: b[1] - b[2] }} />}
                  {b[2] > 0 && <i className="a" style={{ flexGrow: b[2] }} />}
                </div>
              ) : <i className="zero" />)}
              {type === 'line' && b[1] > 0 && <b className="dot" style={{ bottom: h(b[1]) }}>{showVal(b, i) && <em>{b[1]}</em>}</b>}
            </div>
            {big && <span className="x">{i % step === 0 ? b[0] : ''}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrendLegend({ type }) {
  if (type !== 'stack') return null
  return <div className="qsi-chlg"><span><i className="a" />Đã duyệt</span><span><i className="p" />Chưa duyệt</span></div>
}

/* rows: [[tên, số]] đã sắp giảm dần. onPick(tên) lọc theo dòng, cur = dòng đang lọc */
export function RankChart({ rows, type, onPick, cur, big }) {
  if (!rows.length) return <div className="qsi-sf-empty">Không có dữ liệu trong kỳ này.</div>
  const total = rows.reduce((s, r) => s + r[1], 0)
  const pct = v => Math.round(v / total * 1000) / 10 + '%'
  if (type === 'donut') {
    const head = rows.slice(0, CAT.length)
    const rest = rows.slice(CAT.length).reduce((s, r) => s + r[1], 0)
    const seg = head.map((r, i) => [r[0], r[1], CAT[i]]).concat(rest ? [['Khác', rest, OTHER]] : [])
    let acc = 0
    const grad = seg.map(([, v, c]) => { const a = acc / total * 360; acc += v; return `${c} ${a}deg ${acc / total * 360}deg` }).join(', ')
    return (
      <div className={'qsi-rk-donut' + (big ? ' big' : '')}>
        <div className="ring" style={{ background: `conic-gradient(${grad})` }} role="img" aria-label="Tỉ lệ"><div className="hole"><b>{total}</b><span>SKU</span></div></div>
        <div className="lg">
          {seg.map(([k, v, c], i) => (
            <button type="button" key={k + i} className={cur === k ? 'on' : ''} disabled={i >= head.length} title={i >= head.length ? (rows.length - head.length) + ' mục còn lại' : 'Bấm để lọc theo ' + k} onClick={() => onPick(k)}>
              <i style={{ background: c }} /><span>{k}</span><b>{v}</b><small>{pct(v)}</small>
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (type === 'col') {
    const ds = rows.slice(0, big ? 12 : 6)
    const mx = ds[0][1]
    return (
      <div className={'qsi-rk-col' + (big ? ' big' : '')}>
        {ds.map(([k, v]) => (
          <button type="button" key={k} className={cur === k ? 'on' : ''} title={k + ': ' + v + ' (' + pct(v) + ') - bấm để lọc'} onClick={() => onPick(k)}>
            <span className="bar"><i style={{ height: (v / mx * 100) + '%' }}><em>{v}</em></i></span>
            <span className="nm">{k}</span>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="qsi-rk-list">
      {rows.map(([k, v]) => (
        <button type="button" key={k} className={cur === k ? 'on' : ''} title={'Bấm để lọc theo ' + k} onClick={() => onPick(k)}>
          <span>{k}</span><i style={{ width: (v / rows[0][1] * 100) + '%' }} /><b>{v}</b>
        </button>
      ))}
    </div>
  )
}
