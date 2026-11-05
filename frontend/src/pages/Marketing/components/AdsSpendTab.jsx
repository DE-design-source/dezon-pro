import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkSession } from '../../../services/workSession'
import DatePicker from '../../../components/ui/DatePicker'
import * as qsApi from '../../QS/api/qsApi'

/* Tab "Chi tiêu quảng cáo": chi tiêu hằng ngày theo kênh (Facebook, Google Ads...). Gồm: ô số tổng · BẢNG NHẬP (ngày x kênh, gõ thẳng) ·
   chi theo ngày · chi theo kênh; nhập / xuất CSV cùng cấu trúc file gốc (cột đầu = Ngày dd/mm/yyyy, mỗi cột sau = 1 kênh; số có thể ở dạng
   1.832434e+06). Lưu: trình duyệt (localStorage mk_ads_spend), đã đăng nhập thì lưu chung công ty trên máy chủ (dữ liệu công ty 'mkAds').
   phuTrach = {kênh: [tên đăng nhập, ...]} (1 kênh nhiều người cùng xử lý; bản cũ lưu 1 chuỗi vẫn đọc được): quản trị thấy / giao mọi kênh,
   nhân sự chỉ thấy và nhập kênh mình có tên. */
/* danh sách người phụ trách của 1 kênh */
const ptDs_ = (pt, k) => { const x = (pt || {})[k]; return (Array.isArray(x) ? x : x ? [x] : []).map(String).filter(Boolean) }
/* icon người phụ trách: chữ cái đầu (tên cuối + tên đầu), màu theo tên */
const AV_MAU = ['#C23B78', '#2f6fb0', '#1f8a5b', '#b7791f', '#6b46c1', '#c05621', '#2c7a7b', '#9b2c2c']
const avChu = t => { const p = String(t || '?').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 1][0] + p[0][0] : p[0].slice(0, 2)) || '?').toUpperCase() }
const avMau = t => { let h = 0; String(t || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) | 0 }); return AV_MAU[Math.abs(h) % AV_MAU.length] }
/* bỏ dấu tiếng Việt để tìm tên */
const khongDau = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
/* Nút "+" phụ trách: hộp nổi có ô gõ để tìm + danh sách đánh dấu (chọn / bỏ nhiều người, ghi ngay); bấm ra ngoài hoặc Esc để đóng.
   Hộp vẽ ra thẳng .mk-page (portal - giữ biến màu của trang) + position:fixed theo vị trí nút: ô tiêu đề sticky của bảng tạo lớp xếp chồng riêng,
   vẽ trong ô thì dòng Tổng (sticky) đè lên hộp */
/* Biểu đồ "Lũy kế chi tiêu": đường cộng dồn chi tiêu theo ngày của kỳ đang xem (màu Marketing) so với kỳ trước cùng độ dài
   (xám, nét đứt) - thấy ngay đang tiêu nhanh / chậm hơn kỳ trước. cur / prev = mảng lũy kế theo thứ tự ngày (null = ngày chưa tới).
   Rê chuột: đường dóng + giá trị 2 kỳ tại ngày đó. Vẽ đúng bề rộng thật của khung (không kéo giãn chữ) */
function LuyKeChart({ ngay, cur, prev, nhanPrev }) {
  const ref = useRef(null)
  const [w, setW] = useState(480)
  const [hv, setHv] = useState(-1)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { const x = Math.round(el.clientWidth - 36); if (x > 0) setW(x) })
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const W = Math.max(280, w); const H = 240; const padL = 50; const padB = 26; const padT = 14; const padR = 10
  const n = Math.max(ngay.length, prev.length, 1)
  const yMax = Math.max(1e6, ...cur.filter(x => x != null), ...prev)
  const buoc = Math.pow(10, Math.floor(Math.log10(Math.max(1, yMax / 3))))
  const tick = Math.max(1, Math.ceil(yMax / 3 / buoc) * buoc)
  const top = tick * 3
  const x = i => padL + (n <= 1 ? 0 : i * (W - padL - padR) / (n - 1))
  const y = v => padT + (H - padT - padB) * (1 - v / top)
  const duong = ds => { let d = ''; ds.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1) }); return d }
  const cuoi = (() => { for (let i = cur.length - 1; i >= 0; i--) if (cur[i] != null) return i; return -1 })()
  const buocNhan = Math.ceil(n / Math.max(3, Math.floor(W / 80)))
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width * W
    setHv(Math.max(0, Math.min(n - 1, Math.round((px - padL) / ((W - padL - padR) / Math.max(1, n - 1))))))
  }
  const ci = hv >= 0 ? cur[hv] : null; const pi = hv >= 0 ? prev[hv] : null
  return (
    <div className="mk-ads-chart" ref={ref} onMouseLeave={() => setHv(-1)}>
      <svg viewBox={'0 0 ' + W + ' ' + H} width={W} height={H} role="img" aria-label="Biểu đồ lũy kế chi tiêu kỳ này so với kỳ trước" onMouseMove={onMove}>
        {[0, 1, 2, 3].map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(tick * t)} y2={y(tick * t)} className="grid" />
            <text x={padL - 6} y={y(tick * t) + 3} textAnchor="end" className="ax">{fmtM(tick * t)}</text>
          </g>
        ))}
        {ngay.map((d, i) => (i % buocNhan === 0 ? <text key={d} x={x(i)} y={H - 7} textAnchor="middle" className="ax">{nhanNgay(d)}</text> : null))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="base" />
        {prev.length > 0 && <path d={duong(prev)} className="lk-prev" />}
        {cuoi >= 0 && <path d={duong(cur) + 'L' + x(cuoi).toFixed(1) + ',' + y(0) + 'L' + x(0).toFixed(1) + ',' + y(0) + 'Z'} className="lk-area" />}
        <path d={duong(cur)} className="lk-cur" />
        {cuoi >= 0 && <circle cx={x(cuoi)} cy={y(cur[cuoi])} r="4.5" className="lk-dot" />}
        {hv >= 0 && (
          <g>
            <line x1={x(hv)} x2={x(hv)} y1={padT} y2={y(0)} className="lk-hair" />
            {ci != null && <circle cx={x(hv)} cy={y(ci)} r="4" className="lk-dot" />}
            {pi != null && <circle cx={x(hv)} cy={y(pi)} r="4" className="lk-dotp" />}
          </g>
        )}
      </svg>
      {hv >= 0 && (
        <div className="mk-ads-tip" style={{ left: (x(hv) / W * 100) + '%' }}>
          <b>Ngày thứ {hv + 1}{ngay[hv] ? ' · ' + nhanNgay(ngay[hv]) : ''}</b>
          <span><i><em className="lk-sw cur" />Kỳ này</i>{ci != null ? fmt(ci) + ' đ' : '—'}</span>
          {prev.length > 0 && <span><i><em className="lk-sw prev" />{nhanPrev}</i>{pi != null ? fmt(pi) + ' đ' : '—'}</span>}
        </div>
      )}
    </div>
  )
}
/* Shortlist chọn kênh: nút "Chọn kênh (n/N)" mở hộp có ô gõ tìm + danh sách đánh dấu (chọn / bỏ nhiều kênh); hộp vẽ ra .mk-page */
function KenhPicker({ ds, chon, onChange }) {
  const [mo, setMo] = useState(null)
  const [q, setQ] = useState('')
  const hop = useRef(null); const nut = useRef(null)
  useEffect(() => {
    if (!mo) return undefined
    const dong = e => { if (hop.current && !hop.current.contains(e.target) && nut.current && !nut.current.contains(e.target)) setMo(null) }
    const esc = e => { if (e.key === 'Escape') setMo(null) }
    document.addEventListener('mousedown', dong); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', dong); document.removeEventListener('keydown', esc) }
  }, [mo])
  const moHop = () => {
    if (mo) { setMo(null); return }
    const r = nut.current.getBoundingClientRect()
    setQ(''); setMo({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) })
  }
  const tim = khongDau(q.trim())
  const hien = ds.filter(k => !tim || khongDau(k).indexOf(tim) >= 0)
  const doi = k => onChange(chon.indexOf(k) >= 0 ? chon.filter(x => x !== k) : chon.concat([k]))
  return (
    <>
      <button type="button" ref={nut} className={'mk-ads-kpick' + (mo ? ' on' : '')} onClick={moHop} title="Chọn các kênh (page) muốn xem">
        Chọn kênh <b>{chon.length}/{ds.length}</b> <span aria-hidden="true">▾</span>
      </button>
      {mo && createPortal(
        <div ref={hop} className="mk-ads-pick" style={{ top: mo.top, left: mo.left, width: 280 }}>
          <input autoFocus value={q} placeholder="Gõ tên kênh để tìm…" onChange={e => setQ(e.target.value)} />
          <div className="ds">
            {hien.length ? hien.map(k => (
              <label key={k} className={chon.indexOf(k) >= 0 ? 'on' : ''}>
                <input type="checkbox" checked={chon.indexOf(k) >= 0} onChange={() => doi(k)} />
                <span className="t"><b>{k}</b></span>
              </label>
            )) : <p>Không thấy kênh "{q}"</p>}
          </div>
          <div className="ft"><span>Đã chọn {chon.length}</span><button type="button" onClick={() => onChange(ds.slice())}>Chọn hết</button><button type="button" onClick={() => onChange([])}>Bỏ hết</button><button type="button" className="xong" onClick={() => setMo(null)}>Xong</button></div>
        </div>, (nut.current && nut.current.closest('.mk-page')) || document.body
      )}
    </>
  )
}
function PtPicker({ ds, users, onChange }) {
  const [mo, setMo] = useState(null)   // {top, left} khi đang mở
  const [q, setQ] = useState('')
  const hop = useRef(null); const nut = useRef(null)
  useEffect(() => {
    if (!mo) return undefined
    const dong = e => { if (hop.current && !hop.current.contains(e.target) && nut.current && !nut.current.contains(e.target)) setMo(null) }
    const esc = e => { if (e.key === 'Escape') setMo(null) }
    document.addEventListener('mousedown', dong); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', dong); document.removeEventListener('keydown', esc) }
  }, [mo])
  const moHop = () => {
    if (mo) { setMo(null); return }
    const r = nut.current.getBoundingClientRect()
    setQ(''); setMo({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 110, window.innerWidth - 268)) })
  }
  const tim = khongDau(q.trim())
  const ds2 = users.filter(u => u.active !== false && (!tim || khongDau((u.hoTen || '') + ' ' + u.username).indexOf(tim) >= 0))
    .sort((a, b) => (ds.indexOf(b.username) >= 0) - (ds.indexOf(a.username) >= 0) || String(a.hoTen || a.username).localeCompare(String(b.hoTen || b.username), 'vi'))
  const doi = u => onChange(ds.indexOf(u) >= 0 ? ds.filter(x => x !== u) : ds.concat([u]))
  return (
    <>
      <button type="button" ref={nut} className={'add' + (mo ? ' on' : '')} title="Chọn người cùng xử lý kênh này" onClick={moHop}>+</button>
      {mo && createPortal(
        <div ref={hop} className="mk-ads-pick" style={{ top: mo.top, left: mo.left }}>
          <input autoFocus value={q} placeholder="Gõ tên để tìm nhân sự…" onChange={e => setQ(e.target.value)} />
          <div className="ds">
            {ds2.length ? ds2.map(u => {
              const on = ds.indexOf(u.username) >= 0
              return (
                <label key={u.username} className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on} onChange={() => doi(u.username)} />
                  <span className="av" style={{ background: avMau(u.username) }}>{avChu(u.hoTen || u.username)}</span>
                  <span className="t"><b>{u.hoTen || u.username}</b>{u.hoTen ? <i>{u.username}</i> : null}</span>
                </label>
              )
            }) : <p>Không thấy nhân sự "{q}"</p>}
          </div>
          <div className="ft"><span>Đã chọn {ds.length}</span>{ds.length > 0 && <button type="button" onClick={() => onChange([])}>Bỏ hết</button>}<button type="button" className="xong" onClick={() => setMo(null)}>Xong</button></div>
        </div>, (nut.current && nut.current.closest('.mk-page')) || document.body
      )}
    </>
  )
}
const LS = 'mk_ads_spend'
const fmt = n => Math.round(Number(n) || 0).toLocaleString('vi-VN')
const fmtM = n => { n = Number(n) || 0; if (!n) return '0'; if (n < 1e6) return Math.round(n / 1000) + 'k'; const v = n / 1e6; return (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',') + 'tr' }

function napLs() { try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); return v && Array.isArray(v.kenh) && Array.isArray(v.ngay) ? v : null } catch (e) { return null } }
function luuLs(v) { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS) } catch (e) { /* bỏ qua */ } }

/* tách 1 dòng CSV (có ngoặc kép) */
function tachDong(s) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}
/* số kiểu 1.832434e+06 / 750877 / "1.234.567" (dấu chấm ngăn nghìn) -> số; trống -> null */
function docSo(t) {
  t = String(t || '').trim()
  if (!t) return null
  if (/e[+-]?\d+$/i.test(t) || /^\d+(\.\d+)?$/.test(t) && !/^\d{1,3}(\.\d{3})+$/.test(t)) { const n = Number(t); return isFinite(n) ? n : null }
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? n : null
}
/* CSV -> {kenh: [tên], ngay: [{d: 'yyyy-mm-dd', v: [số|null]}]} (ngày tăng dần) */
export function docCsvChiTieu(text) {
  const dong = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(x => x.trim())
  if (dong.length < 2) throw new Error('File không có dữ liệu')
  const dau = tachDong(dong[0]).map(x => x.trim())
  const kenh = dau.slice(1)
  if (!kenh.length) throw new Error('Không thấy cột kênh nào (cột đầu là Ngày, các cột sau là kênh)')
  const ngay = []
  dong.slice(1).forEach(l => {
    const c = tachDong(l)
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(c[0] || '').trim())
    if (!m) return
    const d = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0')
    ngay.push({ d, v: kenh.map((k, i) => docSo(c[i + 1])) })
  })
  if (!ngay.length) throw new Error('Không đọc được dòng ngày nào (định dạng ngày dd/mm/yyyy)')
  ngay.sort((a, b) => (a.d < b.d ? -1 : 1))
  return { kenh, ngay }
}
const nhanNgay = d => d.slice(8, 10) + '/' + d.slice(5, 7)
/* thứ trong tuần của ngày ISO: T2..T7, CN */
const thuNgay = d => { const t = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay(); return t ? 'T' + (t + 1) : 'CN' }
const nhanThang = k => 'Tháng ' + Number(k.slice(5, 7)) + '/' + k.slice(0, 4)

/* Kênh mặc định = các cột của bảng theo dõi chi tiêu (file "Sale + Marketing Base ... Chi tiêu hằng ngày"); thêm / đổi tên / bỏ được */
const KENH_MAC = ['Facebook Decox', 'Ads Google Website', 'Facebook Design', 'Decox Construction', 'Facebook Kiến Phong', 'Facebook Smart Cons Tech', 'HM Cons', 'Dezon']
const thangNay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }
/* mọi ngày của tháng 'yyyy-mm' (mới nhất ở trên như file gốc) */
const ngayCuaThang = k => { const y = +k.slice(0, 4); const m = +k.slice(5, 7); const n = new Date(y, m, 0).getDate(); const out = []; for (let i = n; i >= 1; i--) out.push(k + '-' + String(i).padStart(2, '0')); return out }
const soHien = n => (n == null || n === '' ? '' : fmt(n))
/* ngày 'yyyy-mm-dd' theo giờ máy */
const isoNgay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
/* các ngày từ a tới b (tăng dần), tối đa 400 ngày */
const ngayTu = (a, b) => { const out = []; const d = new Date(a + 'T00:00:00'); const e = new Date(b + 'T00:00:00'); for (let i = 0; d <= e && i < 400; i++) { out.push(isoNgay(d)); d.setDate(d.getDate() + 1) } return out }
const thangCong = (k, n) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }
/* bộ lọc thời gian: Tháng (chuyển tháng trước / sau) · Tuần này · 7 ngày qua · Tuỳ chọn (từ - đến) · Mọi lúc (ngày đã có số) */
const KY_DS = [['thang', 'Tháng'], ['tuan', 'Tuần này'], ['7n', '7 ngày qua'], ['tuy', 'Tuỳ chọn'], ['tat', 'Mọi lúc']]

export default function AdsSpendTab({ visible }) {
  const [data, setDataS] = useState(() => napLs() || { kenh: KENH_MAC.slice(), ngay: [] })
  const [ky, setKy] = useState('thang')          // kiểu kỳ đang xem (KY_DS)
  const [thang, setThangS] = useState(thangNay)  // tháng của kỳ 'thang'
  const [tuy, setTuy] = useState({ tu: '', den: '' })
  const setThang = k => { setKy('thang'); setThangS(k) }
  const [tat, setTat] = useState({})            // kênh tắt khỏi tổng {tên: 1}
  const [loi, setLoi] = useState('')
  const [hover, setHover] = useState(-1)
  const chartRef = useRef(null)
  /* nút + thêm kênh: căn đúng giữa cột trống cuối bảng (đo vị trí ô th.them so với khung, đo lại khi đổi cỡ / cuộn ngang) */
  const boxRef = useRef(null)
  const [themX, setThemX] = useState(null)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const wrap = box.querySelector('.mk-ads-tblwrap')
    // giữa khoảng trống bên phải: từ mép phải cột cuối (Tổng ngày / kênh cuối) tới mép phải vùng nhìn của bảng
    const do_ = () => {
      const ths = box.querySelectorAll('thead tr:first-child th.k'); if (!ths.length || !wrap) return
      const x1 = ths[ths.length - 1].getBoundingClientRect().right; const x2 = wrap.getBoundingClientRect().left + wrap.clientWidth
      setThemX(Math.round((x1 + x2) / 2 - box.getBoundingClientRect().left))
    }
    do_()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(do_) : null
    if (ro) { ro.observe(box); const t = box.querySelector('table'); if (t) ro.observe(t) }
    if (wrap) wrap.addEventListener('scroll', do_)
    window.addEventListener('resize', do_)
    const raf = requestAnimationFrame(do_)   // đo lại sau khi trình duyệt dàn xong (font / CSS vừa nạp)
    return () => { if (ro) ro.disconnect(); if (wrap) wrap.removeEventListener('scroll', do_); window.removeEventListener('resize', do_); cancelAnimationFrame(raf) }
  })
  const [chartW, setChartW] = useState(1000)
  useEffect(() => {
    const el = chartRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { const w = Math.round(el.clientWidth - 36); if (w > 0) setChartW(w) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fileRef = useRef(null)
  /* phiên đăng nhập: quản trị (admin / super, hoặc chưa đăng nhập = dữ liệu chỉ ở máy này) thấy mọi kênh + giao kênh;
     nhân sự chỉ thấy kênh có phuTrach[kênh] = tên đăng nhập của mình */
  const ss = useWorkSession()
  const online = ss.auth === 'ready' && !!ss.me
  const quanTri = !online || ss.me.role === 'admin' || ss.me.role === 'super'
  const toi = online ? String(ss.me.username || '').toLowerCase() : ''
  const pt = data.phuTrach || {}
  const [users, setUsers] = useState([])
  useEffect(() => {
    if (!online || !quanTri) return undefined
    let huy = false
    qsApi.adminListUsers().then(r => { if (!huy) setUsers(Array.isArray(r) ? r : (r && r.users) || []) }, () => {})
    return () => { huy = true }
  }, [online, quanTri])
  /* lưu lên máy chủ (hẹn 0,8 s). Nhân sự: đọc bản trên máy chủ rồi chỉ thay số các kênh của mình, không đè kênh người khác */
  const hen = useRef(null)
  async function luuMay(v) {
    try {
      let ghi = v
      if (!quanTri) {
        const d = await qsApi.getProjData('__cty')
        const sv = d && d.mkAds && Array.isArray(d.mkAds.kenh) ? d.mkAds : null
        if (sv) {
          const cua = v.kenh.filter(k => ptDs_(v.phuTrach, k).some(u => u.toLowerCase() === toi))
          const by = {}; sv.ngay.forEach(x => { by[x.d] = x.v.slice() })
          v.ngay.forEach(x => { if (!by[x.d]) by[x.d] = sv.kenh.map(() => null) })
          Object.keys(by).forEach(d => {
            const mine = v.ngay.find(x => x.d === d)
            cua.forEach(k => { const j = sv.kenh.indexOf(k); const i = v.kenh.indexOf(k); if (j >= 0) by[d][j] = mine ? mine.v[i] : null })
          })
          ghi = { ...sv, combo: v.combo || sv.combo, ngay: Object.keys(by).sort().map(d => ({ d, v: by[d] })).filter(x => x.v.some(y => y != null)) }
        }
      }
      await qsApi.setProjData('__cty', 'mkAds', ghi)
    } catch (e) { setLoi('Chưa lưu được lên máy chủ: ' + ((e && e.message) || e)) }
  }
  const setData = v => {
    setDataS(v); luuLs(v)
    if (online) { clearTimeout(hen.current); hen.current = setTimeout(() => luuMay(v), 800) }
  }
  // đăng nhập rồi: lấy bản chung trên máy chủ; máy chủ chưa có mà máy này có thì đẩy lên (lần đầu)
  useEffect(() => {
    if (!online) return undefined
    let huy = false
    qsApi.getProjData('__cty').then(d => {
      if (huy) return
      const sv = d && d.mkAds
      if (sv && Array.isArray(sv.kenh) && Array.isArray(sv.ngay)) { setDataS(sv); luuLs(sv) } else if (quanTri && napLs()) luuMay(napLs())
    }, e => { if (!huy) setLoi('Không tải được dữ liệu chung: ' + ((e && e.message) || e)) })
    return () => { huy = true }
  }, [online])  // eslint-disable-line react-hooks/exhaustive-deps
  /* 2 trang con: 'tong' = Tổng quan (quản trị: mọi kênh, giao kênh, sửa cấu trúc) · 'nhap' = Trang nhập (chỉ kênh của 1 nhân viên,
     nhập nhanh theo ngày). Nhân viên chỉ có Trang nhập; quản trị xem được Trang nhập của từng người (chọn người) */
  const [trangS, setTrang] = useState('')
  const trang = quanTri ? (trangS || 'tong') : 'nhap'
  const [nguoiNhap, setNguoiNhap] = useState('')
  /* nhân sự có kênh được giao: {tên đăng nhập (thường): số kênh} - danh sách chọn ở Trang nhập của quản trị */
  const nhanSuKenh = {}
  data.kenh.forEach(k => ptDs_(pt, k).forEach(u => { const x = u.toLowerCase(); nhanSuKenh[x] = (nhanSuKenh[x] || 0) + 1 }))
  const dsNhanSu = Object.keys(nhanSuKenh)
  // quản trị: mặc định xem người đầu tiên có kênh (chính mình nếu mình cũng được giao)
  const ai = (quanTri ? (nguoiNhap && nhanSuKenh[nguoiNhap] ? nguoiNhap : nhanSuKenh[toi] ? toi : dsNhanSu[0] || toi) : toi).toLowerCase()
  const kenhCua = data.kenh.map((k, i) => i).filter(i => ptDs_(pt, data.kenh[i]).some(u => u.toLowerCase() === ai))
  const kenhThay = trang === 'nhap' ? kenhCua : data.kenh.map((k, i) => i)
  const ql = quanTri && trang === 'tong'        // công cụ quản trị (giao kênh, thêm / đổi tên / bỏ kênh, nhập CSV, xoá số)
  /* người được xem cột Tổng ngày (xemTong, vd chỉ quản lý); quản trị luôn xem được */
  const xemTong = ptDs_({ t: data.xemTong }, 't')
  // cột Tổng ngày: Tổng quan = quản trị + người được giao xem; Trang nhập = luôn có (tổng các kênh của chính người đó)
  const thayTong = trang === 'nhap' || quanTri || xemTong.some(u => u.toLowerCase() === toi)
  const tenNguoi = u => { const x = users.find(y => String(y.username).toLowerCase() === String(u).toLowerCase()); return x ? (x.hoTen || x.username) : u }
  /* đặt danh sách người phụ trách của kênh k (mảng rỗng = chưa giao) */
  function giaoKenh(k, ds) { const m = { ...pt }; if (ds && ds.length) m[k] = ds; else delete m[k]; setData({ ...data, phuTrach: m }) }

  function nhapFile(f) {
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      try {
        const v = docCsvChiTieu(r.result)
        // gộp vào dữ liệu đang có: cùng ngày + cùng kênh thì lấy số trong file
        const kenh = data.kenh.slice(); v.kenh.forEach(k => { if (kenh.indexOf(k) < 0) kenh.push(k) })
        const by = {}; data.ngay.forEach(x => { by[x.d] = kenh.map((k, i) => (data.kenh.indexOf(k) >= 0 ? x.v[data.kenh.indexOf(k)] : null)) })
        v.ngay.forEach(x => { const row = by[x.d] || kenh.map(() => null); v.kenh.forEach((k, i) => { if (x.v[i] != null) row[kenh.indexOf(k)] = x.v[i] }); by[x.d] = row })
        setData({ ...data, kenh, ngay: Object.keys(by).sort().map(d => ({ d, v: by[d] })) })
        setLoi(''); setThang(v.ngay[v.ngay.length - 1].d.slice(0, 7))
      } catch (e) { setLoi(String((e && e.message) || e)) }
    }
    r.readAsText(f, 'utf-8')
  }
  function xuatCsv() {
    const dong = [['Ngày'].concat(kenhThay.map(i => data.kenh[i])).join(',')]
    data.ngay.slice().reverse().forEach(x => { dong.push([x.d.slice(8, 10) + '/' + x.d.slice(5, 7) + '/' + x.d.slice(0, 4)].concat(kenhThay.map(i => (x.v[i] == null ? '' : Math.round(x.v[i])))).join(',')) })
    const url = URL.createObjectURL(new Blob(['﻿' + dong.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'chi-tieu-quang-cao.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  /* sửa 1 ô (ngày d, kênh i); ô trống = xoá số */
  function datO(d, i, text) {
    const n = docSo(text)
    const ngay = data.ngay.slice(); let k = ngay.findIndex(x => x.d === d)
    if (k < 0) { if (n == null) return; ngay.push({ d, v: data.kenh.map(() => null) }); ngay.sort((a, b) => (a.d < b.d ? -1 : 1)); k = ngay.findIndex(x => x.d === d) }
    const v = ngay[k].v.slice(); v[i] = n; ngay[k] = { d, v }
    setData({ ...data, ngay: ngay.filter(x => x.v.some(y => y != null)) })
  }
  /* combo (phím tắt) chọn kênh: data.combo = [{ten, kenh: [tên kênh]}], lưu chung; bấm chip = chỉ chọn đúng các kênh của combo */
  const combo = Array.isArray(data.combo) ? data.combo : []
  const datChon = ks => { const m = {}; kenhThay.forEach(i => { const k = data.kenh[i]; if (ks.indexOf(k) < 0) m[k] = 1 }); setTat(m) }
  function luuCombo(chonKs) {
    if (!chonKs.length) { setLoi('Chọn ít nhất 1 kênh rồi mới lưu combo'); return }
    const ten = (window.prompt('Tên combo (vd: Nhà thầu) cho ' + chonKs.length + ' kênh: ' + chonKs.join(', ')) || '').trim().slice(0, 40)
    if (!ten) return
    setData({ ...data, combo: combo.filter(c => c.ten !== ten).concat([{ ten, kenh: chonKs }]) })
  }
  const boCombo = ten => { if (window.confirm('Xoá combo "' + ten + '"?')) setData({ ...data, combo: combo.filter(c => c.ten !== ten) }) }
  /* nhập nhanh: 1 ngày, nhiều kênh một lần (Trang nhập) */
  const [nhanh, setNhanh] = useState(() => ({ d: isoNgay(new Date()), so: {} }))
  function luuNhanh() {
    const ks = Object.keys(nhanh.so)
    if (!ks.length) { setLoi('Chưa nhập số nào để lưu'); return }
    const ngay = data.ngay.slice(); let k = ngay.findIndex(x => x.d === nhanh.d)
    if (k < 0) { ngay.push({ d: nhanh.d, v: data.kenh.map(() => null) }); ngay.sort((a, b) => (a.d < b.d ? -1 : 1)); k = ngay.findIndex(x => x.d === nhanh.d) }
    const vv = ngay[k].v.slice(); ks.forEach(i => { vv[+i] = docSo(nhanh.so[i]) }); ngay[k] = { d: nhanh.d, v: vv }
    setData({ ...data, ngay: ngay.filter(x => x.v.some(y => y != null)) })
    setNhanh({ ...nhanh, so: {} }); setLoi('')
  }
  function themKenh() {
    const ten = (window.prompt('Tên kênh mới (vd: TikTok Ads)') || '').trim()
    if (!ten) return
    if (data.kenh.indexOf(ten) >= 0) { setLoi('Kênh "' + ten + '" đã có'); return }
    setData({ ...data, kenh: data.kenh.concat([ten]), ngay: data.ngay.map(x => ({ d: x.d, v: x.v.concat([null]) })) })
  }
  function doiTenKenh(i) {
    const ten = (window.prompt('Đổi tên kênh', data.kenh[i]) || '').trim()
    if (!ten || ten === data.kenh[i]) return
    if (data.kenh.indexOf(ten) >= 0) { setLoi('Kênh "' + ten + '" đã có'); return }
    const m = { ...pt }; if (m[data.kenh[i]]) { m[ten] = m[data.kenh[i]]; delete m[data.kenh[i]] }
    setData({ ...data, kenh: data.kenh.map((k, j) => (j === i ? ten : k)), phuTrach: m })
  }
  function boKenh(i) {
    if (!window.confirm('Bỏ kênh "' + data.kenh[i] + '" cùng mọi số đã nhập của kênh này?')) return
    const m = { ...pt }; delete m[data.kenh[i]]
    setData({ kenh: data.kenh.filter((k, j) => j !== i), phuTrach: m, ngay: data.ngay.map(x => ({ d: x.d, v: x.v.filter((y, j) => j !== i) })).filter(x => x.v.some(y => y != null)) })
  }

  /* ngày của kỳ đang chọn (tăng dần) + nhãn kỳ */
  const homNay = isoNgay(new Date())
  const kyNgay = (() => {
    if (ky === 'tuan') { const d = new Date(); const t2 = new Date(d); t2.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const cn = new Date(t2); cn.setDate(t2.getDate() + 6); return ngayTu(isoNgay(t2), isoNgay(cn)) }
    if (ky === '7n') { const d = new Date(); d.setDate(d.getDate() - 6); return ngayTu(isoNgay(d), homNay) }
    if (ky === 'tuy' && tuy.tu && tuy.den && tuy.tu <= tuy.den) return ngayTu(tuy.tu, tuy.den)
    if (ky === 'tat') return data.ngay.map(x => x.d)
    return ngayCuaThang(thang).slice().reverse()
  })()
  const nhanKy = ky === 'thang' ? nhanThang(thang) : ky === 'tat' ? 'Mọi lúc' : ky === 'tuy' && !(tuy.tu && tuy.den && tuy.tu <= tuy.den) ? 'Chọn khoảng ngày'
    : kyNgay.length ? nhanNgay(kyNgay[0]) + ' – ' + nhanNgay(kyNgay[kyNgay.length - 1]) + '/' + kyNgay[kyNgay.length - 1].slice(0, 4) : ''
  const kyKhoa = ky + '|' + thang + '|' + tuy.tu + '|' + tuy.den + '|' + homNay
  const v = useMemo(() => {
    const ki = kenhThay.filter(i => !tat[data.kenh[i]])
    const by = {}; data.ngay.forEach(x => { by[x.d] = x.v })
    // tháng đang chọn: đủ mọi ngày của tháng (cả ngày chưa nhập); Mọi tháng: chỉ ngày đã có số
    const ds = kyNgay
    const ngay = ds.map(d => { const vv = by[d] || data.kenh.map(() => null); return { d, v: vv, tong: ki.reduce((a, i) => a + (Number(vv[i]) || 0), 0) } })
    const theoKenh = kenhThay.map(i => ({ k: data.kenh[i], i, tong: ngay.reduce((a, x) => a + (Number(x.v[i]) || 0), 0), on: !tat[data.kenh[i]] }))
    const tkI = {}; theoKenh.forEach(x => { tkI[x.i] = x.tong })
    const tong = ngay.reduce((a, x) => a + x.tong, 0)
    const coChi = ngay.filter(x => x.tong > 0)
    const max = ngay.reduce((m, x) => (x.tong > m.tong ? x : m), { tong: 0, d: '' })
    const kMax = theoKenh.filter(x => x.on).reduce((m, x) => (x.tong > m.tong ? x : m), { tong: 0, k: '' })
    return { ki, tkI, ngay, theoKenh, tong, tb: coChi.length ? tong / coChi.length : 0, soNgay: coChi.length, max, kMax }
  }, [data, kyKhoa, tat, quanTri, toi, trang, ai])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- biểu đồ cột chi theo ngày (1 màu, tổng các kênh đang bật) ---- */
  /* vẽ theo đúng bề rộng thật của khung (đo bằng ResizeObserver) - không kéo giãn SVG nên chữ trục không bị méo */
  const W = Math.max(320, chartW); const H = 240; const padL = 50; const padB = 26; const padT = 12
  const n = v.ngay.length
  const yMax = Math.max(1e6, ...v.ngay.map(x => x.tong))   // chưa có số: trục 0 - 1tr cho dễ nhìn
  const buoc = Math.pow(10, Math.floor(Math.log10(Math.max(1, yMax / 3))))
  const tick = Math.max(1, Math.ceil(yMax / 3 / buoc) * buoc)
  const top = tick * 3
  const cw = (W - padL) / Math.max(1, n)
  const bw = Math.max(2, Math.min(28, cw - 3))
  const y = val => padT + (H - padT - padB) * (1 - val / top)
  const hv = hover >= 0 && hover < n ? v.ngay[hover] : null
  const tongKenhMax = Math.max(1, ...v.theoKenh.map(x => x.tong))
  /* combo đang áp dụng (lựa chọn hiện tại trùng đúng 1 combo): danh sách chỉ hiện các kênh của combo, kênh khác ẩn */
  const comboDang = (Array.isArray(data.combo) ? data.combo : []).find(c => { const co = c.kenh.filter(k => v.theoKenh.some(x => x.k === k)); return co.length && co.length === v.ki.length && co.every(k => v.theoKenh.some(x => x.k === k && x.on)) })
  const dongBang = v.ngay.slice().reverse()     // bảng: mới nhất ở trên như file gốc
  /* lũy kế: kỳ này (dừng ở hôm nay) và kỳ trước cùng độ dài (Tháng: tháng trước; Mọi lúc: không so) - chỉ tính kênh đang chọn */
  const kyTruoc = (() => {
    if (ky === 'tat' || !kyNgay.length) return []
    if (ky === 'thang') return ngayCuaThang(thangCong(thang, -1)).slice().reverse()
    const e = new Date(kyNgay[0] + 'T00:00:00'); e.setDate(e.getDate() - 1); const s0 = new Date(e); s0.setDate(s0.getDate() - (kyNgay.length - 1))
    return ngayTu(isoNgay(s0), isoNgay(e))
  })()
  const byD = {}; data.ngay.forEach(x => { byD[x.d] = x.v })
  const tongD = d => { const vv = byD[d]; return vv ? v.ki.reduce((a, i) => a + (Number(vv[i]) || 0), 0) : 0 }
  let lk = 0; const lkCur = kyNgay.map(d => (d > homNay ? null : (lk += tongD(d))))
  lk = 0; const lkPrev = kyTruoc.map(d => (lk += tongD(d)))
  const tongPrev = lkPrev.length ? lkPrev[lkPrev.length - 1] : 0
  // so cùng thời điểm: kỳ trước tới ngày thứ tương ứng hôm nay
  const nCur = lkCur.filter(x => x != null).length
  const prevCung = nCur && lkPrev.length ? lkPrev[Math.min(nCur, lkPrev.length) - 1] : 0
  const doiPct = prevCung ? Math.round((v.tong - prevCung) / prevCung * 100) : null
  const nhanPrev = ky === 'thang' ? nhanThang(thangCong(thang, -1)) : 'Kỳ trước'

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}
      onDragOver={e => e.preventDefault()} onDrop={e => { if (e.dataTransfer.files[0]) { e.preventDefault(); nhapFile(e.dataTransfer.files[0]) } }}>
      {/* thanh trên: trang con (quản trị) · nhập / xuất file (bộ lọc thời gian nằm ở đầu bảng nhập) */}
      <div className="mk-ads-bar">
        {quanTri ? (
          <div className="mk-ads-seg mk-ads-trang" role="tablist" aria-label="Trang con">
            <button type="button" role="tab" aria-selected={trang === 'tong'} className={trang === 'tong' ? 'on' : ''} onClick={() => setTrang('tong')}>Tổng quan</button>
            <button type="button" role="tab" aria-selected={trang === 'nhap'} className={trang === 'nhap' ? 'on' : ''} onClick={() => setTrang('nhap')}>Trang nhập nhân viên</button>
          </div>
        ) : <b className="mk-ads-xin">Trang nhập chi phí ads{ss.me && (ss.me.hoTen || ss.me.username) ? ' · ' + (ss.me.hoTen || ss.me.username) : ''}</b>}
        {quanTri && trang === 'nhap' && online && (
          <label className="mk-ads-ai">Xem trang của
            {/* chỉ những người được giao kênh, kèm số kênh (page) người đó quản lý */}
            <select value={ai} onChange={e => setNguoiNhap(e.target.value)} disabled={!dsNhanSu.length}>
              {dsNhanSu.length ? dsNhanSu.map(u => <option key={u} value={u}>{tenNguoi(u)} · {nhanSuKenh[u]} kênh</option>) : <option value="">Chưa giao kênh cho ai</option>}
            </select>
          </label>
        )}
        <span style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { nhapFile(e.target.files[0]); e.target.value = '' }} />
        {ql && <button type="button" className="mk-ads-btn" title="Nhập file CSV (cột đầu Ngày dd/mm/yyyy, mỗi cột sau 1 kênh) - gộp vào bảng" onClick={() => fileRef.current && fileRef.current.click()}>Nhập CSV</button>}
        <button type="button" className="mk-ads-btn" title="Tải bảng về file CSV cùng cấu trúc" onClick={xuatCsv} disabled={!data.ngay.length}>Xuất CSV</button>
        {ql && <button type="button" className="mk-ads-btn" title="Xoá toàn bộ số đã nhập (giữ danh sách kênh)" onClick={() => { if (window.confirm('Xoá toàn bộ số chi tiêu đã nhập?')) setData({ ...data, ngay: [] }) }} disabled={!data.ngay.length}>Xoá số</button>}
      </div>
      {loi && <em className="mk-ads-err" onClick={() => setLoi('')}>{loi}</em>}
      {/* nhân sự: chỉ thấy kênh được giao */}
      {trang === 'nhap' && (
        <div className="mk-ads-note">{kenhCua.length
          ? <>{quanTri && ai !== toi ? <>Trang nhập của <b>{tenNguoi(ai)}</b>: </> : 'Bạn phụ trách '}<b>{kenhCua.map(i => data.kenh[i]).join(', ')}</b> - chỉ các kênh này hiện ở trang nhập.</>
          : (quanTri && ai !== toi ? tenNguoi(ai) + ' chưa được giao kênh nào.' : 'Bạn chưa được giao kênh quảng cáo nào. ' + (quanTri ? 'Giao kênh ở dòng "Phụ trách" của trang Tổng quan.' : 'Nhờ quản trị giao kênh cho bạn.'))}</div>
      )}
      {/* Trang nhập: nhập nhanh 1 ngày cho mọi kênh của mình */}
      {trang === 'nhap' && kenhCua.length > 0 && (
        <div className="mk-ads-card mk-ads-nhanh">
          <div className="mk-ads-h"><b>Nhập nhanh</b><span>Chọn ngày, gõ số từng kênh rồi bấm Lưu (ô trống = giữ nguyên)</span></div>
          <div className="mk-ads-nhanh-b">
            <div className="o ngay"><span>Ngày</span><DatePicker value={nhanh.d} max={isoNgay(new Date())} ariaLabel="Ngày nhập" onChange={d => setNhanh({ d: d || nhanh.d, so: {} })} /></div>
            {kenhCua.map(i => {
              const cu = (data.ngay.find(x => x.d === nhanh.d) || { v: [] }).v[i]
              return (
                <label key={data.kenh[i]} className="o"><span>{data.kenh[i]}</span>
                  <input inputMode="numeric" placeholder={cu != null ? fmt(cu) : '0'} value={nhanh.so[i] || ''} onChange={e => setNhanh({ ...nhanh, so: { ...nhanh.so, [i]: e.target.value } })}
                    onKeyDown={e => { if (e.key === 'Enter') luuNhanh() }} /></label>
              )
            })}
            <button type="button" className="mk-ads-btn pri" onClick={luuNhanh}>Lưu</button>
          </div>
        </div>
      )}
      {quanTri && !online && <div className="mk-ads-note">Chưa đăng nhập: dữ liệu chỉ lưu ở máy này và chưa giao kênh cho nhân sự được. Đăng nhập để lưu chung và phân công.</div>}

      {!(trang === 'nhap' && !kenhCua.length) && <>
      {/* ô số */}
      <div className="mk-ads-kpis">
        <div className="mk-ads-kpi"><span>Tổng chi</span><b>{fmt(v.tong)} đ</b><em>{nhanKy} · {v.ki.length}/{kenhThay.length} kênh{trang === 'nhap' ? ' của ' + (quanTri && ai !== toi ? tenNguoi(ai) : 'bạn') : ''}</em></div>
        <div className="mk-ads-kpi"><span>Trung bình / ngày</span><b>{fmt(v.tb)} đ</b><em>{v.soNgay} ngày có chi</em></div>
        <div className="mk-ads-kpi"><span>Ngày chi cao nhất</span><b>{fmt(v.max.tong)} đ</b><em>{v.max.d ? nhanNgay(v.max.d) + '/' + v.max.d.slice(0, 4) : '—'}</em></div>
        <div className="mk-ads-kpi"><span>Kênh chi nhiều nhất</span><b>{v.kMax.k || '—'}</b><em>{v.kMax.tong ? fmt(v.kMax.tong) + ' đ · ' + Math.round(v.kMax.tong / (v.tong || 1) * 100) + '%' : ''}</em></div>
      </div>

      {/* BẢNG NHẬP: dòng = ngày, cột = kênh (như file), gõ số thẳng vào ô */}
      <div className="mk-ads-card">
        {/* đầu bảng: bộ lọc thời gian (áp cho cả ô số, biểu đồ) */}
        <div className="mk-ads-h mk-ads-hloc mk-ads-hnhap">
          <div className="mk-ads-ht">
            <span className="ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M16 2.5v4M8 2.5v4M3 10h18M8 14h2M14 14h2M8 17h2" /></svg></span>
            <div className="tx"><b>Bảng nhập chi tiêu hằng ngày</b><span>{kenhThay.length} kênh · {dongBang.length} ngày · gõ số vào ô, Enter hoặc rời ô để lưu</span></div>
          </div>
          <div className="mk-ads-loc">
            <div className="mk-ads-seg" role="radiogroup" aria-label="Bộ lọc thời gian">
              {KY_DS.map(([k, nhan]) => <button type="button" key={k} role="radio" aria-checked={ky === k} className={ky === k ? 'on' : ''} onClick={() => setKy(k)}>{nhan}</button>)}
            </div>
            {ky === 'thang' && (
              <div className="mk-ads-thang">
                <button type="button" title="Tháng trước" onClick={() => setThang(thangCong(thang, -1))}>‹</button>
                <label title="Chọn tháng"><b>{nhanThang(thang)}</b><input type="month" value={thang} onChange={e => { if (e.target.value) setThang(e.target.value) }} /></label>
                <button type="button" title="Tháng sau" onClick={() => setThang(thangCong(thang, 1))}>›</button>
                {thang !== thangNay() && <button type="button" className="nay" onClick={() => setThang(thangNay())}>Tháng này</button>}
              </div>
            )}
            {ky === 'tuy' && (
              <div className="mk-ads-thang">
                <DatePicker value={tuy.tu} max={tuy.den || undefined} clearable onChange={d => setTuy({ ...tuy, tu: d })} ariaLabel="Từ ngày" />
                <span>–</span>
                <DatePicker value={tuy.den} min={tuy.tu || undefined} clearable onChange={d => setTuy({ ...tuy, den: d })} ariaLabel="Đến ngày" />
              </div>
            )}
            {ky !== 'thang' && ky !== 'tuy' && <span className="mk-ads-kyn">{nhanKy}</span>}
          </div>
        </div>
        {/* khung bảng + nút "+" thêm kênh nổi giữa cạnh phải (không nằm trong hàng tiêu đề) */}
        <div className="mk-ads-tblbox" ref={boxRef}>
        <div className="mk-ads-tblwrap">
          {/* các cột kênh + cột Tổng ngày luôn rộng bằng nhau (bảng cố định bề rộng, chia đều); nhiều kênh thì tối thiểu 136px / cột, cuộn ngang */}
          <table className="mk-ads-tbl nhap" style={{ minWidth: 104 + 52 + (kenhThay.length + (thayTong ? 1 : 0)) * 136 }}>
            {/* cột kênh xen kẽ có dải nền xám nhạt (col.band), cột Tổng dải xanh nhạt */}
            <colgroup><col style={{ width: 104 }} />{thayTong && <col className="band tong" />}{kenhThay.map((i, j) => <col key={data.kenh[i]} className={j % 2 ? 'band' : undefined} />)}<col style={{ width: 52 }} /></colgroup>
            <thead>
              <tr>
                <th>Ngày</th>
                {/* cột Tổng ngày đứng đầu (ngay sau cột Ngày) */}
                {thayTong && <th className="num kenh k tong">{trang === 'nhap' ? 'Tổng của tôi' : 'Tổng ngày'}</th>}
                {kenhThay.map(i => { const k = data.kenh[i]; return (
                  <th key={k} className="num kenh k">
                    {ql ? <span title="Bấm để đổi tên kênh" onClick={() => doiTenKenh(i)}>{k}</span> : <span>{k}</span>}
                    {ql && <button type="button" title={'Bỏ kênh ' + k} onClick={() => boKenh(i)}>×</button>}
                  </th>
                ) })}
                <th className="them" />
              </tr>
              {/* quản trị giao mỗi kênh cho 1 nhân sự (người đó chỉ thấy kênh của mình) */}
              {ql && online && (
                <tr className="pt">
                  <th>Phụ trách</th>
                  {/* cột Tổng ngày: giao người được xem (vd chỉ quản lý); chưa giao = chỉ quản trị xem */}
                  <th className="num k tong">
                    <div className="mk-ads-pt">
                      {xemTong.length ? xemTong.map(u => (
                        <button type="button" key={u} className="av" style={{ background: avMau(u) }} title={tenNguoi(u) + ' - bấm để bỏ quyền xem cột tổng'}
                          onClick={() => { if (window.confirm('Bỏ quyền xem cột Tổng ngày của ' + tenNguoi(u) + '?')) setData({ ...data, xemTong: xemTong.filter(x => x !== u) }) }}>{avChu(tenNguoi(u))}</button>
                      )) : <span className="chua" title="Chưa giao: chỉ quản trị xem được cột tổng">Chưa giao</span>}
                      {users.length > 0 && <PtPicker ds={xemTong} users={users} onChange={m => setData({ ...data, xemTong: m })} />}
                    </div>
                  </th>
                  {kenhThay.map(i => { const k = data.kenh[i]; const ds = ptDs_(pt, k); return (
                    <th key={k} className="num k">
                      <div className="mk-ads-pt">
                        {/* mỗi người = 1 icon tròn chữ cái đầu (rê chuột xem tên, bấm để bỏ khỏi kênh) */}
                        {ds.length ? ds.map(u => (
                          <button type="button" key={u} className="av" style={{ background: avMau(u) }} title={tenNguoi(u) + ' - bấm để bỏ khỏi kênh này'}
                            onClick={() => { if (window.confirm('Bỏ ' + tenNguoi(u) + ' khỏi kênh "' + k + '"?')) giaoKenh(k, ds.filter(x => x !== u)) }}>{avChu(tenNguoi(u))}</button>
                        )) : <span className="chua">Chưa giao</span>}
                        {/* "+": gõ để tìm + đánh dấu chọn nhiều người cùng xử lý kênh này */}
                        {users.length > 0 && <PtPicker ds={ds} users={users} onChange={m => giaoKenh(k, m)} />}
                      </div>
                    </th>
                  ) })}
                  <th />
                </tr>
              )}
            </thead>
            <tbody>
              {/* hàng đệm trên / dưới: khoảng cách giữa đầu bảng, hàng Tổng (module riêng) và các ngày */}
              <tr className="gap" aria-hidden="true"><td colSpan={kenhThay.length + (thayTong ? 1 : 0) + 2} /></tr>
              {dongBang.map((x, j) => (
                <tr key={x.d} className={[x.d === isoNgay(new Date()) ? 'nay' : '', j === 0 ? 'dau' : '', j === dongBang.length - 1 ? 'cuoi' : ''].filter(Boolean).join(' ') || undefined}>
                  <td className="ngay" title={nhanNgay(x.d) + '/' + x.d.slice(0, 4)}><b>{nhanNgay(x.d)}</b><i className={thuNgay(x.d) === 'CN' || thuNgay(x.d) === 'T7' ? 'cn' : undefined}>{thuNgay(x.d)}</i>{ky === 'tat' && <em>{x.d.slice(0, 4)}</em>}</td>
                  {thayTong && <td className="num b k tong">{x.tong ? fmt(x.tong) : '—'}</td>}
                  {kenhThay.map(i => { const k = data.kenh[i]; return (
                    <td key={k} className="num o k">
                      <input key={x.d + '|' + k + '|' + (x.v[i] == null ? '' : x.v[i])} defaultValue={soHien(x.v[i])} placeholder="–" inputMode="numeric" aria-label={k + ' ngày ' + x.d}
                        onBlur={e => { if (e.target.value !== soHien(x.v[i])) datO(x.d, i, e.target.value) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                    </td>
                  ) })}
                  <td />
                </tr>
              ))}
              <tr className="gap" aria-hidden="true"><td colSpan={kenhThay.length + (thayTong ? 1 : 0) + 2} /></tr>
            </tbody>
            <tfoot><tr><td>Tổng</td>{thayTong && <td className="num b k tong">{fmt(v.tong)}</td>}{kenhThay.map(i => <td key={data.kenh[i]} className="num k">{fmt(v.tkI[i])}</td>)}<td /></tr></tfoot>
          </table>
        </div>
        {ql && <button type="button" className="mk-ads-themk" style={themX != null ? { left: themX, right: 'auto' } : undefined} title="Thêm kênh (cột) mới" aria-label="Thêm kênh" onClick={themKenh}>+</button>}
        </div>
      </div>

      {/* chi theo kênh: bấm để bật / tắt kênh khỏi tổng (ô số, biểu đồ) */}
      <div className="mk-ads-card">
        {/* check list: đánh dấu các kênh (page) muốn xem -> tổng của riêng các kênh đó (ô số + biểu đồ cũng tính theo lựa chọn) */}
        <div className="mk-ads-h mk-ads-hloc"><span className="mk-ads-h1"><b>Chi theo kênh</b>
          <KenhPicker ds={v.theoKenh.map(x => x.k)} chon={v.theoKenh.filter(x => x.on).map(x => x.k)} onChange={datChon} />
          {/* combo (phím tắt): mỗi combo đã lưu = 1 nút nhấn ngay cạnh Chọn kênh; bấm = chỉ chọn các kênh của combo */}
          {combo.map(c => {
            const co = c.kenh.filter(k => v.theoKenh.some(x => x.k === k))
            const dang = co.length && co.length === v.ki.length && co.every(k => v.theoKenh.some(x => x.k === k && x.on))
            return (
              <span key={c.ten} className={'mk-ads-cb' + (dang ? ' on' : '')} title={c.ten + ': ' + c.kenh.join(' + ')}>
                <button type="button" onClick={() => datChon(co)}>{c.ten}<i>{co.length}</i></button>
                <button type="button" className="x" title={'Xoá combo ' + c.ten} onClick={() => boCombo(c.ten)}>×</button>
              </span>
            )
          })}
          <button type="button" className="mk-ads-cbmoi" onClick={() => luuCombo(v.theoKenh.filter(x => x.on).map(x => x.k))} title="Lưu các kênh đang chọn thành 1 combo (phím tắt) - vd Nhà thầu = HM Cons + Dezon">+ Lưu combo</button></span>
          <div className="mk-ads-chon">
            <span>Đã chọn <b>{v.ki.length}/{v.theoKenh.length}</b> kênh · Tổng <b className="t">{fmt(v.tong)} đ</b></span>
            <button type="button" onClick={() => setTat({})} disabled={v.ki.length === v.theoKenh.length}>Chọn hết</button>
            <button type="button" onClick={() => { const m = {}; v.theoKenh.forEach(x => { m[x.k] = 1 }); setTat(m) }} disabled={!v.ki.length}>Bỏ hết</button>
          </div>
        </div>
        <div className="mk-ads-kenh">
          {comboDang && (
            <div className="mk-ads-cbdang">Đang xem combo <b>{comboDang.ten}</b> · các kênh khác đã ẩn
              <button type="button" onClick={() => setTat({})}>Hiện tất cả kênh</button></div>
          )}
          {v.theoKenh.filter(x => !comboDang || x.on).sort((a, b) => b.tong - a.tong).map(x => (
            <button type="button" key={x.k} className={'mk-ads-krow' + (x.on ? '' : ' off')} onClick={() => setTat(t => { const m = { ...t }; if (m[x.k]) delete m[x.k]; else m[x.k] = 1; return m })}
              title={x.on ? 'Bỏ chọn kênh này (không tính vào tổng)' : 'Chọn kênh này để tính vào tổng'}>
              <span className="nm"><i className={'ck' + (x.on ? ' on' : '')} aria-hidden="true" />{x.k}</span>
              <span className="tr"><i style={{ width: (x.tong / tongKenhMax * 100) + '%' }} /></span>
              <b>{x.tong ? fmt(x.tong) + ' đ' : '—'}</b>
              <em>{x.on && v.tong ? Math.round(x.tong / v.tong * 100) + '%' : x.on ? '0%' : 'không chọn'}</em>
            </button>
          ))}
        </div>
      </div>

      {/* 2 biểu đồ cạnh nhau: chi theo ngày (cột) · lũy kế kỳ này so với kỳ trước (đường) */}
      <div className="mk-ads-2c">
      {/* chi theo ngày */}
      <div className="mk-ads-card">
        <div className="mk-ads-h"><b>Chi theo ngày</b><span>Tổng các kênh đang bật · rê chuột vào cột để xem từng kênh</span></div>
        <div className="mk-ads-chart" ref={chartRef} onMouseLeave={() => setHover(-1)}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Biểu đồ chi tiêu theo ngày">
            {[0, 1, 2, 3].map(t => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(tick * t)} y2={y(tick * t)} className="grid" />
                <text x={padL - 6} y={y(tick * t) + 3} textAnchor="end" className="ax">{fmtM(tick * t)}</text>
              </g>
            ))}
            {v.ngay.map((x, i) => {
              const cx = padL + i * cw + cw / 2
              const h = Math.max(0, y(0) - y(x.tong))
              const r = Math.min(4, h, bw / 2)
              return (
                <g key={x.d}>
                  {h > 0 && <path className={'bar' + (i === hover ? ' on' : '')}
                    d={`M${cx - bw / 2},${y(0)} V${y(0) - h + r} Q${cx - bw / 2},${y(0) - h} ${cx - bw / 2 + r},${y(0) - h} H${cx + bw / 2 - r} Q${cx + bw / 2},${y(0) - h} ${cx + bw / 2},${y(0) - h + r} V${y(0)} Z`} />}
                  <rect x={padL + i * cw} y={padT} width={cw} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % Math.ceil(n / Math.max(3, Math.floor(W / 80))) === 0 && <text x={cx} y={H - 7} textAnchor="middle" className="ax">{nhanNgay(x.d)}</text>}
                </g>
              )
            })}
            <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="base" />
          </svg>
          {hv && (
            <div className="mk-ads-tip" style={{ left: ((padL + hover * cw + cw / 2) / W * 100) + '%' }}>
              <b>{nhanNgay(hv.d)}/{hv.d.slice(0, 4)} · {fmt(hv.tong)} đ</b>
              {v.ki.filter(i => Number(hv.v[i]) > 0).map(i => <span key={i}><i>{data.kenh[i]}</i>{fmt(hv.v[i])}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* lũy kế chi tiêu: kỳ này so với kỳ trước */}
      <div className="mk-ads-card">
        <div className="mk-ads-h mk-ads-hloc"><span className="mk-ads-h1"><b>Lũy kế chi tiêu</b>
          <span className="mk-ads-lg"><em className="lk-sw cur" />Kỳ này{kyTruoc.length > 0 && <><em className="lk-sw prev" />{nhanPrev}</>}</span></span>
          {kyTruoc.length > 0 && (
            <span className="mk-ads-so">
              {doiPct == null ? 'Kỳ trước chưa có số' : <>So cùng kỳ <b className={doiPct > 0 ? 'tang' : doiPct < 0 ? 'giam' : ''}>{doiPct > 0 ? '▲ ' : doiPct < 0 ? '▼ ' : ''}{Math.abs(doiPct)}%</b></>}
              <i>· {nhanPrev} cả kỳ {fmt(tongPrev)} đ</i>
            </span>
          )}
        </div>
        <LuyKeChart ngay={kyNgay} cur={lkCur} prev={lkPrev} nhanPrev={nhanPrev} />
      </div>
      </div>
      </>}
    </div>
  )
}
