import { useEffect, useRef, useState } from 'react'
import * as api from '../api/chatApi'
import { signIn } from '../state/chatStore'
import { countdownLabel, formatQrCode, qrLoginUrl } from './qrUtil'
import './Device.css'

/* Đăng nhập bằng mã QR ở máy mới (API.md "Đăng nhập bằng QR" bước 1-2, 5): POST /auth/qr/start -> hiện QR
   <origin>/chat/qr#<mã> + mã gõ tay ABCDE-FGHJK + đếm ngược; poll POST /auth/qr/poll mỗi poll_interval giây:
   pending (chờ quét) -> scanned (đã quét bởi <tên>) -> approved (+ auth: lưu phiên như otp/verify rồi vào chat) |
   rejected | expired | consumed. poll_token chỉ ở máy này, không nằm trong QR. Rời màn hình -> dừng poll. */

const TERMINAL = { rejected: 'Đăng nhập đã bị từ chối', expired: 'Mã đã hết hạn', consumed: 'Mã đã được dùng, hãy tạo mã mới' }

export default function QrLogin({ onCancel, onDone }) {
  const [phase, setPhase] = useState('loading') // loading | pending | scanned | done | ended | error
  const [code, setCode] = useState('')
  const [img, setImg] = useState('')
  const [approver, setApprover] = useState('')
  const [msg, setMsg] = useState('') // lý do kết thúc (ended) / lỗi (error)
  const [now, setNow] = useState(Date.now())
  const [expiresAt, setExpiresAt] = useState(0)
  const gen = useRef(0) // tăng mỗi lần tạo mã mới / rời màn hình: vòng poll cũ tự dừng
  const timer = useRef(null)
  const cbs = useRef({ onDone })
  cbs.current = { onDone }

  function stop() {
    gen.current++
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }

  function end(text) { stop(); setMsg(text); setPhase('ended') }

  async function start() {
    stop()
    const g = gen.current
    setPhase('loading'); setMsg(''); setApprover(''); setImg(''); setCode('')
    let s
    try {
      s = await api.qrStart()
    } catch (e) {
      if (g !== gen.current) return
      setMsg((e && e.message) || 'Không tạo được mã QR, thử lại sau'); setPhase('error')
      return
    }
    if (g !== gen.current) return
    if (!s || !s.qr_id || !s.code || !s.poll_token) { setMsg('Máy chủ trả mã QR không hợp lệ'); setPhase('error'); return }
    setCode(s.code)
    setExpiresAt(Date.now() + (Number(s.expires_in) || 120) * 1000)
    setNow(Date.now())
    setPhase('pending')
    try {
      const QR = await import('qrcode')
      const url = await (QR.default || QR).toDataURL(qrLoginUrl(window.location.origin, s.code), { margin: 1, width: 232, errorCorrectionLevel: 'M' })
      if (g === gen.current) setImg(url)
    } catch (e) {
      if (g === gen.current) setImg('') // vẫn còn mã gõ tay
    }
    const every = Math.max(1, Number(s.poll_interval) || 2) * 1000
    const hardStop = Date.now() + ((Number(s.expires_in) || 120) + 90) * 1000 // mất mạng mãi: thôi poll
    const tick = delay => {
      timer.current = setTimeout(async () => {
        if (g !== gen.current) return
        if (Date.now() > hardStop) { end(TERMINAL.expired); return }
        let r
        try {
          r = await api.qrPoll(s.qr_id, s.poll_token)
        } catch (e) {
          if (g !== gen.current) return
          if (e && e.code === 'QR_INVALID') { end(TERMINAL.expired); return }
          tick(e && e.status === 429 ? every * 2 : every) // mạng chập chờn / quá nhanh: thử lại
          return
        }
        if (g !== gen.current) return
        if (!r) { tick(every); return }
        if (Number.isFinite(Number(r.expires_in))) setExpiresAt(Date.now() + Number(r.expires_in) * 1000)
        if (r.status === 'approved' && r.auth) { stop(); finish(r.auth); return }
        if (TERMINAL[r.status]) { end(TERMINAL[r.status]); return }
        if (r.status === 'scanned') {
          setApprover((r.approver && r.approver.display_name) || '')
          setPhase('scanned')
        } else if (r.status === 'pending') setPhase('pending')
        tick(every)
      }, delay)
    }
    tick(every)
  }

  function finish(auth) {
    const saved = api.saveSession(auth, true)
    if (!saved.uid) { setMsg('Không lưu được phiên đăng nhập, thử lại'); setPhase('error'); return }
    /* tài khoản này đã đăng nhập trên trình duyệt (thiết bị cũ): giữ thiết bị mới, xoá thiết bị cũ trên máy chủ */
    if (saved.replaced) api.logoutTokens(saved.replaced)
    setPhase('done')
    signIn(auth.user)
    if (cbs.current.onDone) cbs.current.onDone()
  }

  useEffect(() => {
    start()
    return stop
  }, [])

  /* Đồng hồ đếm ngược */
  useEffect(() => {
    if (phase !== 'pending' && phase !== 'scanned') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])

  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const live = phase === 'pending' || phase === 'scanned'
  const shown = live && left > 0 ? phase : live ? 'waiting' : phase

  return (
    <div className="ch-gate">
      <div className="ch-gate-card ch-qr-card">
        <div className="ch-gate-title">Đăng nhập bằng mã QR</div>
        <div className="ch-gate-text">
          Trên điện thoại đã đăng nhập Dezon Chat, mở menu tài khoản ▸ <b>Quét mã QR đăng nhập</b> rồi quét mã này
          (hoặc quét bằng camera điện thoại, hoặc gõ mã bên dưới).
        </div>
        <div className={'ch-qr-box' + (shown === 'pending' ? '' : ' dim')} aria-live="polite">
          {img ? <img src={img} alt="Mã QR đăng nhập Dezon Chat" width="232" height="232" /> : <div className="ch-qr-ph">{phase === 'loading' ? 'Đang tạo mã…' : ''}</div>}
          {shown === 'scanned' && (
            <div className="ch-qr-over">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              <span>{approver ? `Đã quét bởi ${approver}. Hãy xác nhận trên điện thoại` : 'Đã quét. Hãy xác nhận trên điện thoại'}</span>
            </div>
          )}
          {(phase === 'ended' || phase === 'error' || shown === 'waiting') && (
            <div className="ch-qr-over">
              <span>{shown === 'waiting' ? 'Đang kiểm tra mã…' : msg}</span>
              {shown !== 'waiting' && <button type="button" className="ch-gate-btn" onClick={start}>Tạo mã mới</button>}
            </div>
          )}
          {phase === 'done' && <div className="ch-qr-over"><span>Đăng nhập thành công</span></div>}
        </div>
        {code && live && (
          <div className="ch-qr-code-row">
            <span className="ch-qr-code" aria-label="Mã đăng nhập">{formatQrCode(code)}</span>
            <span className="ch-gate-muted">{left > 0 ? `Mã hết hạn sau ${countdownLabel(left)}` : ''}</span>
          </div>
        )}
        {onCancel && <button type="button" className="ch-gate-link ch-gate-back" onClick={() => { stop(); onCancel() }}>Đăng nhập bằng số điện thoại / email</button>}
      </div>
    </div>
  )
}
