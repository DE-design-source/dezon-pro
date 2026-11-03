import { useEffect, useRef, useState } from 'react'
import * as api from '../api/chatApi'
import { useChat } from '../state/chatStore'
import { countdownLabel, dateTimeLabel, formatQrCode, parseQrText, platformLabel } from './qrUtil'
import './Device.css'

/* Xác nhận đăng nhập bằng QR trên máy đã đăng nhập (API.md "Đăng nhập bằng QR" bước 3-4): quét bằng camera
   (BarcodeDetector, không có thì thư viện jsqr - vd Safari iOS) hoặc gõ mã / mở link /chat/qr#<mã> -> POST /auth/qr/scan
   -> màn xác nhận (thông tin máy đang chờ + cảnh báo) -> POST /auth/qr/approve | reject. Thiết bị mới đăng nhập vào
   tài khoản ĐANG dùng ở tab này. */

const SCAN_EVERY_MS = 250
const FRAME_MAX_PX = 640

/* Hàm đọc QR từ khung hình video: BarcodeDetector nếu trình duyệt có định dạng qr_code, không thì jsqr trên canvas */
async function makeDetector() {
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats()
      if (fmts && fmts.includes('qr_code')) {
        const bd = new window.BarcodeDetector({ formats: ['qr_code'] })
        return async v => {
          const r = await bd.detect(v)
          return r && r.length ? r[0].rawValue || '' : ''
        }
      }
    } catch (e) { /* dùng jsqr */ }
  }
  const mod = await import('jsqr')
  const jsQR = mod.default || mod
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return v => {
    const w = v.videoWidth
    const h = v.videoHeight
    if (!w || !h || !ctx) return ''
    const k = Math.min(1, FRAME_MAX_PX / Math.max(w, h))
    canvas.width = Math.round(w * k)
    canvas.height = Math.round(h * k)
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    return r ? r.data || '' : ''
  }
}

function camErrText(e) {
  const n = e && e.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Chưa được phép dùng camera. Hãy cho phép camera trong trình duyệt hoặc gõ mã.'
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Không tìm thấy camera. Hãy gõ mã hiện trên thiết bị mới.'
  if (n === 'NotReadableError') return 'Camera đang được ứng dụng khác dùng. Hãy đóng ứng dụng đó hoặc gõ mã.'
  return 'Không mở được camera. Hãy gõ mã hiện trên thiết bị mới.'
}

export default function QrApprove({ initialCode, onClose }) {
  const chat = useChat()
  const [step, setStep] = useState('input') // input | checking | confirm | approved | rejected
  const [typed, setTyped] = useState(() => (initialCode ? formatQrCode(parseQrText(initialCode) || initialCode) : ''))
  const [code, setCode] = useState('')
  const [info, setInfo] = useState(null) // QRSession
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [cam, setCam] = useState('off') // off | starting | on
  const [camErr, setCamErr] = useState('')
  const [camHint, setCamHint] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const camGen = useRef(0)
  const alive = useRef(true)

  function stopCamera() {
    camGen.current++
    const s = streamRef.current
    streamRef.current = null
    if (s) s.getTracks().forEach(t => { try { t.stop() } catch (e) { /* bỏ qua */ } })
    if (videoRef.current) videoRef.current.srcObject = null
    setCam('off')
  }

  async function startCamera() {
    stopCamera()
    const g = camGen.current
    setCamErr(''); setCamHint('')
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null
    if (!md || typeof md.getUserMedia !== 'function') {
      setCamErr('Trình duyệt không mở được camera ở trang này (cần https). Hãy gõ mã hiện trên thiết bị mới.')
      return
    }
    setCam('starting')
    let stream
    try {
      stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    } catch (e) {
      if (g === camGen.current) { setCam('off'); setCamErr(camErrText(e)) }
      return
    }
    const v = videoRef.current
    if (g !== camGen.current || !v) { stream.getTracks().forEach(t => t.stop()); return }
    streamRef.current = stream
    v.srcObject = stream
    try { await v.play() } catch (e) { /* tự phát khi đủ dữ liệu (muted + playsInline) */ }
    let detect
    try { detect = await makeDetector() } catch (e) {
      if (g === camGen.current) { stopCamera(); setCamErr('Không tải được bộ đọc mã QR. Hãy gõ mã hiện trên thiết bị mới.') }
      return
    }
    if (g !== camGen.current) return
    setCam('on')
    const loop = async () => {
      if (g !== camGen.current) return
      const el = videoRef.current
      let text = ''
      if (el && el.readyState >= 2) {
        try { text = await detect(el) } catch (e) { text = '' }
      }
      if (g !== camGen.current) return
      if (text) {
        const c = parseQrText(text)
        if (c) { stopCamera(); setTyped(formatQrCode(c)); submit(c); return }
        setCamHint('Mã QR này không phải mã đăng nhập Dezon Chat')
      }
      setTimeout(loop, SCAN_EVERY_MS)
    }
    loop()
  }

  async function submit(c) {
    if (!c) { setErr('Mã không hợp lệ. Mã gồm 10 ký tự, vd. ABCDE-FGHJK'); return }
    setErr(''); setBusy(true); setStep('checking')
    try {
      const r = await api.qrScan(c)
      if (!alive.current) return
      setCode(c)
      setInfo(r || {})
      setExpiresAt(Date.now() + (Number(r && r.expires_in) || 0) * 1000)
      setNow(Date.now())
      setStep('confirm')
    } catch (e) {
      if (!alive.current) return
      setErr((e && e.message) || 'Không kiểm tra được mã, thử lại sau')
      setStep('input')
    }
    setBusy(false)
  }

  async function decide(approve) {
    if (busy) return
    setErr(''); setBusy(true)
    try {
      await (approve ? api.qrApprove(code) : api.qrReject(code))
      if (!alive.current) return
      setStep(approve ? 'approved' : 'rejected')
    } catch (e) {
      if (!alive.current) return
      setErr((e && e.message) || 'Không gửi được, thử lại sau')
      if (e && (e.code === 'QR_EXPIRED' || e.code === 'QR_USED' || e.code === 'QR_INVALID')) { setStep('input'); setInfo(null) }
    }
    setBusy(false)
  }

  useEffect(() => {
    alive.current = true
    const c = initialCode ? parseQrText(initialCode) : ''
    if (c) submit(c)
    else if (initialCode) setErr('Mã trong đường dẫn không hợp lệ. Hãy quét lại hoặc gõ mã.')
    else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) startCamera()
    return () => { alive.current = false; stopCamera() }
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (step !== 'confirm') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step])

  const me = chat.me
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const errBox = err && <div role="alert" className="ch-gate-err">{err}</div>
  const head = title => (
    <div className="ch-ct-modal-head">
      <h3>{title}</h3>
      <button type="button" className="ch-ct-x" onClick={onClose} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
    </div>
  )

  let body
  if (step === 'confirm' && info) {
    const row = (label, value) => value ? <div className="ch-qr-info-row"><span>{label}</span><b title={value}>{value}</b></div> : null
    body = (
      <>
        {head('Đăng nhập Dezon Chat trên thiết bị mới?')}
        {errBox}
        <div className="ch-qr-info">
          {row('Thiết bị', info.device_name)}
          {row('Nền tảng', info.platform ? platformLabel(info.platform) : '')}
          {row('Trình duyệt', info.user_agent)}
          {row('Địa chỉ IP', info.request_ip)}
          {row('Thời gian', dateTimeLabel(info.created_at))}
          {me && row('Tài khoản', me.display_name)}
        </div>
        <div className="ch-qr-warn" role="note">Chỉ xác nhận nếu chính bạn đang đăng nhập trên thiết bị này. Không quét mã do người khác gửi.</div>
        <div className="ch-gate-muted ch-qr-left">{left > 0 ? `Mã hết hạn sau ${countdownLabel(left)}` : 'Mã đã hết hạn'}</div>
        <div className="ch-qr-actions">
          <button type="button" className="ch-ct-btn ghost" disabled={busy} onClick={() => decide(false)}>Từ chối</button>
          <button type="button" className="ch-ct-btn solid" disabled={busy || left <= 0} onClick={() => decide(true)}>{busy ? 'Đang gửi…' : 'Xác nhận đăng nhập'}</button>
        </div>
      </>
    )
  } else if (step === 'approved' || step === 'rejected') {
    body = (
      <>
        {head(step === 'approved' ? 'Đã xác nhận đăng nhập' : 'Đã từ chối đăng nhập')}
        <div className="ch-gate-text">
          {step === 'approved'
            ? 'Thiết bị mới sẽ vào Dezon Chat trong giây lát. Bạn có thể xem và đăng xuất thiết bị ở mục Thiết bị đăng nhập.'
            : 'Thiết bị kia không được đăng nhập vào tài khoản của bạn.'}
        </div>
        <div className="ch-qr-actions"><button type="button" className="ch-ct-btn solid" onClick={onClose}>Đóng</button></div>
      </>
    )
  } else {
    body = (
      <>
        {head('Quét mã QR đăng nhập')}
        <div className="ch-gate-text">
          Trên máy tính, chọn <b>Đăng nhập bằng mã QR</b> ở trang đăng nhập Dezon Chat rồi quét mã hiện ra
          {me ? <> - thiết bị đó sẽ đăng nhập tài khoản <b>{me.display_name}</b></> : null}.
        </div>
        {errBox}
        <div className={'ch-qr-cam' + (cam === 'off' ? ' off' : '')}>
          <video ref={videoRef} muted playsInline autoPlay aria-label="Khung quét mã QR" />
          {cam === 'starting' && <span className="ch-qr-cam-msg">Đang mở camera…</span>}
          {cam === 'on' && <span className="ch-qr-cam-frame" aria-hidden="true" />}
        </div>
        {camErr && <div className="ch-gate-hint">{camErr}</div>}
        {cam === 'on' && camHint && <div className="ch-gate-hint">{camHint}</div>}
        {cam === 'off'
          ? <button type="button" className="ch-ct-btn" disabled={busy} onClick={startCamera}>Quét bằng camera</button>
          : <button type="button" className="ch-ct-btn ghost" onClick={stopCamera}>Tắt camera</button>}
        <form className="ch-gate-form ch-qr-type" onSubmit={e => { e.preventDefault(); if (!busy) submit(parseQrText(typed)) }}>
          <label className="ch-gate-muted" htmlFor="ch-qr-code-input">Hoặc gõ mã hiện dưới QR</label>
          <input
            id="ch-qr-code-input"
            className="ch-gate-input ch-qr-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            placeholder="ABCDE-FGHJK"
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
          <button className="ch-ct-btn solid" disabled={busy || !typed.trim()}>{step === 'checking' ? 'Đang kiểm tra…' : 'Tiếp tục'}</button>
        </form>
      </>
    )
  }

  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ch-ct-modal-box ch-qr-modal" role="dialog" aria-modal="true">{body}</div>
    </div>
  )
}
