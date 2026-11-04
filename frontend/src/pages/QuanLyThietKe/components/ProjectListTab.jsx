import { useMemo, useState } from 'react'
import { MemberCell } from './ProjectMembers'
import { useDelivery, projectRows, sumBudget } from '../delivery'

/* Dự án của trang + dự án tự tạo khi khách hàng ở Kinh doanh sang tu-van / dam-phan / thiet-ke (máy chủ, DeliveryProvider) */
export default function ProjectListTab({ onGoto }) {
  const dv = useDelivery()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState('default')

  const allRows = useMemo(() => projectRows(dv.projects), [dv.projects])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = allRows.filter(r =>
      (!q || `${r.name} ${r.client}`.toLowerCase().includes(q)) &&
      (!status || r.status === status) &&
      (!type || r.type === type)
    )
    if (sort === 'progress-desc') rows.sort((a, b) => b.progress - a.progress)
    else if (sort === 'progress-asc') rows.sort((a, b) => a.progress - b.progress)
    else if (sort === 'name-asc') rows.sort((a, b) => `${a.name} ${a.client}`.localeCompare(`${b.name} ${b.client}`))
    return rows
  }, [allRows, query, status, type, sort])

  function clearFilters() {
    setQuery(''); setStatus(''); setType(''); setSort('default')
  }

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
            <option value="Đang thi công">Đang thi công</option>
            <option value="Thiết kế">Thiết kế</option>
            <option value="Bản nháp">Bản nháp</option>
            <option value="Hoàn tất">Hoàn tất</option>
          </select>
          <select className="tk-list-select" value={type} onChange={e => setType(e.target.value)}>
            <option value="">Tất cả loại hình</option>
            <option value="Chung cư">Chung cư</option>
            <option value="Nhà phố">Nhà phố</option>
            <option value="Biệt thự">Biệt thự</option>
            <option value="Văn phòng">Văn phòng</option>
          </select>
          <select className="tk-list-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="default">Sắp xếp mặc định</option>
            <option value="progress-desc">Tiến độ cao → thấp</option>
            <option value="progress-asc">Tiến độ thấp → cao</option>
            <option value="name-asc">Tên A → Z</option>
          </select>
          <button className="tk-clear-btn" onClick={clearFilters}>Xoá lọc</button>
        </div>
      </div>
      {visibleRows.length === 0 && <div className="tk-list-empty">Không tìm thấy dự án phù hợp với bộ lọc.</div>}

      <div className="tk-kpi-grid">
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Tổng dự án</div>
          <div className="tk-kpi-value">{allRows.length}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Đang thi công</div>
          <div className="tk-kpi-value" style={{ color: 'var(--primary)' }}>{allRows.filter(r => r.status === 'Đang thi công').length}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Bản nháp</div>
          <div className="tk-kpi-value" style={{ color: 'var(--text-muted)' }}>{allRows.filter(r => r.status === 'Bản nháp').length}</div>
        </div>
        <div className="tk-card tk-list-kpi">
          <div className="tk-kpi-label">Tổng ngân sách quản lý</div>
          <div className="tk-kpi-value mono tk-display" style={{ color: 'var(--gold, var(--finance))' }}>{sumBudget(dv.projects)}</div>
        </div>
      </div>

      <div className="tk-card tk-list-card">
        <div className="tk-proj-grid tk-proj-head">
          <span>Dự án</span><span>Khách hàng</span><span>Loại hình</span><span>Ngân sách</span><span>Tiến độ</span><span>Nhân sự</span><span>Trạng thái</span>
        </div>

        {visibleRows.map(r => (
          <div
            key={r.id}
            className="tk-proj-grid tk-proj-row"
            style={r.synced ? { borderTop: '1px solid var(--border)' } : (r.borderBottom ? { borderBottom: '1px solid var(--border)' } : undefined)}
            onClick={() => { dv.select(r.id); onGoto(r.goto) }}
          >
            <span className="tk-proj-name" style={r.synced ? { display: 'flex', alignItems: 'center', gap: 7 } : undefined}>
              {r.name}
              {r.synced && <span className="tk-sync-badge">Từ Kinh doanh</span>}
            </span>
            <span className="tk-proj-cell" style={{ color: 'var(--text-muted)' }}>{r.client}</span>
            <span className="tk-proj-cell">{r.typeLabel || r.type}</span>
            <span className="tk-proj-cell mono" style={r.budgetMuted ? { color: 'var(--text-muted)' } : undefined}>{r.budget}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="tk-mini-track">
                {r.progress > 0 && <div style={{ width: `${r.progress}%`, background: r.barColor }} />}
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.progress}%</span>
            </div>
            <MemberCell project={r.id} />
            <span className="tk-pill" style={{ background: r.statusBg, color: r.statusColor, justifySelf: 'start' }}>{r.status}</span>
          </div>
        ))}
      </div>
    </>
  )
}
