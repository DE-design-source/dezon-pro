import { useRef, useState } from 'react'
import * as L from '../state/chatLogic'
import { updateGroupInfo, uploadGroupAvatar } from '../state/chatStore'
import { IconSvg, colorFor, errText } from './shared'
import './GroupAdmin.css'

const MAX_DESCRIPTION = L.MAX_DESCRIPTION

/* Ảnh nhóm (thumb nếu có), lỗi tải / chưa có ảnh -> icon nhóm trên nền màu */
export function GroupAvatarImg({ conv, className = 'ch-ga-avatar-sm' }) {
  const [broken, setBroken] = useState('')
  const a = conv.avatar
  const src = a ? (a.thumb_url || a.url) : ''
  const show = src && broken !== src
  return (
    <div className={className + (show ? ' ch-ga-has-img' : '')} style={{ background: colorFor(conv.id) }}>
      {show ? <img src={src} alt="" onError={() => setBroken(src)} /> : <IconSvg kind="group" />}
    </div>
  )
}

/* Sửa tên / mô tả / ảnh nhóm (PATCH /conversations/:id). Chỉ hiện khi được phép đổi thông tin nhóm (canEdit). */
export default function GroupInfoEditor({ conv, canEdit }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  if (!canEdit) return null

  async function act(key, fn, after) {
    if (busy) return
    setBusy(key); setErr('')
    try { await fn(); if (after) after() } catch (e) { setErr(errText(e)) }
    setBusy('')
  }

  async function onPickAvatar(e) {
    const f = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (!String(f.type).startsWith('image/')) { setErr('Ảnh nhóm phải là tệp ảnh'); return }
    act('avatar', () => uploadGroupAvatar(conv.id, f))
  }

  function submit(e) {
    e.preventDefault()
    const name = form.name.trim()
    const desc = form.description.trim()
    if (!name || name.length > L.MAX_GROUP_NAME) { setErr('Tên nhóm từ 1 đến 100 ký tự'); return }
    if (L.runeLength(desc) > MAX_DESCRIPTION) { setErr('Mô tả nhóm tối đa 500 ký tự'); return }
    const patch = {}
    if (name !== (conv.name || '')) patch.name = name
    if (desc !== (conv.description || '')) patch.description = desc || null
    if (!Object.keys(patch).length) { setForm(null); setErr(''); return }
    act('info', () => updateGroupInfo(conv.id, patch), () => setForm(null))
  }

  const descLen = form ? L.runeLength(form.description.trim()) : 0
  return (
    <div className="ch-info-section">
      <div className="ch-sec-title">Thông tin nhóm</div>
      {err && <div className="ch-info-err" role="alert" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="ch-ga-avatar-row" style={{ marginBottom: 10 }}>
        <GroupAvatarImg conv={conv} />
        <div className="ch-ga-avatar-btns">
          <button type="button" className="ch-ga-link-btn" disabled={!!busy} onClick={() => fileRef.current && fileRef.current.click()}>
            {busy === 'avatar' ? 'Đang tải ảnh…' : conv.avatar ? 'Đổi ảnh nhóm' : 'Đặt ảnh nhóm'}
          </button>
          {conv.avatar && (
            <button type="button" className="ch-ga-link-btn danger" disabled={!!busy}
              onClick={() => { if (window.confirm('Xoá ảnh đại diện nhóm?')) act('rmavatar', () => updateGroupInfo(conv.id, { avatar_media_id: null })) }}>
              Xoá ảnh nhóm
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
      </div>
      {form === null ? (
        <button type="button" className="ch-info-btn" disabled={!!busy}
          onClick={() => { setErr(''); setForm({ name: conv.name || '', description: conv.description || '' }) }}>
          Sửa tên và mô tả
        </button>
      ) : (
        <form className="ch-ga-form" onSubmit={submit}>
          <label htmlFor={'ga-name-' + conv.id}>Tên nhóm</label>
          <input id={'ga-name-' + conv.id} type="text" autoFocus maxLength={L.MAX_GROUP_NAME} value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <label htmlFor={'ga-desc-' + conv.id}>Mô tả</label>
          <textarea id={'ga-desc-' + conv.id} rows={4} value={form.description} placeholder="Giới thiệu ngắn về nhóm"
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className={'ch-ga-counter' + (descLen > MAX_DESCRIPTION ? ' over' : '')}>{descLen}/{MAX_DESCRIPTION}</div>
          <div className="ch-pjm-actions">
            <button type="button" className="ch-pjm-btn" onClick={() => { setForm(null); setErr('') }}>Huỷ</button>
            <button className="ch-pjm-btn primary" disabled={!!busy || descLen > MAX_DESCRIPTION}>{busy === 'info' ? 'Đang lưu…' : 'Lưu'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
