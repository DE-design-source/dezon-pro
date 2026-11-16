import { useEffect, useState } from 'react'
import { listStaff } from '../api'
import { lmInitials } from '../utils'

/* Phiếu yêu cầu nhân sự kinh doanh phụ trách: hiện khi kéo thẻ vào giai đoạn "Nhân sự KD phụ trách" (giao-ns).
   Chọn nhân sự từ TÀI KHOẢN của công ty (GET /sales/staff; người vào được Kinh doanh xếp trước) + vai trò + ghi chú;
   người được giao lưu kèm username. Không tải được danh sách tài khoản thì cho gõ tên tự do như trước.
   "Giao & chuyển" = thêm người vào phu_trach rồi chuyển thẻ sang giao-ns. Huỷ = thẻ giữ nguyên giai đoạn cũ.
   Thẻ đã có nhân sự (khác Admin KD) thì chuyển được ngay. Bấm × ở "Đang phụ trách" để gỡ người (lưu khi bấm Giao & chuyển;
   Hoàn tác / Huỷ = không gỡ); phải còn ít nhất 1 người.
   Ghi chú yêu cầu (máy chủ không lưu thêm trường trong phu_trach) ghi thành 1 dòng Lịch sử chăm sóc loại Ghi chú.
   Props: open, lead, onClose(), onConfirm(người mới giao, ghi chú, {list: danh sách người phụ trách cuối, removed: người bị gỡ}) */
const ADMIN_KD = 'Admin Kinh doanh'

// Danh sách tài khoản dùng chung giữa các lần mở phiếu (null = chưa tải / tải lỗi)
let staffCache = null

export default function StaffRequestModal({ open, lead, onClose, onConfirm }) {
  const has = ((lead && lead.assignees) || []).filter(a => a && a.role !== ADMIN_KD)
  const [gone, setGone] = useState([])   // chỉ số trong has của người đang phụ trách bị gỡ (Huỷ = không gỡ ai)
  const [picked, setPicked] = useState([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('Nhân sự kinh doanh')
  const [note, setNote] = useState('')
  const [staff, setStaff] = useState(staffCache)
  const [loadErr, setLoadErr] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return undefined
    const k = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
  useEffect(() => {
    if (!open) return undefined
    let off = false
    listStaff().then(s => { staffCache = s; if (!off) { setStaff(s); setLoadErr(false) } }, () => { if (!off) setLoadErr(true) })
    return () => { off = true }
  }, [open])
  if (!open || !lead) return null

  const list = staff || []
  const dupName = n => list.filter(s => s.name === n).length > 1
  // Giá trị trong ô gợi ý: họ tên; trùng họ tên thì kèm @username cho phân biệt
  const optVal = s => (dupName(s.name) ? `${s.name} (@${s.username})` : s.name)
  const lc = v => String(v || '').trim().toLowerCase()
  const resolve = v => {
    const t = lc(v).replace(/^@/, '')
    return list.find(s => lc(optVal(s)) === t || lc(s.username) === t || (!dupName(s.name) && lc(s.name) === t)) || null
  }
  const strict = !!staff && !loadErr
  const keep = has.filter((_, i) => gone.indexOf(i) < 0)
  const removed = has.filter((_, i) => gone.indexOf(i) >= 0)
  const taken = a => [...keep, ...picked].some(x => (a.username && x.username === a.username) || (!a.username && x.name === a.name))
  // ô đang gõ -> người được giao ({name, role, username}); null = chưa gõ / không khớp tài khoản
  const toAssignee = v => {
    const n = v.trim(); if (!n) return null
    const s = resolve(n)
    if (s) return { name: s.name, role: role.trim(), username: s.username }
    return strict ? null : { name: n, role: role.trim() }
  }
  const add = () => {
    if (!name.trim()) return
    const a = toAssignee(name)
    if (!a) { setErr(`Không có tài khoản "${name.trim()}" trong công ty. Chọn trong danh sách gợi ý.`); return }
    if (!taken(a)) setPicked(l => [...l, a])
    setName(''); setErr('')
  }
  const cur = toAssignee(name)
  const pending = cur && !taken(cur) ? [cur] : []
  const all = [...picked, ...pending]
  const canGo = keep.length + all.length > 0
  const go = () => {
    if (!canGo) return
    // danh sách cuối = Admin KD giữ nguyên + người còn lại + người mới giao
    const admins = ((lead && lead.assignees) || []).filter(a => a && a.role === ADMIN_KD)
    onConfirm(all, note.trim(), { list: [...admins, ...keep, ...all], removed })
  }
  const chip = (a, i, extra, cls) => (
    <span key={i} className={cls}><i>{lmInitials(a.name)}</i>{a.name}
      {a.username ? <em> @{a.username}</em> : null}{a.role ? <em> · {a.role}</em> : null}{extra}</span>
  )
  const xBtn = (onClick, label) => <button type="button" onClick={onClick} aria-label={label} title={label}>×</button>
  return (
    <div className="kd-srq-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="kd-srq" role="dialog" aria-modal="true" aria-label="Phiếu yêu cầu nhân sự kinh doanh phụ trách">
        <div className="kd-srq-h">
          <div>
            <b>Phiếu yêu cầu nhân sự kinh doanh phụ trách</b>
            <span>{lead.name}{lead.type ? ' · ' + lead.type : ''}</span>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <div className="kd-srq-b">
          {has.length > 0 && (
            <div className="kd-srq-sec">
              <label>Đang phụ trách</label>
              <div className="kd-srq-chips">
                {has.map((a, i) => (gone.indexOf(i) >= 0 ? null : chip(a, i, xBtn(() => setGone(g => [...g, i]), 'Gỡ ' + a.name))))}
                {!keep.length && <span className="kd-srq-none">Không còn ai</span>}
              </div>
              {removed.length > 0 && (
                <div className="kd-srq-gone">
                  Sẽ gỡ: {removed.map(a => a.name).join(', ')}
                  <button type="button" onClick={() => setGone([])}>Hoàn tác</button>
                </div>
              )}
            </div>
          )}
          <div className="kd-srq-sec">
            <label>Giao nhân sự kinh doanh {keep.length ? '(thêm)' : '*'}</label>
            <div className="kd-srq-row">
              <input list="kd-srq-staff" value={name} placeholder={strict ? 'Gõ tên hoặc tên đăng nhập…' : 'Gõ tên nhân sự kinh doanh…'}
                onChange={e => { setName(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} autoFocus />
              <input value={role} placeholder="Vai trò" onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
              <button type="button" onClick={add}>Thêm</button>
            </div>
            <datalist id="kd-srq-staff">
              {list.map(s => (
                <option key={s.username} value={optVal(s)}>
                  {'@' + s.username + (s.department ? ' · ' + s.department : '') + (s.sales ? '' : ' · chưa có quyền Kinh doanh')}
                </option>
              ))}
            </datalist>
            {err && <div className="kd-srq-err">{err}</div>}
            {!err && loadErr && <div className="kd-srq-err">Không tải được danh sách tài khoản, đang cho gõ tên tự do.</div>}
            {picked.length > 0 && (
              <div className="kd-srq-chips">
                {picked.map((a, i) => chip(a, i, xBtn(() => setPicked(l => l.filter((_, j) => j !== i)), 'Bỏ'), 'new'))}
              </div>
            )}
          </div>
          <div className="kd-srq-sec">
            <label>Ghi chú yêu cầu</label>
            <textarea rows={3} value={note} placeholder="Nhu cầu khách, thời gian liên hệ, lưu ý cho nhân sự phụ trách…" onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        <div className="kd-srq-f">
          <span>{canGo ? 'Thẻ sẽ chuyển sang "Nhân sự KD phụ trách"' : 'Chọn ít nhất 1 nhân sự kinh doanh'}</span>
          <button type="button" onClick={onClose}>Huỷ</button>
          <button type="button" className="pri" disabled={!canGo} onClick={go}>Giao &amp; chuyển</button>
        </div>
      </div>
    </div>
  )
}
