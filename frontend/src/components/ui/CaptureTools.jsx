import { useEffect, useRef, useState } from 'react'
import './CaptureTools.css'

/* Công cụ màn hình gọi từ Dezbot mọi trang (MarkUp 2026-11-16 18:51):
   - Chụp hình: màn hình đang xem, hoặc chụp cuộn (cuộn vùng nội dung chính từ đầu tới cuối rồi ghép thành 1 ảnh dài)
   - Ảnh -> chữ: nhận chữ tiếng Việt + Anh trong ảnh (tesseract.js chạy ngay trong trình duyệt, tải lười khi dùng lần đầu)
   - Quay màn hình: MediaRecorder trên luồng getDisplayMedia, bấm Dừng (hoặc dừng chia sẻ) là tải video về
   Kết quả đều TẢI VỀ MÁY (PNG / TXT / WebM). Dùng Screen Capture API: trình duyệt luôn hỏi người dùng chọn tab / màn hình.
   Dezbot gọi openCapture(mode); CaptureHost (gắn 1 lần trong AppShell) nghe sự kiện và hiện hộp tương ứng. */
const EVT = 'siteflow:capture'
export function openCapture(mode) { window.dispatchEvent(new CustomEvent(EVT, { detail: { mode } })) }

const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)
const wait = ms => new Promise(r => setTimeout(r, ms))
const stamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) }
function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
const canvasBlob = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Không tạo được ảnh'))), 'image/png'))

/* Mở luồng chụp tab hiện tại (độ phân giải thật x devicePixelRatio) + 1 thẻ video đang chạy */
async function openTabStream() {
  const dpr = window.devicePixelRatio || 1
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', width: { ideal: Math.round(window.screen.width * dpr) }, height: { ideal: Math.round(window.screen.height * dpr) }, frameRate: { ideal: 10 } },
    audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
  })
  const video = document.createElement('video')
  video.srcObject = stream; video.muted = true; video.playsInline = true
  await video.play()
  await wait(450)   // chờ thanh "đang chia sẻ" của trình duyệt hiện xong, khung hình ổn định
  return { stream, video, stop: () => stream.getTracks().forEach(t => t.stop()) }
}
async function shotVisible() {
  const s = await openTabStream()
  try {
    const c = document.createElement('canvas')
    c.width = s.video.videoWidth; c.height = s.video.videoHeight
    c.getContext('2d').drawImage(s.video, 0, 0)
    return c
  } finally { s.stop() }
}

/* Vùng cuộn chính của trang: phần tử cuộn dọc được, chiếm nhiều diện tích màn hình nhất (Pipeline, bảng, Wiki...) */
function mainScroller() {
  let best = null; let bestArea = 0
  const vw = window.innerWidth; const vh = window.innerHeight
  document.querySelectorAll('body *').forEach(el => {
    if (el.closest('.cpt-ui')) return
    if (el.scrollHeight - el.clientHeight < 40) return
    const oy = getComputedStyle(el).overflowY
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)); const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    if (w * h > bestArea) { bestArea = w * h; best = el }
  })
  const doc = document.scrollingElement
  if (doc && doc.scrollHeight - doc.clientHeight > 40 && bestArea < vw * vh * 0.25) return doc
  return best || doc
}
const MAX_OUT_H = 30000   // giới hạn chiều cao ảnh ghép (px) để trình duyệt không hết bộ nhớ
/* phần tử cuộn dọc được gần nhất chứa điểm (x, y), bỏ qua giao diện của công cụ */
function scrollerAt(x, y) {
  const list = document.elementsFromPoint(x, y)
  for (const top of list) {
    if (top.closest('.cpt-ui')) continue
    for (let el = top; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollHeight - el.clientHeight < 40) continue
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el
    }
    break
  }
  const doc = document.scrollingElement
  return doc && doc.scrollHeight - doc.clientHeight > 40 ? doc : null
}
/* target: vùng cuộn người dùng chọn (bỏ trống = vùng cuộn chính); region {left, top, width, height} (px màn hình, tuỳ chọn):
   khung tọa độ người dùng kéo (MarkUp 2026-11-16 19:16) - chỉ lấy dải ngang / dọc đó, cuộn từ vị trí hiện tại tới cuối vùng cuộn.
   Không có region: cả vùng cuộn, từ đầu tới cuối. onStep(i, n) báo tiến trình */
async function shotScroll(onStep, target, region) {
  const el = target || mainScroller()
  if (!el) return shotVisible()
  const isDoc = el === document.scrollingElement
  const s = await openTabStream()
  const y0 = el.scrollTop
  try {
    const view = isDoc ? window.innerHeight : el.clientHeight
    const total = el.scrollHeight
    const maxT = Math.max(0, total - view)
    // vùng nhìn thấy của phần tử cuộn (px màn hình)
    const er = isDoc ? { left: 0, top: 0 } : el.getBoundingClientRect()
    const eL = isDoc ? 0 : er.left + el.clientLeft
    const eT = isDoc ? 0 : er.top + el.clientTop
    const eW = isDoc ? document.documentElement.clientWidth : el.clientWidth
    let bL = eL, bT = eT, bW = eW, bH = view
    if (region) {
      bL = Math.max(eL, region.left); bT = Math.max(eT, region.top)
      bW = Math.max(1, Math.min(eL + eW, region.left + region.width) - bL)
      bH = Math.max(1, Math.min(eT + view, region.top + region.height) - bT)
    }
    const t0 = region ? y0 : 0
    const outH = maxT - t0 + bH
    let out = null; let ctx = null; let k = 1
    const stepH = Math.max(40, Math.floor(bH * 0.9))
    const n = Math.max(1, Math.ceil((maxT - t0) / stepH) + 1)
    for (let i = 0; i < n; i++) {
      el.scrollTop = Math.min(maxT, t0 + i * stepH)
      await wait(320)   // chờ trang vẽ xong và khung hình mới tới luồng
      const at = el.scrollTop
      const rx = s.video.videoWidth / window.innerWidth; const ry = s.video.videoHeight / window.innerHeight
      if (!out) {
        k = Math.min(rx, MAX_OUT_H / outH)
        out = document.createElement('canvas')
        out.width = Math.round(bW * k); out.height = Math.round(Math.min(outH, MAX_OUT_H / k) * k)
        ctx = out.getContext('2d')
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff'; ctx.fillRect(0, 0, out.width, out.height)
      }
      ctx.drawImage(s.video, bL * rx, bT * ry, bW * rx, bH * ry, 0, Math.round((at - t0) * k), Math.round(bW * k), Math.round(bH * k))
      if (onStep) onStep(i + 1, n)
      if (at >= maxT - 1) break
    }
    return out
  } finally {
    el.scrollTop = y0
    s.stop()
  }
}

/* ===== Ảnh -> chữ (tesseract.js, tải lười) ===== */
async function ocr(image, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['vie', 'eng'], 1, {
    logger: m => { if (onProgress && m && typeof m.progress === 'number') onProgress(m.status, m.progress) },
  })
  try {
    const { data } = await worker.recognize(image)
    return (data && data.text) || ''
  } finally { await worker.terminate() }
}

/* ===== Quay màn hình ===== */
function recMime() {
  const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  for (const m of list) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m } catch { /* bỏ qua */ } }
  return ''
}
const fmtT = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')

/* Chọn vùng (MarkUp 2026-11-16 19:05): ảnh màn hình vừa chụp phủ kín màn hình, kéo chuột vẽ khung -> cắt đúng vùng đó.
   canvas: ảnh gốc; onDone(canvas cắt) | onCancel() */
/* Chọn vùng cuộn để chụp cuộn (MarkUp 2026-11-16 19:11): rê chuột = viền xanh quanh vùng cuộn dưới con trỏ, bấm = chụp vùng đó;
   nút "Toàn trang" = vùng cuộn chính của trang. onPick(element | null) / onCancel() */
function ScrollPick({ onPick, onCancel }) {
  const [hl, setHl] = useState(null)     // {el, r}: vùng cuộn dưới con trỏ
  const [box, setBox] = useState(null)   // khung tọa độ đang / đã kéo {x, y, w, h}
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } else if (e.key === 'Enter' && box && box.w > 8 && box.h > 8) go() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  })
  const hover = (x, y) => {
    const el = scrollerAt(x, y)
    if (!el) { setHl(null); return }
    const r = el === document.scrollingElement ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect()
    setHl(h => (h && h.el === el ? h : { el, r: { left: r.left, top: r.top, width: r.width, height: r.height } }))
  }
  const onBar = e => !!e.target.closest('.cpt-pick-bar')
  const down = e => { if (e.button !== 0 || onBar(e)) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY }; setDragging(true); setBox(null) }
  const move = e => {
    if (onBar(e)) return
    if (start.current) { const a = start.current; setBox({ x: Math.min(a.x, e.clientX), y: Math.min(a.y, e.clientY), w: Math.abs(e.clientX - a.x), h: Math.abs(e.clientY - a.y) }); return }
    if (!box) hover(e.clientX, e.clientY)
  }
  const up = e => {
    if (!start.current) return
    const a = start.current; start.current = null; setDragging(false)
    // bấm (không kéo) = chọn nguyên vùng cuộn dưới con trỏ
    if (Math.abs(e.clientX - a.x) < 6 && Math.abs(e.clientY - a.y) < 6) { setBox(null); if (hl) onPick(hl.el, null); return }
  }
  function go() {
    if (!box) return
    const el = scrollerAt(box.x + box.w / 2, box.y + box.h / 2)
    onPick(el, { left: box.x, top: box.y, width: box.w, height: box.h })
  }
  const ok = box && box.w > 8 && box.h > 8
  return (
    <div className="cpt-ui cpt-pick" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {box ? <div className="cpt-pick-r box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>{ok && <span>{Math.round(box.w)} x {Math.round(box.h)} · cuộn tới cuối vùng</span>}</div>
        : hl && <div className="cpt-pick-r" style={hl.r}><span>Bấm để chụp cuộn cả khung này, hoặc kéo để chọn tọa độ</span></div>}
      <div className="cpt-pick-bar">
        {ok && !dragging ? (
          <>
            <span>Đã chọn tọa độ {Math.round(box.x)}, {Math.round(box.y)} · {Math.round(box.w)} x {Math.round(box.h)}</span>
            <button type="button" className="pri" onClick={go}>Bắt đầu chụp cuộn</button>
            <button type="button" onClick={() => setBox(null)}>Chọn lại</button>
          </>
        ) : (
          <>
            <span>Kéo chuột chọn tọa độ vùng cần chụp (hoặc bấm 1 khung cuộn) · Esc để huỷ</span>
            <button type="button" className="pri" onClick={() => onPick(null, null)}>Toàn trang</button>
          </>
        )}
        <button type="button" onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  )
}

/* action: chữ nút xác nhận; hint: dòng nhắc; onAll: (tuỳ chọn) dùng cả màn hình không cần chọn */
function CropOverlay({ canvas, onDone, onCancel, action = 'Tải về', hint = 'Kéo chuột để chọn vùng cần chụp', onAll }) {
  const [url] = useState(() => canvas.toDataURL('image/png'))
  const [r, setR] = useState(null)        // {x, y, w, h} theo px màn hình
  const drag = useRef(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } else if (e.key === 'Enter' && r && r.w > 4 && r.h > 4) save() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  })
  const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })
  const down = e => { if (e.button !== 0 || e.target.closest('.cpt-crop-bar')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; setDragging(true); setR({ x: e.clientX, y: e.clientY, w: 0, h: 0 }) }
  const move = e => { if (drag.current) setR(norm(drag.current, { x: e.clientX, y: e.clientY })) }
  const up = () => { drag.current = null; setDragging(false) }
  function save() {
    if (!r || r.w < 5 || r.h < 5) return
    const sx = canvas.width / window.innerWidth, sy = canvas.height / window.innerHeight
    const c = document.createElement('canvas')
    c.width = Math.round(r.w * sx); c.height = Math.round(r.h * sy)
    c.getContext('2d').drawImage(canvas, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, c.width, c.height)
    onDone(c)
  }
  const ok = r && r.w >= 5 && r.h >= 5
  const barTop = ok ? (r.y + r.h + 52 > window.innerHeight ? Math.max(8, r.y - 48) : r.y + r.h + 8) : 0
  return (
    <div className="cpt-ui cpt-crop" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <img src={url} alt="" draggable={false} />
      {/* vùng ngoài khung tối đi bằng box-shadow của khung */}
      {r ? <div className="cpt-crop-r" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>{ok && <span>{Math.round(r.w)} x {Math.round(r.h)}</span>}</div> : <div className="cpt-crop-dim" />}
      {!r && <div className="cpt-crop-hint">{hint} · Esc để huỷ</div>}
      {!r && onAll && <div className="cpt-crop-bar all"><button type="button" className="pri" onClick={onAll}>Dùng cả màn hình</button><button type="button" onClick={onCancel}>Huỷ</button></div>}
      {ok && !dragging && (
        <div className="cpt-crop-bar" style={{ top: barTop, left: Math.min(Math.max(8, r.x + r.w - 230), window.innerWidth - 238) }}>
          <button type="button" onClick={onCancel}>Huỷ</button>
          <button type="button" onClick={() => setR(null)}>Chọn lại</button>
          <button type="button" className="pri" onClick={save}>{action}</button>
        </div>
      )}
    </div>
  )
}

const errMsg = e => (e && (e.name === 'NotAllowedError' || e.name === 'AbortError') ? 'Đã huỷ: chưa cho phép chia sẻ màn hình.' : 'Lỗi: ' + ((e && e.message) || e))

export function CaptureHost() {
  const [mode, setMode] = useState('')     // '' | 'shot' | 'ocr' | 'rec'
  const [busy, setBusy] = useState('')     // chữ trạng thái khi đang chạy
  const [hide, setHide] = useState(false)  // ẩn giao diện của mình trong lúc chụp
  const [msg, setMsg] = useState('')
  const [text, setText] = useState(null)   // kết quả ảnh -> chữ
  const [rec, setRec] = useState(null)     // {t} khi đang quay
  const [crop, setCrop] = useState(null)   // canvas ảnh màn hình đang chọn vùng
  const [cropFor, setCropFor] = useState('save')   // 'save' = tải ảnh vùng | 'ocr' = lấy chữ trong vùng (MarkUp 2026-11-16 19:19)
  const [picking, setPicking] = useState(false)   // đang chọn vùng cuộn
  const [prog, setProg] = useState(null)          // tiến trình chụp cuộn {i, n, region}
  const recRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    const on = e => { const m = e.detail && e.detail.mode; if (!m) return; setMsg(''); setText(null); setBusy(''); setMode(m) }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [])
  const close = () => { if (!busy) { setMode(''); setText(null); setMsg('') } }
  useEffect(() => {
    if (!mode || rec) return undefined
    const k = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  /* scroll: true = chụp cuộn; target: vùng cuộn đã chọn (null = toàn trang); region: khung tọa độ đã kéo */
  async function doShot(scroll, target, region) {
    if (!supported()) { setMsg('Trình duyệt không hỗ trợ chụp màn hình (cần Chrome / Edge / Firefox bản mới).'); return }
    setMsg(''); setBusy(scroll ? 'Đang chụp cuộn…' : 'Đang chụp…'); setHide(true)
    try {
      await wait(120)
      const c = scroll ? await shotScroll((i, n) => { setBusy('Đang chụp cuộn ' + i + '/' + n + '…'); setProg({ i, n, region }) }, target, region) : await shotVisible()
      download(await canvasBlob(c), (scroll ? 'chup-cuon-' : 'chup-man-hinh-') + stamp() + '.png')
      setHide(false); setBusy(''); setProg(null); setMode('')
    } catch (e) { setHide(false); setBusy(''); setProg(null); setMsg(errMsg(e)) }
  }

  async function doRegion() {
    if (!supported()) { setMsg('Trình duyệt không hỗ trợ chụp màn hình (cần Chrome / Edge / Firefox bản mới).'); return }
    setMsg(''); setBusy('Đang chụp…'); setHide(true)
    try { await wait(120); const c = await shotVisible(); setBusy(''); setCropFor('save'); setCrop(c) } catch (e) { setHide(false); setBusy(''); setMsg(errMsg(e)) }
  }
  const cropDone = async c => {
    if (cropFor === 'ocr') { setCrop(null); setHide(false); runOcr(c); return }
    try { download(await canvasBlob(c), 'chup-vung-' + stamp() + '.png') } catch (e) { setMsg(errMsg(e)) }
    setCrop(null); setHide(false); setMode('')
  }
  const cropCancel = () => { setCrop(null); setHide(false) }

  async function runOcr(img) {
    setMsg(''); setText(null); setBusy('Đang tải bộ nhận chữ…')
    try {
      const t = await ocr(img, (st, p) => setBusy((/recogniz/i.test(st) ? 'Đang nhận chữ ' : 'Đang tải dữ liệu ngôn ngữ ') + Math.round(p * 100) + '%'))
      setText(t.trim()); setBusy('')
      if (!t.trim()) setMsg('Không thấy chữ nào trong ảnh.')
    } catch (e) { setBusy(''); setMsg('Không nhận được chữ: ' + ((e && e.message) || e)) }
  }
  async function ocrFromScreen() {
    if (!supported()) { setMsg('Trình duyệt không hỗ trợ chụp màn hình.'); return }
    setHide(true)
    let c
    try { await wait(120); c = await shotVisible() } catch (e) { setHide(false); setMsg(errMsg(e)); return }
    // chọn tọa độ vùng có chữ trước, rồi mới nhận chữ (MarkUp 2026-11-16 19:19)
    setCropFor('ocr'); setCrop(c)
  }
  const pickFile = f => { if (f && /^image\//.test(f.type)) runOcr(f); else if (f) setMsg('Chỉ nhận tệp ảnh (PNG, JPG, WEBP…).') }
  useEffect(() => {
    if (mode !== 'ocr') return undefined
    const p = e => { const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => /^image\//.test(x.type)); if (it) { e.preventDefault(); pickFile(it.getAsFile()) } }
    window.addEventListener('paste', p)
    return () => window.removeEventListener('paste', p)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function startRec() {
    if (!supported() || !window.MediaRecorder) { setMsg('Trình duyệt không hỗ trợ quay màn hình.'); return }
    setMsg('')
    let stream
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }) } catch (e) { setMsg(errMsg(e)); return }
    const mime = recMime()
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    const chunks = []
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      clearInterval(recRef.current && recRef.current.timer)
      const type = mr.mimeType || mime || 'video/webm'
      if (chunks.length) download(new Blob(chunks, { type }), 'quay-man-hinh-' + stamp() + (/mp4/.test(type) ? '.mp4' : '.webm'))
      recRef.current = null; setRec(null); setMode('')
    }
    stream.getVideoTracks().forEach(t => { t.onended = () => { if (mr.state !== 'inactive') mr.stop() } })   // bấm "Dừng chia sẻ" của trình duyệt
    mr.start(1000)
    const t0 = Date.now()
    const timer = setInterval(() => setRec({ t: Math.floor((Date.now() - t0) / 1000) }), 500)
    recRef.current = { mr, timer }
    setRec({ t: 0 })
  }
  const stopRec = () => { const r = recRef.current; if (r && r.mr.state !== 'inactive') r.mr.stop() }
  useEffect(() => () => { const r = recRef.current; if (r) { clearInterval(r.timer); if (r.mr.state !== 'inactive') r.mr.stop() } }, [])

  if (rec) {
    return (
      <div className="cpt-ui cpt-recbar" role="status">
        <i className="cpt-dot" /> Đang quay <b>{fmtT(rec.t)}</b>
        <button type="button" onClick={stopRec}>Dừng &amp; tải về</button>
      </div>
    )
  }
  if (picking) return <ScrollPick onPick={(el, region) => { setPicking(false); doShot(true, el, region) }} onCancel={() => { setPicking(false); setHide(false) }} />
  if (crop) {
    return cropFor === 'ocr'
      ? <CropOverlay canvas={crop} onDone={cropDone} onCancel={cropCancel} action="Lấy chữ" hint="Kéo chuột chọn vùng có chữ" onAll={() => cropDone(crop)} />
      : <CropOverlay canvas={crop} onDone={cropDone} onCancel={cropCancel} />
  }
  if (!mode) return null
  const progBar = prog && hide ? (() => {
    const r = prog.region
    const pos = !r ? null : r.top + r.height < window.innerHeight - 56 ? { bottom: 14 } : r.top > 56 ? { top: 14 } : null
    return pos ? <div className="cpt-ui cpt-prog" style={pos}><i className="cpt-spin" />Đang chụp cuộn {prog.i}/{prog.n}<b style={{ width: Math.round(prog.i / prog.n * 100) + '%' }} /></div> : null
  })() : null
  const title = mode === 'shot' ? 'Chụp hình' : mode === 'ocr' ? 'Ảnh → chữ' : 'Quay màn hình'
  return (
    <>
    {progBar}
    <div className="cpt-ui cpt-ov" style={hide ? { visibility: 'hidden' } : undefined} onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="cpt-box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="cpt-h"><b>{title}</b><button type="button" className="cpt-x" title="Đóng (Esc)" onClick={close} disabled={!!busy}>✕</button></div>
        {mode === 'shot' && (
          <div className="cpt-opts">
            <button type="button" disabled={!!busy} onClick={() => doShot(false)}><b>Màn hình đang xem</b><span>Chụp đúng phần đang thấy trên màn hình</span></button>
            <button type="button" disabled={!!busy} onClick={() => { setMsg(''); setPicking(true) }}><b>Chụp cuộn</b><span>Chọn tọa độ (kéo khung) hoặc 1 khung cuộn / cả trang, rồi tự cuộn tới cuối và ghép thành 1 ảnh dài</span></button>
            <button type="button" className="wide" disabled={!!busy} onClick={doRegion}><b>Chọn vùng</b><span>Kéo chuột vẽ khung trên màn hình để chụp đúng phần cần</span></button>
          </div>
        )}
        {mode === 'ocr' && (
          <>
            <div className="cpt-drop" role="button" tabIndex={0} onClick={() => !busy && fileRef.current && fileRef.current.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files && e.dataTransfer.files[0]) }}>
              <b>Chọn ảnh, kéo thả ảnh vào đây hoặc dán (Ctrl+V)</b>
              <span>Nhận chữ tiếng Việt và tiếng Anh ngay trên máy, ảnh không gửi đi đâu. Lần đầu cần tải dữ liệu ngôn ngữ (~10-15 MB).</span>
            </div>
            <div className="cpt-opts one"><button type="button" disabled={!!busy} onClick={ocrFromScreen}><b>Chụp màn hình rồi lấy chữ</b><span>Chọn vùng có chữ trên màn hình (hoặc cả màn hình), rồi mới nhận chữ</span></button></div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { pickFile(e.target.files && e.target.files[0]); e.target.value = '' }} />
            {text != null && text !== '' && (
              <div className="cpt-out">
                <textarea readOnly value={text} rows={8} onFocus={e => e.target.select()} />
                <button type="button" className="cpt-pri" onClick={() => download(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'anh-sang-chu-' + stamp() + '.txt')}>Tải về .txt</button>
              </div>
            )}
          </>
        )}
        {mode === 'rec' && (
          <div className="cpt-opts one">
            <button type="button" onClick={startRec}><b>Bắt đầu quay</b><span>Chọn tab / cửa sổ / cả màn hình; có thể bật kèm âm thanh. Bấm "Dừng &amp; tải về" để lưu video (WebM).</span></button>
          </div>
        )}
        {busy && <div className="cpt-busy"><i className="cpt-spin" />{busy}</div>}
        {msg && <div className="cpt-msg">{msg}</div>}
      </div>
    </div>
    </>
  )
}

/* 3 nút cho màn chào Dezbot: className = lớp chip của trang; wrap = lớp khung bọc từng chip (lưới chủ đề), bỏ trống = không bọc */
const IC = {
  shot: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" /><circle cx="12" cy="13" r="3" /></svg>,
  ocr: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 8h8M12 8v8" /></svg>,
  rec: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m22 8-6 4 6 4z" /></svg>,
}
const ITEMS = [['shot', 'Chụp hình'], ['ocr', 'Ảnh → chữ'], ['rec', 'Quay màn hình']]
export function CaptureChips({ className = '', wrap = '', onBefore }) {
  const go = m => { if (onBefore) onBefore(); setTimeout(() => openCapture(m), onBefore ? 280 : 0) }
  return ITEMS.map(([m, lb]) => {
    const b = <button key={m} type="button" className={className + ' cpt-chip'} onClick={() => go(m)}>{IC[m]}{lb}</button>
    return wrap ? <div key={m} className={wrap}>{b}</div> : b
  })
}
