import { useEffect, useState } from 'react'
import { INITIAL_HR_EMPLOYEES } from '../../../data/hrData'
import { lmInitials } from '../utils'

/* Phiếu yêu cầu nhân sự kinh doanh phụ trách: hiện khi kéo thẻ vào giai đoạn "Nhân sự KD phụ trách" (giao-ns).
   Chọn / gõ nhân sự (gợi ý nhân sự 2 phòng kinh doanh theo HR) + vai trò + ghi chú; "Giao & chuyển" = thêm người vào phu_trach
   rồi chuyển thẻ sang giao-ns. Huỷ = thẻ giữ nguyên giai đoạn cũ. Thẻ đã có nhân sự (khác Admin KD) thì chuyển được ngay.
   Ghi chú yêu cầu (máy chủ không lưu thêm trường trong phu_trach) ghi thành 1 dòng Lịch sử chăm sóc loại Ghi chú.
   Props: open, lead, onClose(), onConfirm(assignees mới, ghi chú) */
const ADMIN_KD = 'Admin Kinh doanh'
const KD_STAFF = INITIAL_HR_EMPLOYEES.filter(e => (e.dept === 'kddd' || e.dept === 'kdda') && e.status !== 'left')

export default function StaffRequestModal({ open, lead, onClose, onConfirm }) {
  const has = ((lead && lead.assignees) || []).filter(a => a && a.role !== ADMIN_KD)
  const [picked, setPicked] = useState([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('Nhân sự kinh doanh')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!open) return undefined
    const k = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open || !lead) return null
  const add = () => {
    const n = name.trim(); if (!n) return
    if (![...has, ...picked].some(a => a.name === n)) setPicked(l => [...l, { name: n, role: role.trim() }])
    setName('')
  }
  const pending = name.trim() && ![...has, ...picked].some(a => a.name === name.trim()) ? [{ name: name.trim(), role: role.trim() }] : []
  const all = [...picked, ...pending]
  const canGo = has.length + all.length > 0
  const go = () => {
    if (!canGo) return
    onConfirm(all, note.trim())
  }
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
              <div className="kd-srq-chips">{has.map((a, i) => <span key={i}><i>{lmInitials(a.name)}</i>{a.name}{a.role ? <em> · {a.role}</em> : null}</span>)}</div>
            </div>
          )}
          <div className="kd-srq-sec">
            <label>Giao nhân sự kinh doanh {has.length ? '(thêm)' : '*'}</label>
            <div className="kd-srq-row">
              <input list="kd-srq-staff" value={name} placeholder="Gõ tên nhân sự kinh doanh…" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} autoFocus />
              <input value={role} placeholder="Vai trò" onChange={e => setRole(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
              <button type="button" onClick={add}>Thêm</button>
            </div>
            <datalist id="kd-srq-staff">{KD_STAFF.map(e => <option key={e.id} value={e.name}>{e.position}</option>)}</datalist>
            {picked.length > 0 && (
              <div className="kd-srq-chips">
                {picked.map((a, i) => (
                  <span key={i} className="new"><i>{lmInitials(a.name)}</i>{a.name}{a.role ? <em> · {a.role}</em> : null}
                    <button type="button" onClick={() => setPicked(l => l.filter((_, j) => j !== i))} aria-label="Bỏ">×</button></span>
                ))}
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
