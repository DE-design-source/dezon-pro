import { createContext, useContext, useEffect, useState } from 'react'
import { PROJ_DEPTS, AUTO_INCLUDE_DEPTS, avatarColor, initials } from '../../../data/quanLyThietKeData'
import { ORG_CHILDREN_STORAGE_KEY, ORG_PARALLEL_STORAGE_KEY, readStoredArray } from './storage'
import { useDelivery } from '../delivery'

/* Bộ phận tuỳ biến đã lưu trong sơ đồ tổ chức → bổ sung vào danh sách phòng ban của popover nhân sự */
function loadExtraDepts() {
  const known = new Set(PROJ_DEPTS.map(d => d.value))
  return [...readStoredArray(ORG_PARALLEL_STORAGE_KEY, []), ...readStoredArray(ORG_CHILDREN_STORAGE_KEY, [])]
    .filter(x => x && typeof x.dept === 'string' && typeof x.label === 'string' && !known.has(x.dept))
    .map(x => ({ value: x.dept, label: x.label }))
}

/* Nhân sự tham gia dự án — dùng chung cho danh sách dự án, header "Sơ đồ tổ chức"
   và các node phòng ban. Lưu trên máy chủ theo dự án (khoá `project` = id dự án). Chỉ một popover được mở tại một thời điểm. */
const MembersContext = createContext(null)

export function MembersProvider({ children }) {
  const dv = useDelivery()
  const [extraDepts, setExtraDepts] = useState(loadExtraDepts)
  const [openPop, setOpenPop] = useState(null) // { project, anchor }

  useEffect(() => {
    if (!openPop) return
    const close = () => setOpenPop(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openPop])

  function membersOf(project) {
    if (!project) return []
    if (dv.detail && String(dv.detail.project.id) === String(project)) return dv.detail.members
    return (dv.projects.find(p => String(p.id) === String(project)) || {}).members || []
  }
  const depts = [...PROJ_DEPTS, ...extraDepts]
  const deptLabel = Object.fromEntries(depts.map(d => [d.value, d.label]))

  const value = {
    depts,
    deptLabel,
    membersOf,
    nameOf: project => (dv.projects.find(p => String(p.id) === String(project)) || {}).name || '',
    addMember: (project, member) => dv.addMember(project, member),
    removeMember: (project, idx) => { const m = membersOf(project)[idx]; if (m) dv.removeMember(project, m.id) },
    addDept: dept => setExtraDepts(prev => [...prev, dept]),
    openPop,
    togglePop: (project, anchor) =>
      setOpenPop(prev => (prev && prev.project === project && prev.anchor === anchor) ? null : { project, anchor }),
    closePop: () => setOpenPop(null),
  }
  return <MembersContext.Provider value={value}>{children}</MembersContext.Provider>
}

export function useMembers() {
  return useContext(MembersContext)
}

const PlusIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg>
)

function AvatarStack({ members, max }) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="tk-pjm-stack">
      {shown.map((m, i) => (
        <span key={i} className="tk-pjm-avatar" style={{ background: avatarColor(m.name) }} title={`${m.name} — ${m.role}`}>{initials(m.name)}</span>
      ))}
      {extra > 0 && <span className="tk-pjm-more" title={`${extra} người khác`}>+{extra}</span>}
    </div>
  )
}

export function ProjectMemberPopover({ project, presetDept }) {
  const { depts, deptLabel, membersOf, nameOf, addMember, removeMember, closePop } = useMembers()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [dept, setDept] = useState(presetDept || depts[0].value)
  const members = membersOf(project)

  function handleAdd(e) {
    const trimmed = name.trim()
    if (!trimmed) { e.currentTarget.closest('.tk-pjm-popover').querySelector('input').focus(); return }
    addMember(project, { name: trimmed, role: role.trim() || 'Thành viên', dept })
    setName(''); setRole(''); setDept(presetDept || depts[0].value)
  }

  return (
    <div className="tk-pjm-popover" draggable="false" onClick={e => e.stopPropagation()}>
      <div className="tk-pjm-title">Nhân sự tham gia — {nameOf(project)}</div>
      <div className="tk-pjm-list">
        {members.length ? members.map((m, i) => (
          <span key={i} className="tk-pjm-chip">
            <span className="tk-pjm-avatar" style={{ background: avatarColor(m.name), marginRight: 0 }}>{initials(m.name)}</span>
            {m.name} <span style={{ opacity: 0.7 }}>· {deptLabel[m.dept] || 'Ban chỉ huy công trường'}</span>
            <span style={{ cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 2 }} onClick={() => removeMember(project, i)}>✕</span>
          </span>
        )) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Chưa có nhân sự</span>}
      </div>
      <input type="text" placeholder="Họ tên" value={name} onChange={e => setName(e.target.value)} />
      <input type="text" placeholder="Vai trò (VD: Kỹ sư, Đội thi công...)" value={role} onChange={e => setRole(e.target.value)} />
      <select value={dept} onChange={e => setDept(e.target.value)}>
        {depts.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <div className="tk-pjm-actions">
        <button className="tk-pjm-btn" onClick={closePop}>Đóng</button>
        <button className="tk-pjm-btn primary" onClick={handleAdd}>Thêm nhân sự</button>
      </div>
    </div>
  )
}

/* Ô "Nhân sự" trong danh sách dự án & header chi tiết dự án */
export function MemberCell({ project }) {
  const { membersOf, openPop, togglePop } = useMembers()
  const isOpen = openPop && openPop.project === project && openPop.anchor === 'header'
  return (
    <div className="tk-member-cell">
      <AvatarStack members={membersOf(project)} max={3} />
      <button
        className="tk-pjm-add-btn"
        title="Thêm nhân sự"
        onClick={e => { e.stopPropagation(); togglePop(project, 'header') }}
      >
        <PlusIcon size={10} />
      </button>
      {isOpen && <ProjectMemberPopover project={project} presetDept={null} />}
    </div>
  )
}

/* Avatar nhân sự theo phòng ban trên sơ đồ — popover được render riêng ở cuối node */
export function FlowNodeMembers({ project, dept, style }) {
  const { membersOf, deptLabel, togglePop } = useMembers()
  const all = membersOf(project)
  const members = AUTO_INCLUDE_DEPTS.includes(dept) ? all : all.filter(m => m.dept === dept)
  return (
    <div className="tk-flow-node-members" draggable="false" style={style}>
      <AvatarStack members={members} max={4} />
      <button
        className="tk-pjm-add-btn"
        title={`Thêm nhân sự vào ${deptLabel[dept] || dept}`}
        onClick={e => { e.stopPropagation(); togglePop(project, dept) }}
      >
        <PlusIcon size={9} />
      </button>
    </div>
  )
}

export function FlowNodePopover({ project, dept }) {
  const { openPop } = useMembers()
  if (!(openPop && openPop.project === project && openPop.anchor === dept)) return null
  return <ProjectMemberPopover project={project} presetDept={AUTO_INCLUDE_DEPTS.includes(dept) ? null : dept} />
}
