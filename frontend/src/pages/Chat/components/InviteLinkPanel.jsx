import { useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { createInviteLink, getInviteLink, revokeInviteLink } from '../state/chatStore'
import { errText } from './shared'
import './GroupAdmin.css'

const EXPIRY_OPTIONS = [
  { label: 'Không hết hạn', value: '' },
  { label: '1 giờ', value: 3600 },
  { label: '1 ngày', value: 86400 },
  { label: '7 ngày', value: 7 * 86400 },
  { label: '30 ngày', value: 30 * 86400 },
]

function fmtTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch { /* thử cách cũ */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'; ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

/* Link mời vào nhóm: xem link hiện hành (mọi thành viên), tạo / tạo lại (canCreate), thu hồi (owner / admin hoặc người tạo).
   Link lấy từ store (chat.inviteLinks[cid], chưa tải = undefined); store gắn token của link tạo ở máy này
   (localStorage chat_invite:<uid>:<cid>). Không còn token thì chỉ còn nút "Tạo link mới" (thu hồi link cũ). */
export default function InviteLinkPanel({ chat, conv, me, myRole }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null)
  const [copied, setCopied] = useState(false)
  const cid = conv.id
  const canCreate = L.canDo(myRole, conv.settings, 'create_invite')
  const stored = chat.inviteLinks ? chat.inviteLinks[cid] : undefined
  const loaded = stored !== undefined
  const link = stored || null

  useEffect(() => {
    setErr('')
    getInviteLink(cid).catch(e => setErr(errText(e)))
  }, [cid])

  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  async function act(key, fn) {
    if (busy) return
    setBusy(key); setErr('')
    try { await fn() } catch (e) { setErr(errText(e)) }
    setBusy('')
  }

  function create() {
    const body = { requires_approval: !!form.requires_approval }
    if (form.expires_in) body.expires_in = Number(form.expires_in)
    act('create', async () => { await createInviteLink(cid, body); setForm(null) })
  }

  function revoke() {
    if (!window.confirm('Thu hồi link mời? Người cầm link cũ sẽ không vào nhóm được nữa.')) return
    act('revoke', () => revokeInviteLink(cid))
  }

  const url = link && link.token ? L.inviteUrl(window.location.origin, link) : ''
  const canRevoke = L.canRevokeInvite(myRole, link, me.id)
  /* tạo lại = thu hồi link hiện hành: member chỉ khi link đó do mình tạo (máy chủ trả 403 nếu không) */
  const canRegen = canCreate && (!link || canRevoke)
  if (!link && !canCreate && !err) return null

  const createForm = form && (
    <div className="ch-ga-confirm">
      <div className="ch-ga-form">
        <label htmlFor={'ga-exp-' + cid}>Thời hạn</label>
        <select id={'ga-exp-' + cid} className="ch-ga-select" value={form.expires_in} onChange={e => setForm({ ...form, expires_in: e.target.value })}>
          {EXPIRY_OPTIONS.map(o => <option key={o.label} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <label className="ch-ga-toggle">
        <input type="checkbox" checked={form.requires_approval} onChange={e => setForm({ ...form, requires_approval: e.target.checked })} />
        <span className="ch-ga-switch" aria-hidden="true" />
        <span>Cần trưởng / phó nhóm duyệt khi vào</span>
      </label>
      {link && <div className="ch-ga-warn">Link hiện tại sẽ bị thu hồi.</div>}
      <div className="ch-pjm-actions">
        <button type="button" className="ch-pjm-btn" onClick={() => setForm(null)}>Huỷ</button>
        <button type="button" className="ch-pjm-btn primary" disabled={!!busy} onClick={create}>{busy === 'create' ? 'Đang tạo…' : 'Tạo link'}</button>
      </div>
    </div>
  )
  const openForm = () => { setErr(''); setForm({ expires_in: '', requires_approval: !!(link && link.requires_approval) }) }

  return (
    <div className="ch-info-section">
      <div className="ch-sec-title">Link mời vào nhóm</div>
      {err && <div className="ch-info-err" role="alert" style={{ marginBottom: 8 }}>{err}</div>}
      {!loaded ? (
        <div className="ch-info-note">Đang tải…</div>
      ) : !link ? (
        <>
          <div className="ch-info-note">Nhóm chưa có link mời.</div>
          {canCreate && (form ? createForm : <button type="button" className="ch-info-btn" onClick={openForm}>Tạo link mời</button>)}
        </>
      ) : (
        <>
          {url ? (
            <div className="ch-ga-link-box">
              <div className="ch-ga-link-url" title={url}>{url}</div>
              <button type="button" className="ch-ga-copy" onClick={async () => {
                if (await copyText(url)) setCopied(true)
                else setErr('Không sao chép được, hãy chọn và sao chép thủ công')
              }}>{copied ? 'Đã chép' : 'Sao chép'}</button>
            </div>
          ) : (
            <div className="ch-info-note">Nhóm đang có link mời{link.created_by === me.id ? '' : ' do ' + (link.created_by_name || 'thành viên khác') + ' tạo'}. Link chỉ hiện ở máy đã tạo{canRegen ? '; cần chia sẻ thì tạo link mới' : ''}.</div>
          )}
          <div className="ch-ga-meta">
            {link.requires_approval ? 'Cần duyệt khi vào' : 'Vào ngay, không cần duyệt'}
            {' · '}
            {link.expired
              ? <span className="expired">Đã hết hạn</span>
              : link.expires_at ? 'Hết hạn ' + fmtTime(link.expires_at) : 'Không hết hạn'}
            <br />
            {L.isGroupAdmin(myRole) ? 'Đã dùng ' + (link.use_count || 0) + ' lần' : ''}
            {link.created_by_name ? (L.isGroupAdmin(myRole) ? ' · ' : '') + 'Tạo bởi ' + link.created_by_name : ''}
          </div>
          {form ? <div style={{ marginTop: 8 }}>{createForm}</div> : (
            <div className="ch-info-actions" style={{ marginTop: 8 }}>
              {canRegen && <button type="button" className="ch-info-btn" disabled={!!busy} onClick={openForm}>Tạo link mới</button>}
              {canRevoke && <button type="button" className="ch-info-btn danger" disabled={!!busy} onClick={revoke}>Thu hồi link</button>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
