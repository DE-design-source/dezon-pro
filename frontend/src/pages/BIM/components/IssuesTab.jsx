import { useMemo, useState } from 'react'
import { INITIAL_ISSUES, ISSUE_COLS, PRIO_LABEL, ISSUE_ASSIGNEES, nameInitials } from '../../../data/bimData'
import { Icon, SectionHead, SearchInput } from './shared'
import { useAccess } from '../../../services/accessService'

const META_ICONS = {
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  comment: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
}

function IssueCard({ iss }) {
  return (
    <div className="bim-issue-card">
      <div className="code">{iss.code}</div>
      <div className="title">{iss.title}</div>
      <div className="loc"><Icon html={META_ICONS.pin} size={11} />{iss.loc}</div>
      <div className="bim-issue-thumb" />
      <div className="bim-issue-foot">
        <span className={`bim-priority-pill bim-priority-${iss.prio}`}>{PRIO_LABEL[iss.prio]}</span>
        <span className="bim-issue-meta"><Icon html={META_ICONS.calendar} size={11} />{iss.due}</span>
      </div>
      <div className="bim-issue-foot">
        <span className="bim-issue-avatar">{nameInitials(iss.assignee)}</span>
        <span className="bim-issue-meta" style={{ gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Icon html={META_ICONS.comment} size={11} />{iss.comments}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Icon html={META_ICONS.clip} size={11} />{iss.attach}</span>
        </span>
      </div>
    </div>
  )
}

/* Modal luôn được mount (ẩn bằng display) để giữ nội dung đang nhập khi Huỷ, giống bản HTML */
function CreateIssueModal({ open, onClose, onSubmit }) {
  const [title, setTitle] = useState('')
  const [loc, setLoc] = useState('')
  const [prio, setPrio] = useState('trung')
  const [assignee, setAssignee] = useState(ISSUE_ASSIGNEES[0])

  function submit() {
    if (!title.trim()) { alert('Vui lòng nhập tiêu đề Issue.'); return }
    onSubmit({ title: title.trim(), loc: loc.trim() || '—', prio, assignee })
    setTitle('')
    setLoc('')
  }

  return (
    <div className="bim-modal-overlay" style={{ display: open ? 'flex' : 'none' }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bim-modal" style={{ width: 420 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Tạo Issue mới</h3>
        <div className="bim-field" style={{ marginBottom: 14 }}>
          <label>Tiêu đề *</label>
          <input type="text" placeholder="VD: Xung đột cao độ cửa và trần thạch cao" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="bim-field" style={{ marginBottom: 14 }}>
          <label>Vị trí</label>
          <input type="text" placeholder="VD: Tầng 01 · Phòng khách" value={loc} onChange={e => setLoc(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div className="bim-field"><label>Mức ưu tiên</label>
            <select value={prio} onChange={e => setPrio(e.target.value)}>
              <option value="cao">Cao</option><option value="trung">Trung bình</option><option value="thap">Thấp</option>
            </select>
          </div>
          <div className="bim-field"><label>Người phụ trách</label>
            <select value={assignee} onChange={e => setAssignee(e.target.value)}>
              {ISSUE_ASSIGNEES.map(a => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="bim-btn-ghost" onClick={onClose}>Hủy</button>
          <button className="bim-btn-dark" onClick={submit}>Tạo Issue</button>
        </div>
      </div>
    </div>
  )
}

export default function IssuesTab() {
  const { can } = useAccess()
  const [issues, setIssues] = useState(INITIAL_ISSUES)
  const [seq, setSeq] = useState(42)
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return issues.filter(i => !q || i.code.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))
  }, [issues, query])

  function createIssue(data) {
    const next = seq + 1
    setSeq(next)
    setIssues(prev => [{ code: 'ISS-' + String(next).padStart(3, '0'), col: 'moi', due: '—', comments: 0, attach: 0, ...data }, ...prev])
    setModalOpen(false)
  }

  return (
    <>
      <SectionHead eyebrow="Phối hợp BCF" title="Issues của dự án" desc="Theo dõi vấn đề theo model, vị trí, người phụ trách và lịch sử trao đổi.">
        <div style={{ display: 'flex', gap: 8 }}>
          {can('bim', 'main', 'export') && <button className="bim-btn-ghost"><Icon html={'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'} />Xuất BCF</button>}
          {can('bim', 'main', 'create') && <button className="bim-btn-dark" onClick={() => setModalOpen(true)}><Icon name="plus" stroke="#fff" sw={2.6} />Tạo Issue</button>}
        </div>
      </SectionHead>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm tiêu đề hoặc mã Issue..." style={{ flex: 1, minWidth: 220 }} />
        <button className="bim-btn-ghost" style={{ padding: '9px 14px' }}><Icon html={'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'} size={13} />Người phụ trách</button>
        <button className="bim-btn-ghost" style={{ padding: '9px 14px' }}><Icon name="alert" size={13} />Mức ưu tiên</button>
      </div>
      <div className="bim-issue-board">
        {ISSUE_COLS.map(col => {
          const items = filtered.filter(i => i.col === col.key)
          return (
            <div key={col.key} className="bim-issue-col">
              <div className="bim-issue-col-head">
                <span className="bim-issue-dot" style={{ background: `var(--${col.color})` }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{col.label}</span>
                <span className="bim-issue-count">{items.length}</span>
              </div>
              {items.map(iss => <IssueCard key={iss.code} iss={iss} />)}
            </div>
          )
        })}
      </div>
      <CreateIssueModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={createIssue} />
    </>
  )
}
