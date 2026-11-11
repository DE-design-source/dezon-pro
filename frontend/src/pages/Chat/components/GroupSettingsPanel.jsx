import { useState } from 'react'
import { disbandGroup, transferOwnership, updateGroupSettings } from '../state/chatStore'
import { errText } from './shared'
import './GroupAdmin.css'

const TOGGLES = [
  { key: 'admins_only_send', label: 'Chỉ trưởng / phó nhóm được gửi tin' },
  { key: 'admins_only_edit_info', label: 'Chỉ trưởng / phó nhóm được đổi tên, ảnh, mô tả' },
  { key: 'admins_only_add_members', label: 'Chỉ trưởng / phó nhóm được thêm thành viên và tạo link mời' },
]

/* Cài đặt quyền (owner / admin), chuyển trưởng nhóm và giải tán nhóm (chỉ owner).
   canSettings: được đổi cài đặt; isOwner: là trưởng nhóm. Không có quyền nào -> không hiện. */
export default function GroupSettingsPanel({ conv, members, me, canSettings, isOwner, onDisbanded }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [transfer, setTransfer] = useState(null)
  const [disbanding, setDisbanding] = useState(false)
  if (!canSettings && !isOwner) return null

  const settings = conv.settings || {}
  const candidates = (members || [])
    .filter(m => m.user_id !== me.id)
    .slice()
    .sort((a, b) => ((a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1)) || String(a.display_name).localeCompare(String(b.display_name), 'vi'))

  async function act(key, fn, after) {
    if (busy) return
    setBusy(key); setErr('')
    try { await fn(); if (after) after() } catch (e) { setErr({ at: key.startsWith('set-') ? 'settings' : 'owner', msg: errText(e) }) }
    setBusy('')
  }

  const target = transfer ? candidates.find(m => String(m.user_id) === String(transfer.userId)) : null

  return (
    <>
      {canSettings && (
        <div className="ch-info-section">
          <div className="ch-sec-title">Cài đặt nhóm</div>
          {err && err.at === 'settings' && <div className="ch-info-err" role="alert" style={{ marginBottom: 8 }}>{err.msg}</div>}
          {TOGGLES.map(t => {
            const on = !!settings[t.key]
            return (
              <label key={t.key} className={'ch-ga-toggle' + (busy ? ' disabled' : '')}>
                <input type="checkbox" checked={on} disabled={!!busy}
                  onChange={() => act('set-' + t.key, () => updateGroupSettings(conv.id, { [t.key]: !on }))} />
                <span className="ch-ga-switch" aria-hidden="true" />
                <span>{t.label}</span>
              </label>
            )
          })}
        </div>
      )}
      {isOwner && (
        <div className="ch-info-section">
          <div className="ch-sec-title">Quyền trưởng nhóm</div>
          {err && err.at === 'owner' && <div className="ch-info-err" role="alert" style={{ marginBottom: 8 }}>{err.msg}</div>}
          <div className="ch-info-actions">
            {transfer === null ? (
              <button type="button" className="ch-info-btn" disabled={!!busy || !candidates.length}
                onClick={() => { setErr(''); setDisbanding(false); setTransfer({ userId: '', confirm: false }) }}>
                Chuyển quyền trưởng nhóm
              </button>
            ) : (
              <div className="ch-ga-confirm">
                {!transfer.confirm ? (
                  <>
                    <select className="ch-ga-select" autoFocus value={transfer.userId} aria-label="Chọn trưởng nhóm mới"
                      onChange={e => setTransfer({ userId: e.target.value, confirm: false })}>
                      <option value="">Chọn thành viên…</option>
                      {candidates.map(m => (
                        <option key={m.user_id} value={m.user_id}>{m.display_name}{m.role === 'admin' ? ' (quản trị viên)' : ''}</option>
                      ))}
                    </select>
                    <div className="ch-pjm-actions">
                      <button type="button" className="ch-pjm-btn" onClick={() => setTransfer(null)}>Huỷ</button>
                      <button type="button" className="ch-pjm-btn primary" disabled={!target}
                        onClick={() => setTransfer({ ...transfer, confirm: true })}>Tiếp tục</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ch-ga-warn">
                      Chuyển quyền trưởng nhóm cho <b>{target ? target.display_name : ''}</b>? Bạn sẽ trở thành quản trị viên và không
                      tự lấy lại quyền trưởng nhóm được.
                    </div>
                    <div className="ch-pjm-actions">
                      <button type="button" className="ch-pjm-btn" onClick={() => setTransfer({ ...transfer, confirm: false })}>Quay lại</button>
                      <button type="button" className="ch-pjm-btn primary" disabled={!!busy || !target}
                        onClick={() => act('transfer', () => transferOwnership(conv.id, target.user_id), () => setTransfer(null))}>
                        {busy === 'transfer' ? 'Đang chuyển…' : 'Xác nhận'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {!candidates.length && transfer === null && <div className="ch-info-note">Nhóm chưa có thành viên khác để chuyển quyền.</div>}
            {!disbanding ? (
              <button type="button" className="ch-info-btn danger" disabled={!!busy}
                onClick={() => { setErr(''); setTransfer(null); setDisbanding(true) }}>
                Giải tán nhóm
              </button>
            ) : (
              <div className="ch-ga-confirm danger" role="alertdialog" aria-label="Xác nhận giải tán nhóm">
                <div className="ch-ga-warn">
                  <b>Giải tán nhóm “{conv.name}”?</b> Mọi thành viên sẽ bị đưa ra khỏi nhóm, không ai gửi tin được nữa, link mời bị thu hồi.
                  Tin nhắn cũ vẫn xem được (chỉ đọc). <b>Không thể hoàn tác.</b>
                </div>
                <div className="ch-pjm-actions">
                  <button type="button" className="ch-pjm-btn" onClick={() => setDisbanding(false)}>Huỷ</button>
                  <button type="button" className="ch-pjm-btn danger" disabled={!!busy}
                    onClick={() => act('disband', () => disbandGroup(conv.id), () => { setDisbanding(false); if (onDisbanded) onDisbanded() })}>
                    {busy === 'disband' ? 'Đang giải tán…' : 'Giải tán'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
