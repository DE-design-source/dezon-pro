import { useMemo, useState } from 'react'
import { MemberCell } from './ProjectMembers'
import { useDelivery, STATUS_OPTIONS, STATUS_STYLE, fmtTy } from '../delivery'

/* Danh sách dự án của trang (thiết kế / thi công). Dự án tự xuất hiện khi khách hàng ở Kinh doanh được kéo sang
   cột "Dự án (Thiết kế)" / "Dự án (Thi công)"; cũng tạo tay được bằng nút "Dự án mới". */
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS)

export default function ProjectListTab({ onGoto }) {
  const dv = useDelivery()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState('default')

  const types = useMemo(() => [...new Set(dv.projects.map(p => p.projectType).filter(Boolean))], [dv.projects])
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = dv.projects.filter(r =>
      (!q || `${r.name} ${r.client}`.toLowerCase().includes(q)) &&
      (!status || r.status === status) &&
      (!type || r.projectType === type)
    )
    if (sort === 'progress-desc') rows.sort((a, b) => b.progress - a.progress)
    else if (sort === 'progress-asc') rows.sort((a, b) => a.progress - b.progress)
    else if (sort === 'name-asc') rows.sort((a, b) => `${a.name} ${a.client}`.localeCompare(`${b.name} ${b.client}`))
    return rows
  }, [dv.projects, query, status, type, sort])

  function clearFilters() {
    setQuery(''); setStatus(''); setType(''); setSort('default')
  }
  async function newProject() {
    const name = window.prompt('Tên dự án mới:')
    if (!name || !name.trim()) return
    const p = await dv.createProject({ name: name.trim() })
    if (p) onGoto('create')
  }
  function open(r) {
    dv.select(r.id)
    onGoto('create')
  }
  const count = st => dv.projects.filter(p => p.status === st).length

  return (
    <>
      <div className="tk-list-toolbar">
        <div className="tk-list-toolbar-left">
          <div className="tk-list-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="text" placeholder="Tìm dự án, khách hàng..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <select className="tk-list-select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="tk-list-select" value={type} onChange={e => setType(e.target.value)}>
            <option value="">Tất cả loại hình</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="tk-list-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="default">Sắp xếp mặc định</option>
            <option value="progress-desc">Tiến độ cao → thấp</option>
            <option value="progress-asc">Tiến độ thấp → cao</option>
            <option value="name-asc">Tên A → Z</option>
          </select>
          <button className="tk-clear-btn" onClick={clearFilters}>Xoá lọc</button>
        </div>
        <button className="tk-btn-project" style={{ padding: '8px 14px', fontWeight: 600 }} onClick={newProject}>+ Dự án mới</button>
      </div>
      {dv.listState === 'loading' && <div className="tk-list-empty">Đang tải dự án…</div>}
      {dv.listState !== 'loading' && dv.listState !== 'ok' && <div className="tk-list-empty">Lỗi tải dữ liệu: {dv.listState}</div>}
      {dv.listState === 'ok' && !dv.projects.length && <div className="tk-list-empty">Chưa có dự án. Kéo khách hàng ở Kinh doanh sang cột Dự án, hoặc bấm "+ Dự án mới".</div>}
      {dv.listState === 'ok' && dv.projects.length > 0 && visibleRows.length === 0 && <div className="tk-list-empty">Không tìm thấy dự án phù hợp với bộ lọc.</div>}

      <div className="tk-kpi-grid">
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Tổng dự án</div>
          <div className="tk-kpi-value">{dv.projects.length}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Đang thực hiện</div>
          <div className="tk-kpi-value" style={{ color: 'var(--primary)' }}>{count('dang-lam')}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Bản nháp</div>
          <div className="tk-kpi-value" style={{ color: 'var(--text-muted)' }}>{count('nhap')}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Tổng giá trị hợp đồng</div>
          <div className="tk-kpi-value mono tk-display" style={{ color: 'var(--gold, var(--finance))' }}>{fmtTy(dv.projects.reduce((s, p) => s + p.contractValueVnd, 0))}</div>
        </div>
      </div>

      <div className="tk-card tk-list-card">
        <div className="tk-proj-grid tk-proj-head">
          <span>Dự án</span><span>Khách hàng</span><span>Loại hình</span><span>Giá trị HĐ</span><span>Tiến độ</span><span>Nhân sự</span><span>Trạng thái</span>
        </div>

        {visibleRows.map((r, i) => {
          const [bg, color] = STATUS_STYLE[r.status] || STATUS_STYLE.nhap
          return (
            <div
              key={r.id}
              className="tk-proj-grid tk-proj-row"
              style={i < visibleRows.length - 1 ? { borderBottom: '1px solid var(--border)' } : undefined}
              onClick={() => open(r)}
            >
              <span className="tk-proj-name" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {r.name}
                {r.leadId && <span className="tk-sync-badge">Từ Kinh doanh</span>}
              </span>
              <span className="tk-proj-cell" style={{ color: 'var(--text-muted)' }}>{r.client || '—'}</span>
              <span className="tk-proj-cell">{r.projectType || '—'}</span>
              <span className="tk-proj-cell mono" style={r.contractValueVnd ? undefined : { color: 'var(--text-muted)' }}>{r.contractValueVnd ? fmtTy(r.contractValueVnd) : '—'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="tk-mini-track">
                  {r.progress > 0 && <div style={{ width: `${r.progress}%`, background: 'var(--primary)' }} />}
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.progress}%</span>
              </div>
              <MemberCell project={r.id} />
              <span className="tk-pill" style={{ background: bg, color, justifySelf: 'start' }}>{STATUS_LABEL[r.status] || r.status}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
