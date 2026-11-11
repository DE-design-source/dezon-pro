import { useEffect, useRef, useState } from 'react'
import * as api from '../api/chatApi'
import { retry, signIn, switchAccount } from '../state/chatStore'
import { contactText, formatPhone, normalizeEmail, normalizePhone } from '../state/chatLogic'
import { colorFor, initials } from './shared'
import QrLogin from './QrLogin'
import { takeForcedSignOutNotice } from './qrUtil'

/* Cổng đăng nhập Dezon Chat (CHAT.md mục 6): số điện thoại HOẶC email (công tắc ở bước đầu) -> mã OTP 6 số gửi qua
   SMS / email -> (tài khoản mới) tên hiển thị. Tài khoản email và tài khoản số là hai tài khoản riêng (chưa liên kết).
   Danh tính chat riêng, không dùng tài khoản QS. Giống WorkGate: chưa cấu hình VITE_API_URL / đang kiểm tra /
   không tới được máy chủ thì hiện thẻ trạng thái.
   mode 'add' (bộ chọn tài khoản ▸ Thêm tài khoản): cùng các bước, có nút "Quay lại"; đăng nhập xong tab chuyển sang
   tài khoản mới, tài khoản cũ vẫn đăng nhập. Tài khoản đã có trong kho thì chỉ thay token của nó (không thêm trùng)
   và báo máy chủ xoá thiết bị cũ. Tab chưa có tài khoản mà kho đã có tài khoản khác: liệt kê để chọn nhanh.
   "Đăng nhập bằng mã QR" (API.md "Đăng nhập bằng QR"): hiện QR để điện thoại đã đăng nhập quét và xác nhận (QrLogin).
   Vừa bị đăng xuất mà không tự bấm (thiết bị bị đăng xuất từ xa / phiên bị thu hồi) -> báo một lần ở bước đầu. */

const METHODS = [{ key: 'phone', label: 'Số điện thoại' }, { key: 'email', label: 'Email' }]

/* Danh tính của mã đang chờ nhập (theo phản hồi otp/request): gửi lại / xác thực dùng đúng cái này */
const otpTarget = info => (info.email ? { email: info.email } : { phone: info.phone })

function Card({ title, text, children }) {
  return (
    <div className="ch-gate">
      <div className="ch-gate-card">
        <div className="ch-gate-title">{title}</div>
        {text && <div className="ch-gate-text">{text}</div>}
        {children}
      </div>
    </div>
  )
}

export default function ChatGate({ chat, mode, onCancel, onDone }) {
  const adding = mode === 'add'
  const [step, setStep] = useState('start') // start | otp | name
  const [method, setMethod] = useState('phone') // phone | email
  const [phoneInput, setPhoneInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [otpInfo, setOtpInfo] = useState(null) // {phone | email, expires_in, resend_after, dev_code?}
  const [otp, setOtp] = useState('')
  const [verified, setVerified] = useState(null) // kết quả otp/verify khi là tài khoản mới (+ uid)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [qr, setQr] = useState(false)
  const [forced, setForced] = useState(false)
  const otpRef = useRef(null)

  useEffect(() => {
    if (!adding && chat.auth === 'signedout' && takeForcedSignOutNotice()) setForced(true)
  }, [adding, chat.auth])

  /* Đếm ngược "Gửi lại mã sau N giây" */
  useEffect(() => {
    if (step !== 'otp' || resendAt <= Date.now()) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step, resendAt])

  useEffect(() => { if (step === 'otp' && otpRef.current) otpRef.current.focus() }, [step])

  if (!adding) {
    if (chat.auth === 'unconfigured') return <Card title="Dezon Chat" text="Chưa cấu hình địa chỉ máy chủ (VITE_API_URL) nên chưa dùng được Dezon Chat." />
    if (chat.auth === 'checking') return <Card title="Dezon Chat" text="Đang kiểm tra phiên chat…" />
    if (chat.auth === 'unreachable') {
      return (
        <Card title="Dezon Chat" text={chat.error || 'Không kết nối được máy chủ chat.'}>
          <button type="button" className="ch-gate-btn" onClick={retry}>Thử lại</button>
        </Card>
      )
    }
  }

  function finish(user) {
    signIn(user)
    if (onDone) onDone()
  }

  if (qr) return <QrLogin onCancel={() => setQr(false)} onDone={onDone} />

  /* resend: danh tính của mã đang chờ (Gửi lại mã); không có thì lấy từ ô nhập theo công tắc */
  async function requestOtp(e, resend) {
    if (e) e.preventDefault()
    if (busy) return
    let target = resend
    if (!target && method === 'email') {
      const email = normalizeEmail(emailInput)
      if (!email) { setErr('Email không hợp lệ'); return }
      target = { email }
    } else if (!target) {
      const phone = normalizePhone(phoneInput)
      if (!phone) { setErr('Số điện thoại không hợp lệ'); return }
      target = { phone }
    }
    setBusy(true); setErr('')
    try {
      const r = await api.otpRequest(target)
      setOtpInfo({ ...target, ...r })
      setOtp('')
      setResendAt(Date.now() + (Number(r.resend_after) || 60) * 1000)
      setNow(Date.now())
      setStep('otp')
    } catch (x) {
      setErr((x && x.message) || 'Không gửi được mã')
    }
    setBusy(false)
  }

  async function verify(code) {
    const c = String(code || otp).replace(/\D/g, '')
    if (busy || c.length !== 6) { if (c.length !== 6) setErr('Nhập đủ 6 số của mã xác thực'); return }
    setBusy(true); setErr('')
    try {
      const r = await api.otpVerify(otpTarget(otpInfo), c)
      const saved = api.saveSession(r, true)
      if (!saved.uid) throw new Error('Không lưu được phiên đăng nhập, thử lại')
      /* Tài khoản này đã đăng nhập trên trình duyệt (thiết bị cũ): kho giữ thiết bị mới, xoá thiết bị cũ trên máy chủ */
      if (saved.replaced) api.logoutTokens(saved.replaced)
      if (r.is_new) { setVerified({ ...r, uid: saved.uid }); setStep('name'); setBusy(false); return }
      finish(r.user)
    } catch (x) {
      setErr((x && x.message) || 'Xác thực thất bại')
      setBusy(false)
    }
  }

  async function saveName(e) {
    if (e) e.preventDefault()
    if (busy) return
    const n = name.trim()
    if (!n) { finish(verified.user); return }
    if (n.length > 100) { setErr('Tên tối đa 100 ký tự'); return }
    setBusy(true); setErr('')
    try {
      const me = await api.patchMe({ display_name: n }, verified.uid)
      finish(me)
    } catch (x) {
      setErr((x && x.message) || 'Không lưu được tên')
      setBusy(false)
    }
  }

  const errBox = err && <div role="alert" className="ch-gate-err">{err}</div>
  const back = adding && onCancel && (
    <button type="button" className="ch-gate-link ch-gate-back" disabled={busy} onClick={onCancel}>Quay lại</button>
  )

  if (step === 'otp' && otpInfo) {
    const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
    const byEmail = !!otpInfo.email
    const to = byEmail ? 'email ' + otpInfo.email : formatPhone(otpInfo.phone)
    return (
      <Card title="Nhập mã xác thực" text={`Mã 6 số đã gửi tới ${to}. Mã hết hạn sau ${Math.round((Number(otpInfo.expires_in) || 300) / 60)} phút.`}>
        <form className="ch-gate-form" onSubmit={e => { e.preventDefault(); verify() }}>
          {errBox}
          <input
            ref={otpRef}
            className="ch-gate-input ch-gate-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={otp}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6)
              setOtp(v)
              if (v.length === 6) verify(v)
            }}
          />
          {byEmail && <div className="ch-gate-muted ch-gate-note">Chưa thấy email? Kiểm tra thư mục Spam / Quảng cáo.</div>}
          {otpInfo.dev_code && (
            <div className="ch-gate-hint">
              Mã thử nghiệm (CHAT_OTP_DEV): <b>{otpInfo.dev_code}</b>{' '}
              <button type="button" className="ch-gate-link" onClick={() => { setOtp(otpInfo.dev_code); verify(otpInfo.dev_code) }}>Điền mã</button>
            </div>
          )}
          <button className="ch-gate-btn" disabled={busy || otp.length !== 6}>{busy ? 'Đang xác thực…' : 'Xác nhận'}</button>
          <div className="ch-gate-row">
            <button type="button" className="ch-gate-link" onClick={() => { setStep('start'); setErr('') }}>{byEmail ? 'Đổi email' : 'Đổi số điện thoại'}</button>
            {wait > 0
              ? <span className="ch-gate-muted">Gửi lại mã sau {wait} giây</span>
              : <button type="button" className="ch-gate-link" disabled={busy} onClick={() => requestOtp(null, otpTarget(otpInfo))}>Gửi lại mã</button>}
          </div>
          {back}
        </form>
      </Card>
    )
  }

  if (step === 'name' && verified) {
    return (
      <Card title="Chào mừng bạn đến Dezon Chat" text="Đặt tên hiển thị để bạn bè nhận ra bạn. Có thể đổi sau ở Danh bạ ▸ Thẻ của tôi.">
        <form className="ch-gate-form" onSubmit={saveName}>
          {errBox}
          <input className="ch-gate-input" autoFocus maxLength={100} placeholder={verified.user ? verified.user.display_name : 'Tên hiển thị'} value={name} onChange={e => setName(e.target.value)} />
          <button className="ch-gate-btn" disabled={busy}>{busy ? 'Đang lưu…' : 'Bắt đầu nhắn tin'}</button>
          <button type="button" className="ch-gate-link" disabled={busy} onClick={() => finish(verified.user)}>Bỏ qua, dùng tên mặc định</button>
        </form>
      </Card>
    )
  }

  /* Tab chưa có tài khoản nhưng trình duyệt đã đăng nhập tài khoản khác: chọn nhanh, không cần OTP lại */
  const saved = !adding ? chat.accounts || [] : []
  const byEmail = method === 'email'
  return (
    <Card
      title={adding ? 'Thêm tài khoản Dezon Chat' : 'Đăng nhập Dezon Chat'}
      text={adding
        ? 'Đăng nhập thêm một tài khoản bằng số điện thoại hoặc email. Tài khoản đang dùng vẫn đăng nhập; mỗi tab dùng một tài khoản.'
        : 'Dùng số điện thoại hoặc email để nhắn tin 1-1 và nhóm. Chưa có tài khoản thì hệ thống tạo mới.'}
    >
      <div className="ch-conv-tabs ch-gate-method" role="tablist" aria-label="Cách đăng nhập">
        {METHODS.map(m => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={method === m.key}
            className={method === m.key ? 'active' : undefined}
            disabled={busy}
            onClick={() => { setMethod(m.key); setErr('') }}
          >{m.label}</button>
        ))}
      </div>
      {forced && (
        <div role="status" className="ch-gate-hint">
          Thiết bị này đã bị đăng xuất (từ thiết bị khác hoặc phiên đã hết hạn). Mời đăng nhập lại.
        </div>
      )}
      <form className="ch-gate-form" onSubmit={requestOtp}>
        {errBox}
        {byEmail
          ? <input key="email" className="ch-gate-input" autoFocus type="email" inputMode="email" autoComplete="email" placeholder="Email, vd. ten@congty.vn" value={emailInput} onChange={e => setEmailInput(e.target.value)} />
          : <input key="phone" className="ch-gate-input" autoFocus type="tel" inputMode="tel" autoComplete="tel" placeholder="Số điện thoại, vd. 0901 234 567" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} />}
        <button className="ch-gate-btn" disabled={busy || !(byEmail ? emailInput : phoneInput).trim()}>
          {busy ? 'Đang gửi mã…' : byEmail ? 'Nhận mã qua email' : 'Nhận mã xác thực'}
        </button>
        <button type="button" className="ch-gate-link ch-gate-qr" disabled={busy} onClick={() => { setErr(''); setForced(false); setQr(true) }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>
          Đăng nhập bằng mã QR
        </button>
        {back}
      </form>
      {saved.length > 0 && (
        <div className="ch-gate-accounts">
          <div className="ch-gate-muted">Hoặc tiếp tục với tài khoản đã đăng nhập trên trình duyệt này:</div>
          {saved.map(a => {
            const u = a.user || {}
            return (
              <button key={a.id} type="button" className="ch-acct-row" onClick={() => switchAccount(a.id)}>
                <span className="ch-acct-av" style={{ background: colorFor(a.id) }}>{initials(u.display_name || '?')}</span>
                <span className="ch-acct-info"><b>{u.display_name || 'Tài khoản #' + a.id}</b><span>{contactText(u)}</span></span>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}
