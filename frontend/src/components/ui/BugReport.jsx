import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { NAV_BOTTOM, NAV_MAIN } from '../../data/navigation'
import { PRIO_LABEL, TICKET_CATEGORIES } from '../../data/itData'
import { addReport, loadReports, subscribeReports } from '../../services/itTicketService'
import './BugReport.css'

/* Báo lỗi gửi phòng IT (mở từ Dezbot): chụp màn hình -> vẽ đánh dấu -> viết lỗi + mô tả -> gửi.
   Phiếu hiện ở Bảng điều khiển IT; người báo xem tiến độ ở tab "Đã gửi". */
const MAX_W = 2880   // giữ gần độ phân giải gốc (màn 2K / Retina) để ảnh sắc nét khi phòng IT phóng to
const COLORS = ['#E5483B', '#F59E0B', '#16A34A', '#2E7DD6', '#111827']
const TOOLS = [['select', 'Chọn / sửa nét đã vẽ (V)'], ['rect', 'Khung (R)'], ['arrow', 'Mũi tên (A)'], ['curve', 'Mũi tên uốn A -> B, kéo 2 nút giữa để uốn (C)'], ['pen', 'Bút (P)'], ['text', 'Chữ (T)']]
const PRIOS = ['low', 'medium', 'high', 'urgent']
const STEPS = ['Đã gửi', 'IT tiếp nhận', 'Đang xử lý', 'Hoàn thành']
const NAME_KEY = 'siteflow-bug-reporter'
const readName = () => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } }

/* Bước hiện tại của phiếu (0..3) theo trạng thái IT cập nhật */
export function reportStep(t) {
  if (t.status === 'hoanthanh') return 3
  if (t.status === 'dangxuly' || t.status === 'chodoi') return 2
  return t.received ? 1 : 0
}

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
}
/* Ảnh làm việc: tối đa MAX_W px ngang, PNG (không mất nét khi vẽ đè); lúc gửi mới nén JPEG */
function shrink(source, w, h) {
  const k = Math.min(1, MAX_W / w)
  const c = document.createElement('canvas')
  c.width = Math.round(w * k); c.height = Math.round(h * k)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}
/* Chụp tab hiện tại bằng Screen Capture API của trình duyệt (trình duyệt hỏi quyền chọn tab).
   Xin khung hình theo độ phân giải thật của màn hình (x devicePixelRatio) để ảnh không bị mờ */
async function captureScreen() {
  const dpr = window.devicePixelRatio || 1
  const vc = { displaySurface: 'browser', width: { ideal: Math.round(window.screen.width * dpr) }, height: { ideal: Math.round(window.screen.height * dpr) }, frameRate: { ideal: 5 } }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: vc, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' })
  try {
    const video = document.createElement('video')
    video.srcObject = stream; video.muted = true
    await video.play()
    await new Promise(r => setTimeout(r, 350)) // chờ thanh "đang chia sẻ" của trình duyệt ẩn đi
    return shrink(video, video.videoWidth, video.videoHeight)
  } finally { stream.getTracks().forEach(t => t.stop()) }
}

/* s.w = độ dày nét (thanh kéo cỡ nét, px hiển thị); chữ to theo nét: cỡ chữ = 5 x nét */
const DEF_W = 4

/* Mũi tên uốn: đường cong bậc 3 từ A (x1,y1) tới B (x2,y2), đi qua 2 nút uốn c1 (t = 1/3) và c2 (t = 2/3) */
function curvePts(s, n = 72) {
  const r1x = 27 * s.c1x - 8 * s.x1 - s.x2, r1y = 27 * s.c1y - 8 * s.y1 - s.y2
  const r2x = 27 * s.c2x - s.x1 - 8 * s.x2, r2y = 27 * s.c2y - s.y1 - 8 * s.y2
  const ax = (2 * r1x - r2x) / 18, ay = (2 * r1y - r2y) / 18, bx = (2 * r2x - r1x) / 18, by = (2 * r2y - r1y) / 18
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([u * u * u * s.x1 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * s.x2, u * u * u * s.y1 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * s.y2])
  }
  return out
}
/* Lúc vẽ: dáng chữ S mặc định (ngoằn ngoèo) theo hướng kéo A -> B */
function bendCurve(d) {
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1, off = 0.14
  d.c1x = d.x1 + dx / 3 - dy * off; d.c1y = d.y1 + dy / 3 + dx * off
  d.c2x = d.x1 + dx * 2 / 3 + dy * off; d.c2y = d.y1 + dy * 2 / 3 - dx * off
  return d
}
function drawHead(ctx, tx, ty, a, h) {
  ctx.beginPath(); ctx.moveTo(tx, ty)
  ctx.lineTo(tx - h * Math.cos(a - 0.45), ty - h * Math.sin(a - 0.45))
  ctx.lineTo(tx - h * Math.cos(a + 0.45), ty - h * Math.sin(a + 0.45))
  ctx.closePath(); ctx.fill()
}

function drawShape(ctx, s, k) {
  const w = (s.w || DEF_W) * k
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color
  ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (s.type === 'curve') {
    const pts = curvePts(s), h = Math.max(12 * k, w * 4)
    // cắt thân ở gốc đầu mũi tên; hướng đầu mũi tên = hướng đoạn cuối đường cong
    let j = pts.length - 1
    while (j > 0 && Math.hypot(s.x2 - pts[j][0], s.y2 - pts[j][1]) < h * 0.8) j--
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i <= j; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.stroke()
    drawHead(ctx, s.x2, s.y2, Math.atan2(s.y2 - pts[j][1], s.x2 - pts[j][0]), h)
  }
  if (s.type === 'rect') ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
  if (s.type === 'pen' && s.pts.length) { ctx.beginPath(); ctx.moveTo(s.pts[0][0], s.pts[0][1]); s.pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.stroke() }
  if (s.type === 'arrow') {
    const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), h = Math.max(12 * k, w * 4)
    // thân dừng ở gốc đầu mũi tên để đầu nhọn không bị nét tròn che
    const bx = s.x2 - h * 0.8 * Math.cos(a), by = s.y2 - h * 0.8 * Math.sin(a)
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(bx, by); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(s.x2, s.y2)
    ctx.lineTo(s.x2 - h * Math.cos(a - 0.45), s.y2 - h * Math.sin(a - 0.45))
    ctx.lineTo(s.x2 - h * Math.cos(a + 0.45), s.y2 - h * Math.sin(a + 0.45))
    ctx.closePath(); ctx.fill()
  }
  if (s.type === 'text') {
    const fs = Math.round(Math.max(14, (s.w || DEF_W) * 5) * k)
    ctx.font = `600 ${fs}px system-ui, sans-serif`; ctx.textBaseline = 'top'
    const tw = ctx.measureText(s.text).width, p = fs * 0.25
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(s.x1 - p, s.y1 - p, tw + p * 2, fs + p * 2)
    ctx.fillStyle = s.color; ctx.fillText(s.text, s.x1, s.y1)
  }
}

/* Chỉnh lại nét đã vẽ (như MarkUp): Khung - 8 nút góc / cạnh đổi kích thước; Mũi tên - kéo 2 đầu;
   Mũi tên uốn - kéo 2 đầu + 2 nút uốn giữa; kéo thân để di chuyển */
const EDITABLE = { rect: 1, arrow: 1, curve: 1 }
const normRect = s => ({ ...s, x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) })
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'crosshair', p2: 'crosshair', c1: 'grab', c2: 'grab', move: 'move' }
function handlePts(s) {
  if (s.type === 'arrow') return { p1: [s.x1, s.y1], p2: [s.x2, s.y2] }
  if (s.type === 'curve') return { p1: [s.x1, s.y1], c1: [s.c1x, s.c1y], c2: [s.c2x, s.c2y], p2: [s.x2, s.y2] }
  const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2
  return { nw: [s.x1, s.y1], n: [mx, s.y1], ne: [s.x2, s.y1], e: [s.x2, my], se: [s.x2, s.y2], s: [mx, s.y2], sw: [s.x1, s.y2], w: [s.x1, my] }
}
function drawHandles(ctx, s, k) {
  const r = 5 * k
  ctx.save()
  ctx.strokeStyle = '#2E7DD6'
  if (s.type === 'rect') {
    ctx.setLineDash([6 * k, 4 * k]); ctx.lineWidth = 1.5 * k
    ctx.strokeRect(s.x1 - 4 * k, s.y1 - 4 * k, s.x2 - s.x1 + 8 * k, s.y2 - s.y1 + 8 * k)
    ctx.setLineDash([])
  }
  Object.entries(handlePts(s)).forEach(([h, [x, y]]) => {
    ctx.beginPath()
    if (s.type !== 'rect') ctx.arc(x, y, r * 1.2, 0, Math.PI * 2); else ctx.rect(x - r, y - r, r * 2, r * 2)
    // nút uốn của mũi tên uốn tô xanh để phân biệt với 2 đầu
    ctx.fillStyle = h === 'c1' || h === 'c2' ? '#2E7DD6' : '#fff'; ctx.fill(); ctx.lineWidth = 2 * k
    ctx.strokeStyle = h === 'c1' || h === 'c2' ? '#fff' : '#2E7DD6'; ctx.stroke()
  })
  ctx.restore()
}
function segDist(p, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / L)) : 0
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy))
}
/* Con trỏ so với 1 nét: tên nút kéo, 'move' (trúng thân) hoặc null */
function hitShape(s, p, k) {
  const tol = 9 * k
  const hp = handlePts(s)
  for (const h of Object.keys(hp)) if (Math.abs(p.x - hp[h][0]) <= tol && Math.abs(p.y - hp[h][1]) <= tol) return h
  if (s.type === 'arrow') return segDist(p, s) <= tol + (s.w || DEF_W) * k ? 'move' : null
  if (s.type === 'curve') {
    const pts = curvePts(s, 48)
    for (let i = 1; i < pts.length; i++) {
      if (segDist(p, { x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] }) <= tol + (s.w || DEF_W) * k) return 'move'
    }
    return null
  }
  if (p.x >= s.x1 - tol && p.x <= s.x2 + tol && p.y >= s.y1 - tol && p.y <= s.y2 + tol) return 'move'
  return null
}
function dragShape(o, mode, dx, dy) {
  const r = { ...o }
  const cv = o.type === 'curve'
  if (mode === 'move') {
    r.x1 += dx; r.x2 += dx; r.y1 += dy; r.y2 += dy
    if (cv) { r.c1x += dx; r.c2x += dx; r.c1y += dy; r.c2y += dy }
    return r
  }
  if (mode === 'c1') { r.c1x += dx; r.c1y += dy; return r }
  if (mode === 'c2') { r.c2x += dx; r.c2y += dy; return r }
  // kéo 1 đầu mũi tên uốn: 2 nút uốn đi theo (nút gần đầu đó đi nhiều hơn) để giữ dáng cong
  if (mode === 'p1') { r.x1 += dx; r.y1 += dy; if (cv) { r.c1x += dx * 2 / 3; r.c1y += dy * 2 / 3; r.c2x += dx / 3; r.c2y += dy / 3 } return r }
  if (mode === 'p2') { r.x2 += dx; r.y2 += dy; if (cv) { r.c1x += dx / 3; r.c1y += dy / 3; r.c2x += dx * 2 / 3; r.c2y += dy * 2 / 3 } return r }
  if (mode.indexOf('w') >= 0) r.x1 += dx
  if (mode.indexOf('e') >= 0) r.x2 += dx
  if (mode.indexOf('n') >= 0) r.y1 += dy
  if (mode.indexOf('s') >= 0) r.y2 += dy
  return r
}
const fixShape = s => (s.type === 'rect' ? normRect(s) : s)

/* Biểu tượng thanh công cụ theo bộ SF Symbols của iOS (Markup): nét mảnh 1.7, đầu / góc bo tròn, khung 24
   cursorarrow · square · arrow.up.right · pencil.tip · textformat (Aa) · arrow.uturn.backward / forward · trash */
const ico = d => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const TOOL_ICON = {
  select: ico(<path d="M6.2 4.3 18.6 11a.6.6 0 0 1-.1 1.1l-5.4 1.6a1 1 0 0 0-.6.5l-2.4 5.1a.6.6 0 0 1-1.1-.1L5.4 5a.6.6 0 0 1 .8-.7z" />),
  rect: ico(<rect x="4.5" y="4.5" width="15" height="15" rx="3.2" />),
  arrow: ico(<><path d="M6 18 18 6" /><path d="M9 6h9v9" /></>),
  curve: ico(<><path d="M4.5 19c4.5 0 3.5-7 7.5-7s3-6 7-6" /><path d="M15.5 3 19 6l-3.5 3" /></>),
  pen: ico(<><path d="M14.6 4.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L9.2 19.6 4 20l.4-5.2z" /><path d="m13 6.2 4.8 4.8" /></>),
  text: <svg width="21" height="19" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 19 8 5l5.5 14" /><path d="M4.6 14h6.8" /><path d="M23 13.4V19" /><circle cx="19.6" cy="16" r="3.2" /></svg>,
}
const TOOL_KEY = { v: 'select', r: 'rect', a: 'arrow', c: 'curve', p: 'pen', t: 'text' }
const IC_UNDO = ico(<><path d="M9 14 4.5 9.5 9 5" /><path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3" /></>)
const IC_REDO = ico(<><path d="m15 14 4.5-4.5L15 5" /><path d="M19.5 9.5H9a5 5 0 0 0 0 10h3" /></>)
const IC_TRASH = ico(<><path d="M4.5 6.5h15" /><path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" /><path d="M6.5 6.5l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.1" /><path d="M10.2 10.5v6M13.8 10.5v6" /></>)

export default function BugReport({ open, onClose, pageName = '' }) {
  const nav = useNavigate()
  const [view, setView] = useState('new')       // new | done | mine
  const [phase, setPhase] = useState('idle')     // idle | capturing | edit
  const [img, setImg] = useState('')
  const [shapes, setShapes] = useState([])
  const [tool, setTool] = useState('rect')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(DEF_W)        // độ dày nét (thanh kéo)
  const [textAt, setTextAt] = useState(null)     // {x, y, cx, cy} ô gõ chữ đang mở
  const [form, setForm] = useState({ title: '', desc: '', priority: 'medium', category: 'software', requester: readName() })
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(null)
  const [mine, setMine] = useState(loadReports)
  const canvasRef = useRef(null)
  const imgEl = useRef(null)
  const draft = useRef(null)
  const textRef = useRef(null)                   // ô gõ chữ đang mở
  const textDone = useRef(false)                 // ô gõ chữ hiện tại đã ghi (Enter / rời ô)
  const [sel, setSel] = useState(-1)             // nét đang chọn (chỉ số trong shapes), -1 = không chọn
  const drag = useRef(null)                      // {i, mode, o, x, y, before}: đang kéo đổi kích thước / di chuyển
  /* Hoàn tác / làm lại: mỗi thay đổi (vẽ, sửa, xoá) lưu 1 bản shapes trước đó */
  const hist = useRef({ past: [], future: [] })
  const sizeBefore = useRef(null)
  const [, setHistVer] = useState(0)
  const commit = (next, before = shapes) => {
    hist.current.past.push(before); hist.current.future = []
    if (hist.current.past.length > 100) hist.current.past.shift()
    setShapes(next); setHistVer(v => v + 1)
  }
  const clearHist = () => { hist.current = { past: [], future: [] }; setHistVer(v => v + 1) }
  function undo() {
    const h = hist.current
    if (!h.past.length) return
    h.future.push(shapes); setShapes(h.past.pop()); setSel(-1); setHistVer(v => v + 1)
  }
  function redo() {
    const h = hist.current
    if (!h.future.length) return
    h.past.push(shapes); setShapes(h.future.pop()); setSel(-1); setHistVer(v => v + 1)
  }
  const canPick = s => s && EDITABLE[s.type] && (tool === 'select' || tool === s.type)

  useEffect(() => subscribeReports(() => setMine(loadReports())), [])
  useEffect(() => { if (sel >= 0 && !canPick(shapes[sel])) setSel(-1); if (canvasRef.current) canvasRef.current.style.cursor = '' }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel >= shapes.length || (sel >= 0 && !EDITABLE[shapes[sel].type])) setSel(-1) }, [shapes, sel])
  /* Đổi màu / cỡ nét khi đang chọn 1 nét thì áp cho nét đó */
  function pickColor(c) { setColor(c); if (sel >= 0 && shapes[sel] && shapes[sel].color !== c) commit(shapes.map((x, i) => (i === sel ? { ...x, color: c } : x))) }
  function pickSize(v) { setSize(v); if (sel >= 0 && shapes[sel]) setShapes(s => s.map((x, i) => (i === sel ? { ...x, w: v } : x))) }
  /* Phím tắt: Delete / Backspace xoá nét đang chọn, Ctrl+Z hoàn tác, Ctrl+Shift+Z / Ctrl+Y làm lại (khi không gõ trong ô nhập) */
  useEffect(() => {
    if (!open || view !== 'new') return undefined
    const onKey = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const z = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z', y = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y'
      if (z && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((z && e.shiftKey) || y) { e.preventDefault(); redo(); return }
      if (/^(Delete|Backspace)$/.test(e.key) && sel >= 0) { e.preventDefault(); commit(shapes.filter((_, i) => i !== sel)); setSel(-1); return }
      const tk = !e.ctrlKey && !e.metaKey && !e.altKey && img && TOOL_KEY[e.key.toLowerCase()]
      if (tk) { e.preventDefault(); setTool(tk); return }
      if (e.key === 'Escape' && sel >= 0) { e.preventDefault(); e.stopPropagation(); setSel(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const reset = () => { setImg(''); setShapes([]); setSel(-1); clearHist(); setTextAt(null); setErr(''); setSent(null); setForm(f => ({ ...f, title: '', desc: '', priority: 'medium' })) }
  const newImage = url => { setImg(url); setShapes([]); setSel(-1); clearHist() }

  const doCapture = useCallback(async () => {
    setPhase('capturing')
    try { newImage(await captureScreen()) } catch { /* huỷ / trình duyệt không hỗ trợ: vẫn gửi được không ảnh */ }
    setPhase('edit')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Mở hộp: tự chụp ngay (hộp ẩn trong lúc chụp để không lọt vào ảnh) */
  useEffect(() => {
    if (!open) { setPhase('idle'); return }
    setView('new'); reset()
    if (navigator.mediaDevices?.getDisplayMedia) doCapture(); else setPhase('edit')
  }, [open, doCapture]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Dán ảnh (Ctrl+V) khi hộp đang mở */
  useEffect(() => {
    if (!open) return undefined
    const onPaste = e => {
      const f = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/'))?.getAsFile()
      if (f) { e.preventDefault(); fileToImg(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  async function fileToImg(file) {
    const url = URL.createObjectURL(file)
    try { const im = await loadImage(url); newImage(shrink(im, im.naturalWidth, im.naturalHeight)) } catch { setErr('Không đọc được ảnh') }
    URL.revokeObjectURL(url)
  }

  /* Vẽ lại ảnh + các nét đánh dấu; handles = vẽ cả khung chọn (không có trong ảnh gửi đi) */
  const redraw = useCallback((handles = true) => {
    const c = canvasRef.current, im = imgEl.current
    if (!c || !im) return
    const ctx = c.getContext('2d'), k = c.width / (c.getBoundingClientRect().width || c.width)
    ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0)
    shapes.forEach(s => drawShape(ctx, s, k))
    if (draft.current) drawShape(ctx, draft.current, k)
    if (handles && sel >= 0 && shapes[sel] && EDITABLE[shapes[sel].type]) drawHandles(ctx, shapes[sel], k)
  }, [shapes, sel])

  useEffect(() => {
    if (!img) { imgEl.current = null; return }
    let alive = true
    loadImage(img).then(im => {
      if (!alive || !canvasRef.current) return
      imgEl.current = im
      canvasRef.current.width = im.naturalWidth; canvasRef.current.height = im.naturalHeight
      redraw()
    })
    return () => { alive = false }
  }, [img, phase, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw() }, [redraw])

  /* x, y: px của ảnh; cx, cy: px CSS trong khung ảnh (đặt ô gõ chữ) - chia cho tỉ lệ zoom z khi app đang thu / phóng (Kích thước chuẩn) */
  const pt = e => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), k = c.width / r.width
    const z = (c.offsetWidth && r.width / c.offsetWidth) || 1
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, cx: (e.clientX - r.left) / z, cy: (e.clientY - r.top) / z, k }
  }
  /* Trúng nét đang chọn (nút kéo / thân) hoặc nét khác chọn được với công cụ hiện tại (trên cùng trước) -> {i, mode} */
  function shapeHit(p) {
    if (sel >= 0 && canPick(shapes[sel])) { const m = hitShape(shapes[sel], p, p.k); if (m) return { i: sel, mode: m } }
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (!canPick(shapes[i])) continue
      if (hitShape(shapes[i], p, p.k)) return { i, mode: 'move' }
    }
    return null
  }
  function down(e) {
    if (!imgEl.current) return
    const p = pt(e)
    /* Chặn mặc định của lần bấm: không thì trình duyệt chuyển focus khỏi ô gõ chữ vừa mở -> ô đóng ngay (không gõ được).
       Đang có ô gõ dở thì ghi chữ đó trước rồi mở ô mới ở chỗ vừa bấm */
    if (tool === 'text') {
      e.preventDefault()
      if (textAt && textRef.current) commitText(textRef.current.value)
      textDone.current = false
      setTextAt(p)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'select' || EDITABLE[tool]) {
      const h = shapeHit(p)
      if (h) { setSel(h.i); drag.current = { i: h.i, mode: h.mode, o: shapes[h.i], x: p.x, y: p.y, before: shapes, moved: false }; return }
      setSel(-1)
      if (tool === 'select') return
    }
    draft.current = tool === 'pen' ? { type: 'pen', color, w: size, pts: [[p.x, p.y]] } : { type: tool, color, w: size, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
    if (tool === 'curve') bendCurve(draft.current)
  }
  function move(e) {
    const g = drag.current
    if (g) {
      const p = pt(e)
      const r = dragShape(g.o, g.mode, p.x - g.x, p.y - g.y)
      g.moved = true
      setShapes(s => s.map((x, i) => (i === g.i ? r : x)))
      return
    }
    const d = draft.current
    if (!d) {
      // rê chuột: đổi con trỏ theo chỗ trúng nét (kéo cạnh / góc / đầu mũi tên / di chuyển)
      if ((tool === 'select' || EDITABLE[tool]) && canvasRef.current) { const h = shapeHit(pt(e)); canvasRef.current.style.cursor = h ? CURSOR[h.mode] : (tool === 'select' ? 'default' : '') }
      return
    }
    const p = pt(e)
    if (d.type === 'pen') d.pts.push([p.x, p.y]); else { d.x2 = p.x; d.y2 = p.y; if (d.type === 'curve') bendCurve(d) }
    redraw()
  }
  function up() {
    const g = drag.current
    if (g) {
      drag.current = null
      if (g.moved) commit(shapes.map((x, j) => (j === g.i ? fixShape(x) : x)), g.before)
      return
    }
    const d = draft.current
    draft.current = null
    if (!d) return
    const tiny = d.type !== 'pen' && Math.abs(d.x2 - d.x1) < 4 && Math.abs(d.y2 - d.y1) < 4
    if (tiny) { redraw(); return }
    // khung / mũi tên / mũi tên uốn mới vẽ xong: chọn luôn để chỉnh ngay
    if (EDITABLE[d.type]) setSel(shapes.length)
    commit([...shapes, fixShape(d)])
  }
  /* Enter và rời ô (blur) đều gọi; textDone chặn ghi 2 lần cùng 1 ô */
  function commitText(v) {
    if (textDone.current) return
    textDone.current = true
    const t = String(v || '').trim()
    if (t && textAt) commit([...shapes, { type: 'text', color, w: size, text: t, x1: textAt.x, y1: textAt.y }])
    setTextAt(null)
  }

  function submit() {
    if (!form.title.trim()) { setErr('Nhập tên lỗi'); return }
    if (!form.requester.trim()) { setErr('Nhập tên người báo'); return }
    try { localStorage.setItem(NAME_KEY, form.requester.trim()) } catch { /* bỏ qua */ }
    // ảnh gửi đi không có khung chọn; JPEG 0.9 cho rõ chữ, quá lớn thì addReport trả null -> gửi không ảnh (bên dưới)
    if (img && canvasRef.current) redraw(false)
    const shot = img && canvasRef.current ? canvasRef.current.toDataURL('image/jpeg', 0.9) : ''
    if (img && canvasRef.current) redraw()
    const where = (pageName ? pageName + ' · ' : '') + window.location.pathname
    const base = {
      requester: form.requester.trim(), issue: form.title.trim(), priority: form.priority, category: form.category,
      desc: (form.desc.trim() ? form.desc.trim() + '\n\n' : '') + 'Trang: ' + where + ' · gửi từ Dezbot',
      page: where, assignee: 'Lê Trung Kiên',
    }
    let t = addReport({ ...base, images: shot ? [{ url: shot, name: 'anh-chup-man-hinh.jpg' }] : [] })
    // bộ nhớ trình duyệt không đủ cho ảnh nét cao: thử lại bản nhỏ hơn (1600px) trước khi bỏ ảnh
    if (!t && shot) {
      const c = canvasRef.current, k = Math.min(1, 1600 / c.width), sm = document.createElement('canvas')
      sm.width = Math.round(c.width * k); sm.height = Math.round(c.height * k)
      redraw(false); const sctx = sm.getContext('2d'); sctx.imageSmoothingQuality = 'high'; sctx.drawImage(c, 0, 0, sm.width, sm.height); redraw()
      t = addReport({ ...base, images: [{ url: sm.toDataURL('image/jpeg', 0.85), name: 'anh-chup-man-hinh.jpg' }] })
    }
    if (!t && shot) { t = addReport({ ...base, images: [] }); if (t) setErr('Ảnh quá lớn để lưu, đã gửi phiếu không kèm ảnh.') }
    if (!t) { setErr('Không lưu được phiếu (bộ nhớ trình duyệt đầy).'); return }
    setSent(t); setView('done')
  }

  if (!open || phase === 'capturing' || phase === 'idle') return null
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return createPortal(
    <div className="bgr-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bgr" role="dialog" aria-modal="true" aria-label="Báo lỗi">
        <div className="bgr-h">
          <span className="bgr-hic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1" /><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" /><path d="M12 20v-9M6.5 13H3M21 13h-3.5M6 9.5 3 8M18 9.5 21 8M6 17l-3 1.5M18 17l3 1.5" /></svg></span>
          <h3>Báo lỗi cho phòng IT</h3>
          <div className="bgr-tabs">
            <button className={view !== 'mine' ? 'on' : ''} onClick={() => { if (view === 'mine') { setView('new'); reset() } }}>Báo lỗi mới</button>
            <button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>Đã gửi {mine.length > 0 && <small>{mine.length}</small>}</button>
          </div>
          <button className="bgr-x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        {view === 'new' && (
          <div className="bgr-body">
            <div className="bgr-shot">
              <div className="bgr-tools">
                {/* thanh công cụ kiểu MarkUp: công cụ (biểu tượng) | màu | thanh kéo cỡ nét | hoàn tác · làm lại · xoá hết */}
                <div className="bgr-grp">
                  {TOOLS.map(([k, l]) => <button key={k} className={`bgr-ib${tool === k ? ' on' : ''}`} title={l} aria-label={l} onClick={() => setTool(k)} disabled={!img}>{TOOL_ICON[k]}</button>)}
                </div>
                <div className="bgr-grp">
                  {COLORS.map(c => <button key={c} className={`bgr-color${color === c ? ' on' : ''}`} style={{ '--c': c }} onClick={() => pickColor(c)} aria-label="Màu" title={sel >= 0 ? 'Đổi màu nét đang chọn' : 'Màu nét'} disabled={!img} />)}
                </div>
                <div className="bgr-grp bgr-size" title={sel >= 0 ? 'Cỡ nét đang chọn' : 'Cỡ nét'}>
                  <input type="range" min="2" max="14" step="1" value={sel >= 0 && shapes[sel] ? (shapes[sel].w || DEF_W) : size} disabled={!img} aria-label="Cỡ nét"
                    style={{ '--v': ((((sel >= 0 && shapes[sel] ? (shapes[sel].w || DEF_W) : size) - 2) / 12) * 100) + '%', '--c': color }}
                    onPointerDown={() => { sizeBefore.current = shapes }}
                    onPointerUp={() => { if (sizeBefore.current && sizeBefore.current !== shapes) commit(shapes, sizeBefore.current); sizeBefore.current = null }}
                    onChange={e => pickSize(Number(e.target.value))} />
                  <em>{sel >= 0 && shapes[sel] ? (shapes[sel].w || DEF_W) : size}px</em>
                </div>
                <div className="bgr-grp">
                  <button className="bgr-ib" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" onClick={undo} disabled={!hist.current.past.length}>{IC_UNDO}</button>
                  <button className="bgr-ib" title="Làm lại (Ctrl+Shift+Z)" aria-label="Làm lại" onClick={redo} disabled={!hist.current.future.length}>{IC_REDO}</button>
                  <button className="bgr-ib" title={sel >= 0 ? 'Xoá nét đang chọn (Delete)' : 'Xoá hết nét'} aria-label="Xoá" disabled={!shapes.length}
                    onClick={() => { if (sel >= 0) { commit(shapes.filter((_, i) => i !== sel)); setSel(-1) } else commit([]) }}>{IC_TRASH}</button>
                </div>
                <span style={{ flex: 1 }} />
                <button onClick={doCapture}>Chụp lại</button>
                <label className="bgr-up">Tải ảnh<input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) fileToImg(f); e.target.value = '' }} /></label>
              </div>
              <div className="bgr-stage">
                {img ? (
                  <div className="bgr-cv">
                    <canvas ref={canvasRef} className={'t-' + tool} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
                    {textAt && (
                      <input key={textAt.x + ',' + textAt.y} ref={textRef} className="bgr-txt" autoFocus style={{ left: textAt.cx, top: textAt.cy, color }} placeholder="Gõ chữ, Enter"
                        onPointerDown={e => e.stopPropagation()}
                        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitText(e.target.value); if (e.key === 'Escape') { textDone.current = true; setTextAt(null) } }}
                        onBlur={e => commitText(e.target.value)} />
                    )}
                  </div>
                ) : (
                  <div className="bgr-empty">
                    <b>Chưa có ảnh chụp màn hình</b>
                    <span>Bấm "Chụp lại" và chọn tab này, tải ảnh lên, hoặc dán ảnh (Ctrl+V). Có thể gửi không kèm ảnh.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bgr-form">
              <label><span>Lỗi gặp phải *</span><input value={form.title} onChange={set('title')} placeholder="VD: Bấm Lưu báo giá bị treo" autoFocus /></label>
              <label><span>Mô tả chi tiết</span><textarea rows={5} value={form.desc} onChange={set('desc')} placeholder="Đang làm gì, bấm vào đâu, mong muốn kết quả ra sao…" /></label>
              <div className="bgr-f"><span>Mức độ</span>
                <div className="bgr-chips">{PRIOS.map(p => <button key={p} className={`p-${p}${form.priority === p ? ' on' : ''}`} onClick={() => setForm(f => ({ ...f, priority: p }))}><i />{PRIO_LABEL[p]}</button>)}</div>
              </div>
              <label><span>Hạng mục</span>
                <select value={form.category} onChange={set('category')}>{TICKET_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label><span>Người báo *</span><input value={form.requester} onChange={set('requester')} placeholder="Họ tên" /></label>
              <div className="bgr-meta">Trang: {(pageName ? pageName + ' · ' : '') + window.location.pathname}</div>
              {err && <div className="bgr-err">{err}</div>}
              <div className="bgr-acts">
                <button className="ghost" onClick={onClose}>Huỷ</button>
                <button className="primary" onClick={submit}>Gửi phòng IT</button>
              </div>
            </div>
          </div>
        )}

        {view === 'done' && sent && (
          <div className="bgr-done">
            <div className="bgr-ok">✓</div>
            <h4>Đã gửi yêu cầu #{sent.id} tới phòng IT</h4>
            <p>{sent.issue}</p>
            {err && <div className="bgr-err">{err}</div>}
            <Steps t={sent} />
            <div className="bgr-acts c">
              <button className="ghost" onClick={() => setView('mine')}>Xem các lỗi đã gửi</button>
              <button className="ghost" onClick={() => { onClose(); nav('/it') }}>Mở Bảng điều khiển IT</button>
              <button className="primary" onClick={onClose}>Xong</button>
            </div>
          </div>
        )}

        {view === 'mine' && (
          <div className="bgr-mine">
            {!mine.length && <div className="bgr-none">Chưa gửi lỗi nào từ trình duyệt này.</div>}
            {mine.map(t => (
              <div key={t.id} className="bgr-mi">
                {t.images?.[0] ? <img src={t.images[0].url} alt="" /> : <span className="bgr-noimg">#{t.id}</span>}
                <div className="bgr-mt">
                  <b>#{t.id} · {t.issue}</b>
                  <small>{t.date} · {PRIO_LABEL[t.priority]} · {t.page || ''}</small>
                  <Steps t={t} small />
                </div>
              </div>
            ))}
            <div className="bgr-acts">
              <span className="bgr-meta">Phiếu lưu ở trình duyệt này; phòng IT cập nhật trạng thái trên trang IT.</span>
              <button className="ghost" onClick={() => { onClose(); nav('/it') }}>Mở Bảng điều khiển IT</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* Báo lỗi dùng chung mọi trang: AppShell gắn 1 BugReportHost; Dezbot (hoặc nơi khác) gọi openBugReport() / đặt <BugChip> để mở.
   Tên trang lấy theo menu (navigation.js) nếu không truyền */
const BUG_EVT = 'siteflow:bug-report'
export function openBugReport(pageName = '') {
  window.dispatchEvent(new CustomEvent(BUG_EVT, { detail: { pageName } }))
}
function navLabel(pathname) {
  const all = [...NAV_MAIN, ...NAV_BOTTOM].filter(x => x && x.path)
  const hit = all.filter(x => (x.path === '/' ? pathname === '/' : pathname === x.path || pathname.startsWith(x.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return hit ? hit.label : ''
}
export function BugReportHost() {
  const loc = useLocation()
  const [st, setSt] = useState(null)   // {pageName} khi đang mở
  useEffect(() => {
    const on = e => setSt({ pageName: (e.detail && e.detail.pageName) || '' })
    window.addEventListener(BUG_EVT, on)
    return () => window.removeEventListener(BUG_EVT, on)
  }, [])
  return <BugReport open={!!st} onClose={() => setSt(null)} pageName={(st && st.pageName) || navLabel(loc.pathname)} />
}
const IC_BUG = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1" /><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z" /><path d="M12 20v-9M6.5 13H3M21 13h-3.5" /></svg>
/* Chip "Báo lỗi" trong Dezbot: className = lớp chip của Dezbot trang đó (giữ dáng chip), onBefore = đóng Dezbot trước khi chụp
   để khung trợ lý không che màn hình cần báo lỗi (chờ hiệu ứng đóng 280ms) */
export function BugChip({ className = '', onBefore, pageName = '' }) {
  return (
    <button type="button" className={(className + ' bgr-chip').trim()} title="Chụp màn hình, đánh dấu và gửi phòng IT"
      onClick={() => { if (onBefore) { onBefore(); setTimeout(() => openBugReport(pageName), 280) } else openBugReport(pageName) }}>
      {IC_BUG}Báo lỗi
    </button>
  )
}

/* Thanh tiến độ: Đã gửi -> IT tiếp nhận -> Đang xử lý (x%) -> Hoàn thành */
function Steps({ t, small }) {
  const cur = reportStep(t)
  const closed = t.status === 'dong'
  return (
    <ol className={`bgr-steps${small ? ' sm' : ''}${closed ? ' closed' : ''}`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < cur || (i === 3 && cur === 3) ? 'done' : i === cur ? 'cur' : ''}>
          <i>{i < cur || (i === 3 && cur === 3) ? '✓' : i + 1}</i>
          <span>{s}{i === 2 && cur === 2 && t.progress ? ' · ' + t.progress + '%' : ''}{i === 2 && t.status === 'chodoi' ? ' (chờ)' : ''}</span>
        </li>
      ))}
      {closed && <li className="x"><i>✕</i><span>Đã đóng</span></li>}
    </ol>
  )
}
