import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MISSIONS, MISSION_SOURCES, MISSION_POINTS, PRIO_LABEL, WEEK_ATTENDANCE } from '../../../data/banLamViecData'
import WidgetGrid from './WidgetGrid'
import Icon from '../../../components/ui/Icon'

/* Khung chung của một widget: icon + tiêu đề + phụ đề + hành động */
function Widget({ icon, tone = 'primary', title, sub, actions, children, bodyClass = '' }) {
  return (
    <div className={`blv-w tone-${tone}`}>
      <div className="blv-w-head">
        <span className="blv-ico"><Icon name={icon} size={15} /></span>
        <div className="blv-w-titles">
          <h3 className="blv-w-title">{title}</h3>
          {sub && <div className="blv-w-sub">{sub}</div>}
        </div>
        {actions && <div className="blv-w-actions">{actions}</div>}
      </div>
      <div className={`blv-w-body ${bodyClass}`}>{children}</div>
    </div>
  )
}

/* ---------- Bố cục mặc định (lưới 12 cột, mỗi hàng 44px) ---------- */
const LAYOUT_KEY = 'siteflow-blv-overview-layout-v2'
const ITEM_ORDER = ['kpi1', 'kpi2', 'kpi3', 'kpi4', 'missions', 'daily', 'stat', 'leave', 'info']
const ITEM_DEFS = {
  kpi1: { x: 0, y: 0, w: 3, h: 3 },
  kpi2: { x: 3, y: 0, w: 3, h: 3 },
  kpi3: { x: 6, y: 0, w: 3, h: 3 },
  kpi4: { x: 9, y: 0, w: 3, h: 3 },
  missions: { x: 0, y: 3, w: 7, h: 8 },
  daily: { x: 0, y: 11, w: 7, h: 9 },
  stat: { x: 7, y: 3, w: 5, h: 6 },
  leave: { x: 7, y: 9, w: 5, h: 5 },
  info: { x: 7, y: 14, w: 5, h: 6 },
}

const KPIS = {
  kpi1: { icon: 'briefcase', tone: 'primary', label: 'Nhiệm vụ đang làm', value: '7', foot: <span className="blv-chip warn"><Icon name="alert" size={11} stroke={2.4} />2 sắp đến hạn</span> },
  kpi2: { icon: 'checkCircle', tone: 'success', label: 'Hoàn thành tuần này', value: '12', foot: <><span className="blv-chip up"><Icon name="trendUp" size={11} stroke={2.4} />+3</span><span>so với tuần trước</span></> },
  kpi3: { icon: 'clock', tone: 'attendance', label: 'Ngày công tháng này', value: '18', of: '/20', bar: 90, foot: <span>1 lần đi trễ</span> },
  kpi4: { icon: 'sun', tone: 'finance', label: 'Ngày phép còn lại', value: '8', of: '/12', bar: 67, foot: <span>Đã dùng 4 ngày</span> },
}

const STATS = [
  { value: 18, label: 'Đủ giờ', tone: 'attendance' },
  { value: 1, label: 'Đi trễ', tone: 'finance' },
  { value: 0, label: 'Về sớm', tone: 'muted' },
  { value: 0, label: 'Nghỉ không phép', tone: 'danger' },
]
const ATT_LABEL = { ok: 'Đúng giờ', late: 'Đi trễ', today: 'Hôm nay', future: 'Chưa tới' }

const SHORTCUTS = [
  { icon: 'folder', tone: 'primary', label: 'Dự án đang tham gia', value: '4', to: '/du-an' },
  { icon: 'award', tone: 'success', label: 'Điểm KPI quý này', value: '92/100' },
  { icon: 'chat', tone: 'qs', label: 'Tin nhắn chưa đọc', value: '6', to: '/chat', badge: true },
  { icon: 'cart', tone: 'finance', label: 'Đơn mua hàng chờ duyệt', value: '2', to: '/mua-hang' },
]

const LEAVE = { total: 12, used: 4, pending: 0 }

const TASK_FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'todo', label: 'Cần làm' },
  { key: 'done', label: 'Đã xong' },
]

/* Tab "Tổng quan" — mỗi khung là một widget; bật "Tùy chỉnh bố cục" để kéo / đổi kích thước */
export default function OverviewTab({ tasks, onToggleTask, onAddTask, onRequestLeave, editing, resetSignal }) {
  const [taskFilter, setTaskFilter] = useState('all')

  const doneCount = tasks.filter(t => t.done).length
  const counts = { all: tasks.length, todo: tasks.length - doneCount, done: doneCount }
  const visibleTasks = tasks.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.done : !t.done))

  function renderItem(id) {
    if (KPIS[id]) {
      const k = KPIS[id]
      return (
        <div className={`blv-w blv-kpi tone-${k.tone}`}>
          <div className="blv-kpi-top">
            <span className="blv-ico"><Icon name={k.icon} size={15} /></span>
            <span className="blv-kpi-label">{k.label}</span>
          </div>
          <div className="blv-kpi-num">{k.value}{k.of && <span className="blv-kpi-of">{k.of}</span>}</div>
          {k.bar != null && <div className="blv-bar"><span style={{ width: k.bar + '%' }} /></div>}
          <div className="blv-kpi-foot">{k.foot}</div>
        </div>
      )
    }

    if (id === 'missions') {
      const pct = Math.round(MISSION_POINTS.current / MISSION_POINTS.target * 100)
      return (
        <Widget
          icon="target" tone="finance" title="Nhiệm vụ của tôi" sub="Hoàn thành để tích điểm đổi quà"
          actions={<Link to="/gantt#nhiemvu-mission" className="blv-link">Xem tất cả<Icon name="chevron" size={13} /></Link>}
        >
          <div className="blv-points">
            <div className="blv-points-main">
              <div className="blv-points-num">{MISSION_POINTS.current.toLocaleString('vi-VN')}<span> / {MISSION_POINTS.target.toLocaleString('vi-VN')} điểm</span></div>
              <div className="blv-bar tone-finance"><span style={{ width: pct + '%' }} /></div>
              <div className="blv-points-cap">Còn {(MISSION_POINTS.target - MISSION_POINTS.current).toLocaleString('vi-VN')} điểm để đổi phần quà tiếp theo</div>
            </div>
            <Link to="/gantt#nhiemvu-rewards" className="blv-btn tone-finance"><Icon name="gift" size={14} />Đổi quà</Link>
          </div>
          <div className="blv-list">
            {MISSIONS.map(m => {
              const [source, ...rest] = m.meta.split(' · ')
              return (
                <div key={m.title} className="blv-row">
                  <span className={`blv-ico sm tone-${MISSION_SOURCES[source] || 'primary'}`}><Icon name={source === 'Mua hàng' ? 'cart' : source === 'HR' ? 'clock' : 'folder'} size={13} /></span>
                  <div className="blv-row-main">
                    <div className="blv-row-title">{m.title}</div>
                    <div className="blv-row-meta">{source}{rest.length ? ' · ' + rest.join(' · ') : ''}</div>
                  </div>
                  <span className="blv-pts">{m.points}</span>
                </div>
              )
            })}
          </div>
        </Widget>
      )
    }

    if (id === 'daily') {
      return (
        <Widget
          icon="list" tone="primary" title="Task hàng ngày" sub={`${doneCount}/${tasks.length} việc đã xong · không tính điểm`}
          actions={onAddTask ? <button className="blv-btn" onClick={onAddTask}><Icon name="plus" size={14} stroke={2.4} />Thêm việc</button> : null}
        >
          <div className="blv-seg" role="tablist">
            {TASK_FILTERS.map(f => (
              <button key={f.key} role="tab" aria-selected={taskFilter === f.key} className={taskFilter === f.key ? 'active' : ''} onClick={() => setTaskFilter(f.key)}>
                {f.label}<span className="blv-seg-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <div className="blv-list">
            {visibleTasks.length === 0 && (
              <div className="blv-empty"><Icon name="inbox" size={22} stroke={1.6} /><span>{taskFilter === 'done' ? 'Chưa có việc nào hoàn thành' : 'Không còn việc cần làm — tuyệt vời!'}</span></div>
            )}
            {visibleTasks.map(t => (
              <div key={t.id} className={`blv-row blv-task${t.done ? ' done' : ''}`}>
                <button className="blv-check" aria-label={t.done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'} onClick={() => onToggleTask(t.id)}>
                  <Icon name="check" size={11} stroke={3} />
                </button>
                <div className="blv-row-main">
                  <div className="blv-row-title">{t.title}</div>
                  <div className="blv-row-meta">{t.meta}</div>
                </div>
                <span className={`blv-prio ${t.prio}`}>{PRIO_LABEL[t.prio]}</span>
              </div>
            ))}
          </div>
        </Widget>
      )
    }

    if (id === 'stat') {
      return (
        <Widget
          icon="clock" tone="attendance" title="Chấm công" sub="Tuần này · Tháng 9/2026"
          actions={<Link to="/cham-cong" className="blv-link">Chi tiết<Icon name="chevron" size={13} /></Link>}
        >
          <div className="blv-week">
            {WEEK_ATTENDANCE.map(d => (
              <div key={d.d} className={`blv-day ${d.s}`} title={`${d.d} ${d.date}/09 · ${ATT_LABEL[d.s]}${d.inT ? ' · vào ' + d.inT : ''}`}>
                <span className="blv-day-name">{d.d}</span>
                <span className="blv-day-dot">{d.date}</span>
                <span className="blv-day-time mono">{d.inT || '—'}</span>
              </div>
            ))}
          </div>
          <div className="blv-stats">
            {STATS.map(s => (
              <div key={s.label} className={`blv-stat tone-${s.tone}`}>
                <span className="blv-stat-num">{s.value}</span>
                <span className="blv-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </Widget>
      )
    }

    if (id === 'leave') {
      const remain = LEAVE.total - LEAVE.used
      const r = 30, c = 2 * Math.PI * r
      return (
        <Widget icon="sun" tone="finance" title="Ngày phép" sub="Năm 2026">
          <div className="blv-leave">
            <div className="blv-donut">
              <svg viewBox="0 0 76 76" width="76" height="76">
                <circle cx="38" cy="38" r={r} className="blv-donut-track" />
                <circle cx="38" cy="38" r={r} className="blv-donut-fill" strokeDasharray={`${c * remain / LEAVE.total} ${c}`} transform="rotate(-90 38 38)" />
              </svg>
              <div className="blv-donut-label"><b>{remain}</b><span>còn lại</span></div>
            </div>
            <div className="blv-legend">
              <div><i className="fill" />Còn lại<b>{remain} ngày</b></div>
              <div><i />Đã dùng<b>{LEAVE.used} ngày</b></div>
              <div><i className="pending" />Chờ duyệt<b>{LEAVE.pending} ngày</b></div>
            </div>
          </div>
          {onRequestLeave && <button className="blv-btn ghost block" onClick={onRequestLeave}><Icon name="calendar" size={14} />Xin nghỉ phép</button>}
        </Widget>
      )
    }

    if (id === 'info') {
      return (
        <Widget icon="grid" tone="qs" title="Thông số khác" sub="Truy cập nhanh">
          <div className="blv-list">
            {SHORTCUTS.map(s => {
              const inner = (
                <>
                  <span className={`blv-ico sm tone-${s.tone}`}><Icon name={s.icon} size={13} /></span>
                  <span className="blv-row-title blv-row-main">{s.label}</span>
                  <span className={`blv-short-val${s.badge ? ' badge' : ''}`}>{s.value}</span>
                  {s.to ? <span className="blv-chev"><Icon name="chevron" size={14} /></span> : <span className="blv-chev" />}
                </>
              )
              return s.to
                ? <Link key={s.label} to={s.to} className="blv-row blv-short">{inner}</Link>
                : <div key={s.label} className="blv-row blv-short">{inner}</div>
            })}
          </div>
        </Widget>
      )
    }
    return null
  }

  return (
    <WidgetGrid
      order={ITEM_ORDER} defs={ITEM_DEFS} storageKey={LAYOUT_KEY} renderItem={renderItem}
      editing={editing} resetSignal={resetSignal}
    />
  )
}
