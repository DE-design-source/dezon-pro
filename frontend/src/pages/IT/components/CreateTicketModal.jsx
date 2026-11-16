import { useEffect, useRef, useState } from 'react'
import { initials } from '../../../data/hrData'
import DatePicker from '../../../components/ui/DatePicker'
import { useWorkSession } from '../../../services/workSession'
import { PRIO_LABEL, TICKET_CATEGORIES } from '../../../data/itData'

const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
const PRIOS = ['urgent', 'high', 'medium', 'low']
const DEFAULT_ROLES = [
  { key: 'lead', label: 'Lãnh đạo phê duyệt', hint: 'Duyệt & theo dõi yêu cầu' },
  { key: 'coord', label: 'Điều phối', hint: 'Phân công, đôn đốc tiến độ' },
  { key: 'exec', label: 'Nhân sự thực thi', hint: 'Trực tiếp xử lý' },
]
const AV = ['#2E7DD6', '#0E9F9A', '#8B3FD9', '#D9822B', '#C2185B', '#1E8E5A']
const avatarColor = k => AV[[...String(k || '')].reduce((h, ch) => h + ch.charCodeAt(0), 0) % AV.length]
const deptLabel = e => e.department || (e.it ? 'IT' : 'Khác')
const roleLabel = e => (e.role === 'admin' ? 'Quản trị' : e.role === 'super' ? 'Quản trị hệ thống' : e.it ? 'Phòng IT' : 'Nhân viên')

const Avatar = ({ e, size = 22 }) => <span className="it-ct-avatar" style={{ background: avatarColor(e.username), width: size, height: size, fontSize: size * 0.38 }}>{initials(e.name)}</span>

/* Chọn nhiều người (tìm theo tên, tài khoản, phòng ban); value = mảng username */
function PeoplePick({ people, value, onChange, placeholder }) {
  const personOf = u => people.find(e => e.username === u)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const t = norm(q.trim())
  const list = people.filter(e => !value.includes(e.username) && (!t || norm(`${e.name} ${e.username} ${e.department || ''}`).includes(t))).slice(0, 8)
  const add = e => { if (!e) return; onChange([...value, e.username]); setQ(''); setHi(0) }
  return (
    <div className="it-ct-pick">
      {value.map(id => { const e = personOf(id); return e && (
        <span key={id} className="it-ct-chip"><Avatar e={e} size={18} />{e.name}<button type="button" onClick={() => onChange(value.filter(x => x !== id))} title="Bỏ">×</button></span>
      ) })}
      <span className="it-ct-pick-in">
        <input value={q} placeholder={value.length ? '+ Thêm…' : placeholder} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); add(list[hi]) }
            else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
          }} />
        {open && (
          <div className="it-ct-pick-list" onMouseDown={e => e.preventDefault()}>
            {list.length === 0 && <div className="it-ct-pick-empty">Không tìm thấy nhân sự</div>}
            {list.map((e, i) => (
              <button type="button" key={e.username} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onClick={() => add(e)}>
                <Avatar e={e} size={24} /><span><b>{e.name}</b><em>{roleLabel(e)} · {deptLabel(e)} · {e.username}</em></span>
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  )
}

/* Bảng nhập thông tin yêu cầu hỗ trợ IT */
/* staff: [{username, name, department, role, it}] từ listStaff() (trang IT tải sẵn).
   onCreate(data) trả Promise: xong thì trang đóng bảng; lỗi thì hiện thông báo trong bảng, giữ nguyên nội dung đã nhập.
   data = {issue, desc, images: [{name, url, file}], priority, category, deadline (yyyy-mm-dd | ''), requester, requesterUsername,
   roles: [{label, people: [tên], peopleUsers: [{name, username}]}]} */
export default function CreateTicketModal({ open, onClose, onCreate, staff = [] }) {
  const { me } = useWorkSession()
  const meUser = me?.username || ''
  // tài khoản đang đăng nhập luôn chọn được (kể cả khi chưa có trong danh sách, vd quản trị hệ thống)
  const people = meUser && !staff.some(e => e.username === meUser)
    ? [{ username: meUser, name: me?.hoTen || meUser, department: '', role: me?.role || '' }, ...staff]
    : staff
  const personOf = u => people.find(e => e.username === u)
  const blank = () => ({ title: '', desc: '', images: [], priority: 'medium', category: 'hardware', deadline: '', requester: meUser ? [meUser] : [], roles: DEFAULT_ROLES.map(r => ({ ...r, people: [] })) })
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [newRole, setNewRole] = useState(null) // tên vai trò đang thêm
  const fileRef = useRef(null)
  const set = patch => { setErr(''); setF(x => ({ ...x, ...patch })) }

  useEffect(() => { if (open) { setF(blank()); setErr(''); setNewRole(null); setBusy(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const addFiles = files => {
    const imgs = [...files].filter(x => x.type.startsWith('image/')).map(x => ({ name: x.name, url: URL.createObjectURL(x), size: x.size, file: x }))
    if (imgs.length) set({ images: [...f.images, ...imgs].slice(0, 8) })
  }
  const setRole = (i, patch) => set({ roles: f.roles.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  function submit() {
    if (busy) return
    if (!f.title.trim()) { setErr('Nhập tiêu đề yêu cầu'); return }
    const req = personOf(f.requester[0])
    if (!req) { setErr('Chọn người yêu cầu'); return }
    const roles = f.roles.filter(r => r.people.length).map(r => {
      const users = r.people.map(personOf).filter(Boolean).map(e => ({ name: e.name, username: e.username }))
      return { label: r.label, people: users.map(u => u.name), peopleUsers: users }
    })
    setBusy(true)
    Promise.resolve(onCreate({
      issue: f.title.trim(), desc: f.desc.trim(), images: f.images, priority: f.priority, category: f.category,
      deadline: f.deadline || '', requester: req.name, requesterUsername: req.username, roles,
    })).catch(e => setErr((e && e.message) || 'Không tạo được yêu cầu')).finally(() => setBusy(false))
  }

  return (
    <div className="it-ct-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="it-ct" role="dialog" aria-label="Tạo yêu cầu">
        <div className="it-ct-head">
          <div><h3>Tạo yêu cầu hỗ trợ</h3><span>Gửi tới phòng IT · người được giao sẽ nhận thông báo</span></div>
          <button className="it-ct-x" onClick={onClose} title="Đóng (Esc)">×</button>
        </div>

        <div className="it-ct-body">
          <label className="it-ct-field full">
            <span>Tiêu đề *</span>
            <input autoFocus value={f.title} placeholder="VD: Máy in phòng kế toán không in được" onChange={e => set({ title: e.target.value })} className={err && !f.title.trim() ? 'err' : ''} />
          </label>
          <label className="it-ct-field full">
            <span>Mô tả</span>
            <textarea rows={4} value={f.desc} placeholder="Mô tả chi tiết vấn đề, thời điểm xảy ra, thông báo lỗi…" onChange={e => set({ desc: e.target.value })} />
          </label>

          <div className="it-ct-field full">
            <span>Ảnh đính kèm</span>
            <div className="it-ct-drop" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
              <span>Kéo thả ảnh vào đây hoặc <b>chọn ảnh</b> · tối đa 8 ảnh</span>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
            {f.images.length > 0 && (
              <div className="it-ct-thumbs">
                {f.images.map((im, i) => (
                  <span key={im.url} className="it-ct-thumb" title={im.name}>
                    <img src={im.url} alt={im.name} />
                    <button type="button" onClick={() => set({ images: f.images.filter((_, j) => j !== i) })} title="Bỏ ảnh">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="it-ct-field">
            <span>Mức độ</span>
            <div className="it-ct-chips">
              {PRIOS.map(p => <button type="button" key={p} className={`it-ct-opt prio-${p}${f.priority === p ? ' active' : ''}`} onClick={() => set({ priority: p })}><i />{PRIO_LABEL[p]}</button>)}
            </div>
          </div>
          <div className="it-ct-field">
            <span>Hạng mục</span>
            <div className="it-ct-chips">
              {TICKET_CATEGORIES.map(([k, l]) => <button type="button" key={k} className={`it-ct-opt${f.category === k ? ' active' : ''}`} onClick={() => set({ category: k })}>{l}</button>)}
            </div>
          </div>

          <div className="it-ct-field">
            <span>Deadline dự kiến</span>
            <DatePicker value={f.deadline} onChange={v => set({ deadline: v || '' })} clearable ariaLabel="Deadline dự kiến" className="it-ct-date" />
          </div>
          <div className="it-ct-field">
            <span>Người yêu cầu</span>
            <PeoplePick people={people} value={f.requester} onChange={v => set({ requester: v.slice(-1) })} placeholder="Chọn người yêu cầu" />
          </div>

          <div className="it-ct-field full">
            <span>Nhân sự liên quan</span>
            <div className="it-ct-roles">
              {f.roles.map((r, i) => (
                <div key={r.key} className="it-ct-role">
                  <div className="it-ct-role-name">
                    <b>{r.label}</b>{r.hint && <em>{r.hint}</em>}
                    {r.custom && <button type="button" className="it-ct-role-del" onClick={() => set({ roles: f.roles.filter((_, j) => j !== i) })} title="Bỏ vai trò">×</button>}
                  </div>
                  <PeoplePick people={people} value={r.people} onChange={v => setRole(i, { people: v })} placeholder="Tìm nhân sự…" />
                </div>
              ))}
              {newRole === null
                ? <button type="button" className="it-ct-addrole" onClick={() => setNewRole('')}>+ Thêm vai trò</button>
                : (
                  <div className="it-ct-newrole">
                    <input autoFocus value={newRole} placeholder="VD: Người theo dõi, Nhà cung cấp…" onChange={e => setNewRole(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && newRole.trim()) { set({ roles: [...f.roles, { key: 'c' + Date.now(), label: newRole.trim(), custom: true, people: [] }] }); setNewRole(null) } if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setNewRole(null) } }} />
                    <button type="button" disabled={!newRole.trim()} onClick={() => { set({ roles: [...f.roles, { key: 'c' + Date.now(), label: newRole.trim(), custom: true, people: [] }] }); setNewRole(null) }}>Thêm</button>
                    <button type="button" className="ghost" onClick={() => setNewRole(null)}>Hủy</button>
                  </div>
                )}
            </div>
          </div>
        </div>

        <div className="it-ct-foot">
          {err && <span className="it-ct-err">{err}</span>}
          <span style={{ flex: 1 }} />
          <button className="it-ct-btn ghost" onClick={onClose}>Hủy</button>
          <button className="it-ct-btn primary" onClick={submit} disabled={busy}>{busy ? 'Đang gửi…' : 'Tạo yêu cầu'}</button>
        </div>
      </div>
    </div>
  )
}
