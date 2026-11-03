/* Trang tham gia nhóm qua link mời (/chat/join/:token, API.md "Quản trị nhóm" - đường dẫn tham gia): xem trước nhóm
   bằng tài khoản đang chọn của tab rồi Tham gia / Gửi yêu cầu. Trạng thái: đang tải, xem trước (none / member / pending),
   đã gửi yêu cầu, link sai / đã thu hồi, hết hạn, nhóm đủ người, nhóm đã giải tán, bị chặn, lỗi khác (thử lại). */
import { useEffect, useState } from 'react'
import './JoinGroup.css'
import { invitePreview, joinByInvite } from '../state/chatStore'
import * as L from '../state/chatLogic'
import { colorFor, initials } from './shared'

const ERR = {
  INVITE_INVALID: { kind: 'invalid', title: 'Link mời không hợp lệ', text: 'Link mời không tồn tại hoặc đã bị thu hồi.' },
  INVITE_EXPIRED: { kind: 'expired', title: 'Link mời đã hết hạn', text: 'Hãy xin người trong nhóm gửi link mới.' },
  GROUP_FULL: { kind: 'full', title: 'Nhóm đã đủ thành viên', text: 'Nhóm đã đủ 1000 thành viên.' },
  GROUP_DISBANDED: { kind: 'disbanded', title: 'Nhóm đã bị giải tán', text: 'Nhóm này không còn hoạt động.' },
  BLOCKED: { kind: 'blocked', title: 'Không thể tham gia', text: 'Bạn không thể tham gia nhóm này.' },
}

function errState(e) {
  const code = (e && e.code) || ''
  const known = ERR[code]
  if (known) return { ...known, text: (e && e.message) || known.text }
  return { kind: 'other', title: 'Không mở được link mời', text: (e && e.message) || 'Có lỗi, thử lại sau', retry: true }
}

function expiryText(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return 'Link hết hạn lúc ' + new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function JoinGroup({ chat, token, onOpen, onClose }) {
  const meId = chat && chat.me ? chat.me.id : null
  const [phase, setPhase] = useState('loading') // loading | preview | error
  const [preview, setPreview] = useState(null)
  const [err, setErr] = useState(null) // lỗi chặn cả trang (link sai / hết hạn...)
  const [joinErr, setJoinErr] = useState(null) // lỗi khi bấm tham gia (giữ phần xem trước)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false) // vừa gửi yêu cầu tham gia
  const [reload, setReload] = useState(0)

  /* Đổi token / tài khoản của tab: xem trước lại (membership theo tài khoản) */
  useEffect(() => {
    let live = true
    setPreview(null); setErr(null); setJoinErr(null); setSent(false); setBusy(false)
    if (!L.INVITE_TOKEN_RE.test(String(token || ''))) { setErr(errState({ code: 'INVITE_INVALID' })); setPhase('error'); return undefined }
    setPhase('loading')
    invitePreview(token)
      .then(p => { if (live) { setPreview(p || null); setPhase(p ? 'preview' : 'error'); if (!p) setErr(errState(null)) } })
      .catch(e => { if (live && (!e || e.code !== 'ACCOUNT_CHANGED')) { setErr(errState(e)); setPhase('error') } })
    return () => { live = false }
  }, [token, meId, reload])

  async function join() {
    if (busy || !preview) return
    setBusy(true)
    setJoinErr(null)
    try {
      const r = await joinByInvite(token)
      const cid = r && Number(r.conversation_id)
      if (r && (r.status === 'joined' || r.status === 'already_member') && cid > 0) { onOpen(cid); return }
      if (r && r.status === 'pending') { setSent(true); setPreview(p => (p ? { ...p, membership: 'pending' } : p)) }
    } catch (e) {
      if (e && e.code === 'ACCOUNT_CHANGED') return
      const st = errState(e)
      /* link không còn dùng được: cả trang báo lỗi; còn lại (nhóm đủ, bị chặn, quá lượt...) báo dưới nút */
      if (st.kind === 'invalid' || st.kind === 'expired' || st.kind === 'disbanded') { setErr(st); setPhase('error') } else setJoinErr(st)
    } finally {
      setBusy(false)
    }
  }

  const account = chat && chat.me ? <div className="ch-join-account">Đang dùng tài khoản: {chat.me.display_name || 'Bạn'}</div> : null

  if (phase === 'loading') {
    return <div className="ch-join"><div className="ch-join-card"><div className="ch-join-note">Đang mở link mời…</div></div></div>
  }

  if (phase === 'error' || !preview) {
    const st = err || errState(null)
    return (
      <div className="ch-join">
        <div className="ch-join-card">
          <div className="ch-join-name">{st.title}</div>
          <div className="ch-join-note">{st.text}</div>
          <div className="ch-join-actions">
            {st.retry && <button type="button" className="ch-ct-btn solid" onClick={() => setReload(n => n + 1)}>Thử lại</button>}
            <button type="button" className="ch-ct-btn ghost" onClick={onClose}>Về trang tin nhắn</button>
          </div>
          {account}
        </div>
      </div>
    )
  }

  const g = preview.group || {}
  const av = g.avatar && (g.avatar.thumb_url || g.avatar.url)
  const membership = preview.membership || 'none'
  const cid = Number(preview.conversation_id)
  const exp = expiryText(preview.expires_at)

  let action
  if (membership === 'member' && cid > 0) {
    action = <button type="button" className="ch-ct-btn solid" onClick={() => onOpen(cid)}>Mở nhóm</button>
  } else if (membership === 'pending') {
    action = <button type="button" className="ch-ct-btn solid" disabled>Đang chờ duyệt</button>
  } else {
    action = (
      <button type="button" className="ch-ct-btn solid" disabled={busy} onClick={join}>
        {busy ? 'Đang gửi…' : preview.requires_approval ? 'Gửi yêu cầu tham gia' : 'Tham gia nhóm'}
      </button>
    )
  }

  return (
    <div className="ch-join">
      <div className="ch-join-card">
        <div className="ch-join-avatar" style={{ background: colorFor(String(g.name || '').length) }}>
          {av ? <img src={av} alt="" /> : initials(g.name)}
        </div>
        <div className="ch-join-name">{g.name || 'Nhóm chat'}</div>
        <div className="ch-join-meta">{(Number(g.member_count) || 0) + ' thành viên'}{preview.requires_approval ? ' · Cần duyệt để vào nhóm' : ''}</div>
        {g.description ? <div className="ch-join-desc">{g.description}</div> : null}
        {exp && <div className="ch-join-meta">{exp}</div>}
        {sent && <div className="ch-join-note">Đã gửi yêu cầu. Trưởng / phó nhóm duyệt xong bạn sẽ thấy nhóm trong danh sách.</div>}
        {!sent && membership === 'pending' && <div className="ch-join-note">Yêu cầu tham gia của bạn đang chờ trưởng / phó nhóm duyệt.</div>}
        {joinErr && <div className="ch-join-err">{joinErr.text}</div>}
        <div className="ch-join-actions">
          {action}
          <button type="button" className="ch-ct-btn ghost" onClick={onClose}>Đóng</button>
        </div>
        {account}
      </div>
    </div>
  )
}
