import { useEffect, useRef, useState } from 'react'
import { useWorkSession } from '../../services/workSession'
import logo from '../../assets/logo/dezon-pro-logo-white.svg'
import './AppGate.css'

/* Màn đăng nhập DUY NHẤT của ứng dụng (tài khoản Dezon Pro): dùng cho mọi trang, QS và Chat.
   Tài khoản do quản trị viên công ty tạo; trang nào hiện ra tuỳ quyền được cấp. */
export default function LoginPage() {
  const { login, error } = useWorkSession()
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error || '')
  const userRef = useRef(null)
  const pwRef = useRef(null)

  useEffect(() => { setErr(error || '') }, [error])
  useEffect(() => { const t = setTimeout(() => userRef.current && userRef.current.focus(), 60); return () => clearTimeout(t) }, [])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!user.trim() || !pw) { setErr('Nhập tên đăng nhập và mật khẩu'); return }
    setBusy(true); setErr('')
    try {
      await login(user, pw)
    } catch (x) {
      setErr((x && x.message) || 'Đăng nhập thất bại')
      setBusy(false)
    }
  }

  return (
    <div className="dz-gate">
      <form className="dz-login-card" onSubmit={submit}>
        <div className="dz-login-brand">
          <img src={logo} alt="Dezon Pro" />
          <div className="dz-login-tag">Một tài khoản cho mọi phần mềm của Dezon</div>
        </div>
        <div className="dz-login-body">
          <div className="dz-login-h">Đăng nhập</div>
          <div className="dz-login-sub">Dùng tài khoản Dezon Pro do quản trị viên cấp</div>
          {err ? <div className="dz-login-msg" role="alert">{err}</div> : null}
          <div className="dz-login-field">
            <svg className="dz-login-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <input ref={userRef} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Tên đăng nhập"
              value={user} onChange={e => setUser(e.target.value)} />
          </div>
          <div className="dz-login-field">
            <svg className="dz-login-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            <input ref={pwRef} name="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Mật khẩu"
              value={pw} onChange={e => setPw(e.target.value)} />
            <button type="button" className={'dz-login-eye' + (show ? ' on' : '')} title="Hiện/ẩn mật khẩu" aria-label="Hiện/ẩn mật khẩu"
              onClick={() => { setShow(s => !s); if (pwRef.current) pwRef.current.focus() }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          </div>
          <button type="submit" className="dz-login-btn" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          <div className="dz-login-foot">© Dezon Pro</div>
        </div>
      </form>
    </div>
  )
}
