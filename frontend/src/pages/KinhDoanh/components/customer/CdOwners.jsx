import { useEffect, useRef, useState } from 'react'
import { lmInitials, noDau } from '../../utils'
import { listStaff } from '../../api'
import { useKdOptions, saveKdOptions } from '../ShortlistSelect'

/* Khối "Phụ trách" của trang khách hàng dạng dashboard: người phụ trách gom theo nhóm (assignees[].dept),
   người phụ trách chính (kinh doanh) tô nổi; nhóm có người luôn hiện đủ nhân viên; "+ Gán" chọn tài khoản công ty và lưu ngay,
   "×" cuối tên gỡ người khỏi nhóm (lưu ngay). Không còn Thu gọn / Mở rộng, nút Sửa, dòng Phòng / Quản lý / Khởi tạo.
   readOnly (N21: không có quyền Sửa): chỉ xem, ẩn "+ Gán" / "Đổi" (cả sửa / bỏ tên gợi ý kdOptions.ownerFree) và "×". */
export const OWNER_GROUPS = [
  { key: 'kinhdoanh', label: 'Kinh doanh', color: '#D9661F', empty: 'Chưa có nhân sự kinh doanh' },
  { key: 'ctv', label: 'CTV Kinh doanh', color: '#1877F2', empty: 'Chưa có cộng tác viên' },
  { key: 'concept', label: 'Concept', color: '#E8A317', empty: 'Chưa có người làm concept' },
  { key: 'thietke', label: 'Thiết kế', color: '#5B4BD6', empty: 'Chưa có kiến trúc sư / thiết kế' },
  { key: 'nhathau', label: 'Nhà thầu', color: '#1F8A5B', empty: 'Gán sau khi chốt hợp đồng TK' },
]
const KEYS = OWNER_GROUPS.map(g => g.key)

/* Nhóm của 1 người phụ trách: trường dept (máy chủ); chưa có thì đoán theo chức danh; không rõ -> kinh doanh */
export function deptOf(a) {
  const d = a && a.dept
  if (d && KEYS.indexOf(d) >= 0) return d
  const r = noDau(a && a.role)
  if (/\bctv\b|cong tac vien/.test(r)) return 'ctv'
  if (r.indexOf('concept') >= 0) return 'concept'
  if (/thiet ke|kts|kien truc|noi that/.test(r)) return 'thietke'
  if (/thi cong|nha thau|doi tac/.test(r)) return 'nhathau'
  return 'kinhdoanh'
}

/* 'yyyy-mm-dd' -> 'dd/mm/yy' */
export const fmtSince = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) : '' }

/* "Admin Kinh doanh" lưu chung mảng assignees với vai trò này (LeadModal); không tính là người phụ trách chính */
export const ADMIN_KD = 'Admin Kinh doanh'
const isAdminKd = a => !!a && a.role === ADMIN_KD

/* Người phụ trách chính (chip ở header, tô nổi ở khối Phụ trách): người đầu tiên nhóm kinh doanh (trừ Admin KD), không có thì quản lý */
export function leadOwner(l) {
  const list = (l && l.assignees) || []
  const i = list.findIndex(a => a && a.name && !isAdminKd(a) && deptOf(a) === 'kinhdoanh')
  if (i >= 0) return { idx: i, name: list[i].name, role: list[i].role || 'Phụ trách', since: list[i].since || '' }
  if (l && l.manager) return { idx: -1, name: l.manager, role: 'Quản lý', since: '' }
  return null
}


/* "+ Gán": chọn tài khoản đang hoạt động của công ty (GET /sales/staff), lưu thẳng vào assignees của khách (không mở form sửa);
   gõ tên không khớp tài khoản nào -> "+ Thêm" lưu người đó không có username (nhân sự chưa có tài khoản) */
const ROLE_OF = { kinhdoanh: 'Nhân sự kinh doanh', ctv: 'CTV kinh doanh', concept: 'Concept', thietke: 'Thiết kế', nhathau: 'Nhà thầu' }
let staffP = null
const loadStaff = () => {
  if (!staffP) staffP = listStaff().then(l => l || [], e => { staffP = null; throw e })
  return staffP
}
function AssignBtn({ g, lead, onPatch, onEdit }) {
  const [open, setOpen] = useState(false)
  const [staff, setStaff] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null)   // sửa tên tự gõ: { from, val, err }
  const editRef = useRef(null)
  editRef.current = edit
  const ref = useRef(null)
  /* Tên tự gõ (nhân sự chưa có tài khoản) đã từng thêm: lưu chung công ty kdOptions.ownerFree để lần sau chọn lại trong danh sách */
  const freeNames = useKdOptions('ownerFree')
  useEffect(() => {
    if (!open) return undefined
    let off = false
    setErr('')
    setStaff(null)
    setEdit(null)
    staffP = null   // mỗi lần mở nạp lại: họ tên tài khoản có thể vừa đổi ở Cài đặt > Tài khoản
    loadStaff().then(s => { if (!off) setStaff(s) }, e => { if (!off) setErr((e && e.message) || 'Không tải được danh sách nhân sự') })
    const out = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (editRef.current) setEdit(null); else setOpen(false) } }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc, true)
    return () => { off = true; document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true) }
  }, [open])
  if (!onPatch) return onEdit ? <button type="button" className="cd-btn sm" onClick={onEdit} title={'Gán người nhóm ' + g.label}>+ Gán</button> : null
  const isMgr = g.key === 'quanly'
  const mine = isMgr ? (lead.manager ? [{ name: lead.manager }] : []) : (lead.assignees || []).filter(a => a && a.name && !isAdminKd(a) && deptOf(a) === g.key)
  // so tên bỏ dấu + gộp khoảng trắng: gõ "nguyen van an" coi như trùng "Nguyễn Văn An"
  const nk = s => noDau(s).replace(/\s+/g, ' ')
  const have = new Set(mine.map(a => nk(a.name)))
  const haveU = new Set(mine.map(a => String(a.username || '').trim().toLowerCase()).filter(Boolean))
  const qq = noDau(q)
  const accNames = new Set((staff || []).filter(s => s && s.name).map(s => nk(s.name)))
  // tên tự gõ đã lưu (bỏ tên đã trùng một tài khoản) -> hiện trong danh sách như nhân sự, đánh dấu chưa có tài khoản
  const frees = [...new Set((freeNames || []).map(n => String(n || '').trim().replace(/s+/g, ' ')).filter(Boolean))]
    .filter(n => !accNames.has(nk(n))).map(n => ({ name: n, free: true }))
  const list = [...(staff || []).filter(s => s && s.name), ...frees]
    .filter(s => !have.has(nk(s.name)) && !haveU.has(String(s.username || '').trim().toLowerCase()))
    .filter(s => !qq || noDau(s.name + ' ' + (s.username || '') + ' ' + (s.department || '')).indexOf(qq) >= 0)
    .sort((a, b) => (a.free ? 1 : 0) - (b.free ? 1 : 0) || (b.sales ? 1 : 0) - (a.sales ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'vi'))
  const rememberFree = name => {
    const n = String(name || '').trim().replace(/s+/g, ' ')
    if (!n || accNames.has(nk(n)) || (freeNames || []).some(x => nk(x) === nk(n))) return
    saveKdOptions('ownerFree', [...(freeNames || []), n])
  }
  const forgetFree = name => saveKdOptions('ownerFree', (freeNames || []).filter(x => nk(x) !== nk(name)))
  /* Sửa tên tự gõ trong danh sách gợi ý (chỉ đổi gợi ý; khách đã gán tên cũ giữ nguyên) */
  const saveEdit = () => {
    if (!edit) return
    const n = String(edit.val || '').trim().replace(/s+/g, ' ')
    if (!n) { setEdit({ ...edit, err: 'Tên không được để trống' }); return }
    if (n === edit.from) { setEdit(null); return }
    if (accNames.has(nk(n))) { setEdit({ ...edit, err: 'Trùng tên một tài khoản' }); return }
    if (nk(n) !== nk(edit.from) && (freeNames || []).some(x => nk(x) === nk(n))) { setEdit({ ...edit, err: 'Tên này đã có trong danh sách' }); return }
    saveKdOptions('ownerFree', (freeNames || []).map(x => (nk(x) === nk(edit.from) ? n : x)))
    setEdit(null)
  }
  /* Gõ tên tự do (nhân sự chưa có tài khoản): chữ gõ không trùng chính xác tên tài khoản đang hiện -> dòng "+ Thêm" (lưu không có username) */
  const typed = q.trim().replace(/\s+/g, ' ')
  const tl = nk(typed)
  const dupFree = !!tl && have.has(tl)
  const exact = tl ? list.find(s => nk(s.name) === tl) : null
  const canFree = !!tl && (!!staff || !!err) && !dupFree && !exact
  /* Enter chọn: tên trùng khớp -> tài khoản đó; còn tài khoản gợi ý -> dòng đầu; không còn -> "+ Thêm" (dòng được chọn có đánh dấu) */
  const enterPick = exact || ((staff || err) && list.length ? list[0] : null)
  const enterFree = !enterPick && canFree
  const pick = s => {
    if (busy) return
    if (have.has(nk(s.name))) return
    setBusy(true)
    const u = String(s.username || '').trim()
    if (!u) rememberFree(s.name)   // người chưa có tài khoản: nhớ tên cho lần gán sau
    if (isMgr) {
      Promise.resolve(onPatch({ manager: String(s.name).trim() })).then(saved => { setBusy(false); if (saved) { setOpen(false); setQ('') } }, () => setBusy(false))
      return
    }
    const next = [...(lead.assignees || []), { name: String(s.name).trim(), role: ROLE_OF[g.key] || 'Phụ trách', dept: g.key, ...(u ? { username: u } : null) }]
    Promise.resolve(onPatch({ assignees: next })).then(saved => { setBusy(false); if (saved) { setOpen(false); setQ('') } }, () => setBusy(false))
  }
  return (
    <span className="cd-asg" ref={ref} data-cd-busy={open ? '1' : undefined}>
      <button type="button" className="cd-btn sm" aria-expanded={open} onClick={() => setOpen(v => !v)} title={isMgr ? (mine.length ? 'Đổi người quản lý' : 'Chọn người quản lý') : 'Gán người nhóm ' + g.label}>{isMgr && mine.length ? 'Đổi' : '+ Gán'}</button>
      {open && (
        <div className="cd-asg-pop" aria-label={'Gán người nhóm ' + g.label}>
          <input className="cd-asg-q" autoFocus placeholder="Tìm hoặc gõ tên nhân sự..." value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (enterPick) pick(enterPick)
              else if (enterFree) pick({ name: typed })
            }} />
          <div className="cd-asg-list">
            {err ? <div className="cd-asg-empty">{err}</div> : null}
            {err && !list.length ? null
              : !staff && !err ? <div className="cd-asg-empty">Đang tải...</div>
              : !list.length ? (typed ? (canFree || dupFree ? null : <div className="cd-asg-empty">Không tìm thấy nhân sự</div>) : <div className="cd-asg-empty">Đã gán hết nhân sự</div>)
              : list.map(s => (
                <div key={(s.free ? 'free:' : '') + (s.username || s.name)} className={'cd-asg-row' + (s.free ? ' free' : '')}>
                  {edit && s.free && edit.from === s.name ? (
                    <div className="cd-asg-edit">
                      <input autoFocus value={edit.val} aria-label={'Sửa tên ' + s.name}
                        onChange={e => setEdit({ ...edit, val: e.target.value, err: '' })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit() } }} />
                      <button type="button" className="cd-asg-ok" title="Lưu tên" aria-label="Lưu tên" onClick={saveEdit}>✓</button>
                      <button type="button" className="cd-asg-forget" title="Huỷ sửa" aria-label="Huỷ sửa" onClick={() => setEdit(null)}>×</button>
                      {edit.err && <div className="cd-asg-edit-err">{edit.err}</div>}
                    </div>
                  ) : (<>
                  <button type="button" className={'cd-asg-it' + (s === enterPick ? ' is-enter' : '')} disabled={busy} onClick={() => pick(s)}>
                    <span className="cd-av">{lmInitials(s.name)}</span>
                    <span className="cd-mem-txt"><b>{s.name}</b><em>{s.free ? 'chưa có tài khoản' : [s.department, s.username].filter(Boolean).join(' · ')}</em></span>
                  </button>
                  {s.free && <button type="button" className="cd-asg-pen" title={'Sửa tên “' + s.name + '”'} aria-label={'Sửa tên ' + s.name} onClick={() => setEdit({ from: s.name, val: s.name, err: '' })}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>}
                  {s.free && <button type="button" className="cd-asg-forget" title={'Bỏ “' + s.name + '” khỏi danh sách gợi ý'} aria-label={'Bỏ ' + s.name + ' khỏi danh sách gợi ý'} onClick={() => forgetFree(s.name)}>×</button>}
                  </>)}
                </div>
              ))}
            {canFree && (
              <button type="button" className={'cd-asg-it cd-asg-free' + (enterFree ? ' is-enter' : '')} disabled={busy} onClick={() => pick({ name: typed })}
                title={'Lưu “' + typed + '” vào nhóm ' + g.label + ' (không gắn tài khoản)'}>
                <span className="cd-av">+</span>
                <span className="cd-mem-txt"><b>Thêm “{typed}”</b><em>chưa có tài khoản</em></span>
              </button>
            )}
            {dupFree && <div className="cd-asg-empty cd-asg-dup">“{typed}” đã có trong nhóm {g.label}</div>}
          </div>
        </div>
      )}
    </span>
  )
}



export default function CdOwners({ lead: l, onEdit: onEditIn, onPatch: onPatchIn, readOnly }) {
  const [busyIdx, setBusyIdx] = useState(-1)
  const onEdit = readOnly ? undefined : onEditIn
  const onPatch = readOnly ? undefined : onPatchIn
  if (!l) return null
  /* i = vị trí trong l.assignees gốc (khớp leadOwner().idx) */
  const members = (l.assignees || []).map((a, i) => ({ a, i })).filter(x => x.a && x.a.name && !isAdminKd(x.a))
  const main = leadOwner(l)
  const mainIdx = main ? main.idx : -1
  const groups = OWNER_GROUPS.map(g => ({ ...g, members: members.filter(x => deptOf(x.a) === g.key) }))
  const MGR = { key: 'quanly', label: 'Quản lý', color: '#1E3A8A' }
  const mgr = String(l.manager || '').trim()
  const [mgrBusy, setMgrBusy] = [busyIdx === -2, v => setBusyIdx(v ? -2 : -1)]
  const clearMgr = () => {
    if (!onPatch || busyIdx !== -1) return
    setMgrBusy(true)
    Promise.resolve(onPatch({ manager: '' })).then(() => setMgrBusy(false), () => setMgrBusy(false))
  }
  const remove = i => {
    if (!onPatch || busyIdx >= 0) return
    setBusyIdx(i)
    Promise.resolve(onPatch({ assignees: (l.assignees || []).filter((_, j) => j !== i) })).then(() => setBusyIdx(-1), () => setBusyIdx(-1))
  }
  return (
    <section className="cd-card cd-owners">
      <div className="cd-card-h">
        <span className="cd-card-t">Phụ trách</span>
      </div>
      <div className="cd-owners-list">
        {/* Quản lý (lead.manager) đứng đầu khối Phụ trách */}
        {mgr ? (
          <div className="cd-grp">
            <div className="cd-grp-h cd-grp-hd">
              <span className="cd-grp-dot" style={{ background: MGR.color }} /><span className="cd-grp-l">{MGR.label}</span>
              <AssignBtn g={MGR} lead={l} onPatch={onPatch} onEdit={onEdit} />
            </div>
            <div className="cd-mem">
              <span className="cd-av">{lmInitials(mgr)}</span>
              <span className="cd-mem-txt"><b>{mgr}</b></span>
              {onPatch && (
                <button type="button" className="cd-mem-x" disabled={busyIdx !== -1 || mgrBusy} onClick={clearMgr}
                  title={'Bỏ ' + mgr + ' khỏi vị trí Quản lý'} aria-label={'Bỏ ' + mgr + ' khỏi vị trí Quản lý'}>×</button>
              )}
            </div>
          </div>
        ) : (
          <div className="cd-grp cd-grp-mini">
            <span className="cd-grp-dot" style={{ background: MGR.color }} />
            <span className="cd-grp-mini-l">{MGR.label}</span>
            <span className="cd-grp-mini-v">Chưa có</span>
            <AssignBtn g={MGR} lead={l} onPatch={onPatch} onEdit={onEdit} />
          </div>
        )}
        {groups.map(g => !g.members.length ? (
          /* nhóm chưa có người: 1 dòng (tên nhóm · Chưa phân công · + Gán) */
          <div key={g.key} className="cd-grp cd-grp-mini">
            <span className="cd-grp-dot" style={{ background: g.color }} />
            <span className="cd-grp-mini-l">{g.label}</span>
            <span className="cd-grp-mini-v">Chưa phân công</span>
            <AssignBtn g={g} lead={l} onPatch={onPatch} onEdit={onEdit} />
          </div>
        ) : (
          <div key={g.key} className="cd-grp">
            <div className="cd-grp-h cd-grp-hd">
              <span className="cd-grp-dot" style={{ background: g.color }} /><span className="cd-grp-l">{g.label}</span>
              <span className="cd-grp-n">{g.members.length}</span>
              <AssignBtn g={g} lead={l} onPatch={onPatch} onEdit={onEdit} />
            </div>
            {g.members.map(({ a, i }) => (
              <div key={i} className={'cd-mem' + (i === mainIdx ? ' lead' : '')}>
                <span className="cd-av">{lmInitials(a.name)}</span>
                <span className="cd-mem-txt"><b>{a.name}</b>{!String(a.username || '').trim() && <em className="cd-mem-noacc" title="Người này chưa gắn tài khoản trong hệ thống">chưa có tài khoản</em>}</span>
                {onPatch && (
                  <button type="button" className="cd-mem-x" disabled={busyIdx >= 0} onClick={() => remove(i)}
                    title={'Gỡ ' + a.name + ' khỏi nhóm ' + g.label} aria-label={'Gỡ ' + a.name + ' khỏi nhóm ' + g.label}>×</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
