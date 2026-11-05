import { useEffect, useMemo, useState } from 'react'
import { useQs } from '../../state/QsData'
import { usePref, TypeSw, TrendChart, TrendLegend, RankChart, TREND_TYPES, RANK_TYPES } from './ImportChart'
import SearchSelect from '../common/SearchSelect'

/* Dashboard "Ghi nhận dữ liệu nhập" (cột trái tab Nhập dữ liệu, dưới Sản phẩm vừa nhập): đếm sản phẩm đã nhập vào danh mục
   theo kỳ (Hôm nay · Tuần · Tháng · Quý · Năm · Tuỳ chọn), lọc theo Người nhập / Người duyệt / Thương hiệu.
   Dữ liệu = danh mục sản phẩm đã tải (ngayTao, nguoiTao, nguoiDuyet, daDuyet, thuongHieu). Biểu đồ cột theo giờ / ngày / tháng tuỳ kỳ. */
const PERIODS = [['d', 'Hôm nay'], ['w', 'Tuần'], ['m', 'Tháng'], ['q', 'Quý'], ['y', 'Năm'], ['c', 'Tuỳ chọn']]
const DAY = 86400000
const s_ = v => String(v == null ? '' : v).trim()
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const startOf = (p, now) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'w') { const wd = (d.getDay() + 6) % 7; return new Date(d.getTime() - wd * DAY) }
  if (p === 'm') return new Date(d.getFullYear(), d.getMonth(), 1)
  if (p === 'q') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
  if (p === 'y') return new Date(d.getFullYear(), 0, 1)
  return d
}

/* Props: open (khung biểu đồ lớn đang mở sang phải cột trái) · onOpen(bool). Trạng thái ở ImportTab: mỗi lúc chỉ 1 khung mở.
   onKpi({n, nDuyet, nBrand, perTx, rangeTx}): báo số tổng theo kỳ + bộ lọc đang chọn lên thanh số liệu đầu tab. */
export default function ImportStats({ open, onOpen, onKpi }) {
  const { products } = useQs()
  const [per, setPer] = useState('m')
  const now = new Date()
  const [from, setFrom] = useState(ymd(new Date(now.getTime() - 29 * DAY)))
  const [to, setTo] = useState(ymd(now))
  const [fNhap, setFNhap] = useState('')
  const [fDuyet, setFDuyet] = useState('')
  const [fBrand, setFBrand] = useState('')

  const range = useMemo(() => {
    if (per === 'c') { const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00'); return [a, new Date(b.getTime() + DAY)] }
    return [startOf(per, new Date()), new Date(new Date().setHours(24, 0, 0, 0))]
  }, [per, from, to])
  const all = (products || []).filter(p => !p.spChung)
  const opts = k => [...new Set(all.map(p => s_(p[k])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))
  const inRange = useMemo(() => all.filter(p => {
    const t = Date.parse(p.ngayTao); if (!t) return false
    if (t < range[0].getTime() || t >= range[1].getTime()) return false
    if (fNhap && s_(p.nguoiTao) !== fNhap) return false
    if (fDuyet && s_(p.nguoiDuyet) !== fDuyet) return false
    if (fBrand && s_(p.thuongHieu) !== fBrand) return false
    return true
  }), [products, range, fNhap, fDuyet, fBrand])   // eslint-disable-line react-hooks/exhaustive-deps

  const nDuyet = inRange.filter(p => p.daDuyet).length
  const nBrand = new Set(inRange.map(p => s_(p.thuongHieu)).filter(Boolean)).size
  /* cột biểu đồ: Hôm nay theo giờ, ≤ 62 ngày theo ngày, dài hơn theo tháng */
  const bars = useMemo(() => {
    const [a, b] = range
    const span = (b - a) / DAY
    const unit = per === 'd' ? 'h' : span <= 62 ? 'd' : 'mo'
    const keyOf = d => unit === 'h' ? d.getHours() + 'h' : unit === 'd' ? d.getDate() + '/' + (d.getMonth() + 1) : 'T' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2)
    const keys = []
    if (unit === 'h') for (let h = 0; h < 24; h++) keys.push(h + 'h')
    else if (unit === 'd') for (let t = a.getTime(); t < b.getTime(); t += DAY) keys.push(keyOf(new Date(t)))
    else for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d < b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) keys.push(keyOf(d))
    const m = {}, a2 = {}; keys.forEach(k => { m[k] = 0; a2[k] = 0 })
    inRange.forEach(p => { const k = keyOf(new Date(Date.parse(p.ngayTao))); if (k in m) { m[k]++; if (p.daDuyet) a2[k]++ } })
    return keys.map(k => [k, m[k], a2[k]])
  }, [inRange, range, per])
  const byKey = k => { const m = {}; inRange.forEach(p => { const v = s_(p[k]) || '(không rõ)'; m[v] = (m[v] || 0) + 1 }); return Object.entries(m).sort((x, y) => y[1] - x[1]) }
  const allNhap = useMemo(() => byKey('nguoiTao'), [inRange])   // eslint-disable-line react-hooks/exhaustive-deps
  const allBrand = useMemo(() => byKey('thuongHieu'), [inRange])   // eslint-disable-line react-hooks/exhaustive-deps
  /* dạng biểu đồ (nhớ trong máy): thời gian dùng chung cho khung nhỏ + khung lớn; xếp hạng riêng từng khung */
  const [trT, setTrT] = usePref('qs_imp_trend', 'bar')
  const [rkT, setRkT] = usePref('qs_imp_rank', 'list')
  const [rkT2, setRkT2] = usePref('qs_imp_rank2', 'list')
  const pickNhap = k => setFNhap(v => (v === k ? '' : k))
  const pickBrand = k => setFBrand(v => (v === k ? '' : k))
  const rangeTx = range[0].toLocaleDateString('vi-VN') + ' – ' + new Date(range[1] - DAY).toLocaleDateString('vi-VN')
  const perTx = (PERIODS.find(p => p[0] === per) || [])[1]
  const listBox = (title, rows, onPick, cur, t, setT) => (
    <div className="qsi-sf-list">
      <div className="t"><span>{title} <em>{rows.length}</em></span><TypeSw types={RANK_TYPES} val={t} onChange={setT} /></div>
      <RankChart rows={rows} type={t} onPick={onPick} cur={cur} big />
    </div>
  )
  const nFlt = [fNhap, fDuyet, fBrand].filter(Boolean).length
  useEffect(() => { if (onKpi) onKpi({ n: inRange.length, nDuyet, nBrand, perTx, rangeTx }) }, [inRange.length, nDuyet, nBrand, perTx, rangeTx])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={'qsi-stats' + (open ? ' open' : '')}>
      <div className="qsi-stats-h"><b>Ghi nhận dữ liệu nhập</b><span>{rangeTx}</span></div>
      <div className="qsi-stats-mod">
      <div className="qsi-stats-per" role="group" aria-label="Kỳ thống kê">
        <div className="seg">{PERIODS.filter(p => p[0] !== 'c').map(p => <button type="button" key={p[0]} className={per === p[0] ? 'on' : ''} onClick={() => setPer(p[0])}>{p[1]}</button>)}</div>
        <button type="button" className={'cus' + (per === 'c' ? ' on' : '')} title="Tuỳ chọn khoảng ngày" aria-pressed={per === 'c'} onClick={() => setPer('c')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <span>Tuỳ chọn</span>
        </button>
      </div>
      {per === 'c' && (
        <div className="qsi-stats-range">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          <span className="ar" aria-hidden="true">→</span>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </div>
      )}
      <div className="qsi-stats-flt">
        <label><span>Người nhập</span><SearchSelect className="sm" value={fNhap} options={opts('nguoiTao')} allLabel="Tất cả người nhập" onChange={setFNhap} /></label>
        <label><span>Người duyệt</span><SearchSelect className="sm" value={fDuyet} options={opts('nguoiDuyet')} allLabel="Tất cả người duyệt" onChange={setFDuyet} /></label>
        <label><span>Thương hiệu</span><SearchSelect className="sm" value={fBrand} options={opts('thuongHieu')} allLabel="Tất cả thương hiệu" onChange={setFBrand} /></label>
        {nFlt > 0 && <button type="button" className="qsi-stats-clr" onClick={() => { setFNhap(''); setFDuyet(''); setFBrand('') }}>Xoá lọc ({nFlt})</button>}
      </div>
      <div className="qsi-stats-kpi">
        <div><b>{inRange.length}</b><span>SKU đã nhập</span></div>
        <div><b>{nDuyet}</b><span>Đã duyệt</span></div>
        <div><b>{inRange.length - nDuyet}</b><span>Chưa duyệt</span></div>
        <div><b>{nBrand}</b><span>Thương hiệu</span></div>
      </div>
      </div>
      {/* khung biểu đồ lớn đang mở: ẩn biểu đồ nhỏ (trùng) - cột trái chỉ còn điều khiển (kỳ, lọc, số tổng) + Người nhập; khung lớn = biểu đồ + Thương hiệu */}
      {!open && <div className="qsi-stats-chartbox">
      <div className="qsi-stats-chh">
        <TypeSw types={TREND_TYPES} val={trT} onChange={setTrT} />
        <button type="button" className={'qsi-stats-zoom' + (open ? ' on' : '')} aria-expanded={!!open} title={open ? 'Thu gọn biểu đồ' : 'Mở rộng biểu đồ sang phải'} onClick={() => onOpen(!open)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{open ? <><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="m14 10 7-7" /><path d="m3 21 7-7" /></> : <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></>}</svg>
          {open ? 'Thu gọn' : 'Mở rộng'}
        </button>
      </div>
      <TrendChart bars={bars} type={trT} onClick={() => onOpen(!open)} />
      <div className="qsi-stats-axis"><span>{bars.length ? bars[0][0] : ''}</span><TrendLegend type={trT} /><span>{bars.length ? bars[bars.length - 1][0] : ''}</span></div>
      </div>}
      {allNhap.length > 0 && (
        <div className="qsi-stats-top">
          <div className="t"><span>Người nhập nhiều nhất</span><TypeSw types={RANK_TYPES} val={rkT} onChange={setRkT} /></div>
          <RankChart rows={allNhap} type={rkT} onPick={pickNhap} cur={fNhap} />
        </div>
      )}
      {open && (
        <div className="qsi-stats-fly">
          <div className="qsi-sf-h">
            <div><b>Biểu đồ dữ liệu nhập</b><span>{perTx} · {rangeTx}</span></div>
            <button type="button" className="qsi-recent-x" title="Đóng" onClick={() => onOpen(false)}>✕</button>
          </div>
          <div className="qsi-sf-b">
            <div className="qsi-sf-chbox">
              <div className="qsi-sf-chh"><b>Số sản phẩm nhập theo thời gian</b><TrendLegend type={trT} /><TypeSw types={TREND_TYPES} val={trT} onChange={setTrT} text /></div>
              <TrendChart bars={bars} type={trT} big />
            </div>
            <div className="qsi-sf-lists one">
              {listBox('Theo thương hiệu', allBrand, pickBrand, fBrand, rkT2, setRkT2)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
