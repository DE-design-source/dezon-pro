import { useState } from 'react'
import { DONTU_CONFIG, FORM_GROUPS, ME, REQUEST_STATUS_LABEL, requestStatus, roleShort } from '../../../data/banLamViecData'
import Icon from '../../../components/ui/Icon'

const FILTERS = [['all', 'Tất cả'], ['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối']]
const STEP_STATE_LABEL = { done: 'Đã duyệt', active: 'Đang chờ duyệt', waiting: 'Chưa tới lượt', rejected: 'Từ chối', skipped: 'Không cần duyệt' }

const initialsOf = name => name.replace(/\(.*\)/, '').trim().split(/\s+/).map(w => w[0]).slice(-2).join('').toUpperCase()

/* Tiến trình duyệt thu gọn (dùng trong danh sách) */
function MiniSteps({ approvers }) {
  return (
    <div className="blv-steps" title={approvers.map(a => `${a.role}: ${a.name} — ${STEP_STATE_LABEL[a.state]}`).join('\n')}>
      {approvers.map((a, i) => (
        <div key={i} className={`blv-step ${a.state}`}>
          {i > 0 && <span className="blv-step-line" />}
          <span className="blv-step-dot">
            {a.state === 'done' ? <Icon name="check" size={10} stroke={3.2} /> : a.state === 'rejected' ? <Icon name="x" size={10} stroke={3.2} /> : i + 1}
          </span>
          <span className="blv-step-label">{roleShort(a.role)}</span>
        </div>
      ))}
    </div>
  )
}

/* Trang chi tiết 1 đơn: thông tin + luồng phê duyệt Tạo đơn → Người duyệt 1 → … → Kết quả */
function RequestDetail({ request: r, onBack, onCancel }) {
  const [reminded, setReminded] = useState(false)
  const cfg = DONTU_CONFIG[r.type]
  const st = requestStatus(r)
  const doneCount = r.approvers.filter(a => a.state === 'done').length
  const finalStep = st === 'approved'
    ? { state: 'done', title: 'Hoàn tất', text: 'Đơn đã được duyệt đầy đủ' }
    : st === 'rejected'
      ? { state: 'rejected', title: 'Đơn bị từ chối', text: 'Bạn có thể chỉnh sửa và gửi lại đơn mới' }
      : st === 'cancelled'
        ? { state: 'rejected', title: 'Đã huỷ', text: 'Bạn đã huỷ đơn này' }
        : { state: 'waiting', title: 'Hoàn tất', text: 'Khi tất cả người duyệt đồng ý' }

  return (
    <div className="blv-detail">
      <button className="blv-back" onClick={onBack}><Icon name="arrowLeft" size={15} />Lịch sử đơn từ</button>

      <div className={`blv-card blv-detail-head tone-${cfg.color}`}>
        <span className="blv-ico lg"><Icon name={cfg.icon} size={19} stroke={1.9} /></span>
        <div className="blv-row-main">
          <div className="blv-detail-kicker">{cfg.title} · Mã đơn DT-{String(r.id).padStart(4, '0')}</div>
          <h2 className="blv-detail-title">{r.title}</h2>
          <div className="blv-row-meta">Tạo bởi {ME.name} · {r.createdAt}</div>
        </div>
        <span className={`blv-status ${st}`}>{REQUEST_STATUS_LABEL[st]}</span>
        {st === 'pending' && (
          <div className="blv-detail-actions">
            <button className="blv-btn ghost" disabled={reminded} onClick={() => setReminded(true)}>
              <Icon name={reminded ? 'check' : 'bell'} size={14} />{reminded ? 'Đã nhắc duyệt' : 'Nhắc duyệt'}
            </button>
            {onCancel && (
              <button className="blv-btn ghost danger" onClick={() => { if (confirm('Huỷ đơn này?')) onCancel(r.id) }}>
                <Icon name="x" size={14} />Huỷ đơn
              </button>
            )}
          </div>
        )}
      </div>

      <div className="blv-detail-grid">
        <div className="blv-card">
          <h3 className="blv-card-title">Thông tin đơn</h3>
          <dl className="blv-fields">
            <div><dt>Loại đơn</dt><dd>{cfg.title}</dd></div>
            {r.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="blv-reason">
            <span>{cfg.reasonLabel}</span>
            <p>{r.reason}</p>
          </div>
        </div>

        <div className="blv-card">
          <div className="blv-card-head" style={{ marginBottom: 14 }}>
            <h3 className="blv-card-title" style={{ margin: 0 }}>Luồng phê duyệt</h3>
            <span className="blv-w-sub">{doneCount}/{r.approvers.length} cấp đã duyệt</span>
          </div>
          <ol className="blv-flow">
            <li className="blv-flow-step done">
              <span className="blv-flow-dot"><Icon name="send" size={12} stroke={2.4} /></span>
              <div className="blv-flow-body">
                <div className="blv-flow-top"><b>Tạo đơn</b><span className="blv-flow-time">{r.createdAt}</span></div>
                <div className="blv-flow-person"><span className="blv-avatar">{initialsOf(ME.name)}</span>{ME.name} <em>Người đề nghị</em></div>
              </div>
            </li>
            {r.approvers.map((a, i) => {
              const state = st === 'cancelled' && (a.state === 'active' || a.state === 'waiting') ? 'skipped' : a.state
              return (
                <li key={i} className={`blv-flow-step ${state}`}>
                  <span className="blv-flow-dot">
                    {state === 'done' ? <Icon name="check" size={12} stroke={3} /> : state === 'rejected' ? <Icon name="x" size={12} stroke={3} /> : i + 1}
                  </span>
                  <div className="blv-flow-body">
                    <div className="blv-flow-top">
                      <b>Người duyệt {i + 1}</b>
                      <span className={`blv-flow-state ${state}`}>{STEP_STATE_LABEL[state]}</span>
                      {a.time && <span className="blv-flow-time">{a.time}</span>}
                    </div>
                    <div className="blv-flow-person"><span className="blv-avatar">{initialsOf(a.name)}</span>{a.name} <em>{a.role}</em></div>
                    {a.note && <div className="blv-flow-note">“{a.note}”</div>}
                  </div>
                </li>
              )
            })}
            <li className={`blv-flow-step ${finalStep.state} last`}>
              <span className="blv-flow-dot"><Icon name="flag" size={12} stroke={2.4} /></span>
              <div className="blv-flow-body">
                <div className="blv-flow-top"><b>{finalStep.title}</b></div>
                <div className="blv-row-meta">{finalStep.text}</div>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}

/* Tab "Đơn từ": chọn loại đơn để tạo + lịch sử đơn; bấm 1 đơn để xem chi tiết & luồng duyệt */
export default function DonTuTab({ requests, onPickType, onCancelRequest, openId, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const opened = openId != null ? requests.find(r => r.id === openId) : null
  if (opened) return <RequestDetail request={opened} onBack={() => onOpen(null)} onCancel={onCancelRequest} />

  const counts = { all: requests.length, pending: 0, approved: 0, rejected: 0, cancelled: 0 }
  requests.forEach(r => { counts[requestStatus(r)]++ })
  const shown = requests.filter(r => filter === 'all' || requestStatus(r) === filter)

  const q = query.trim().toLowerCase()
  const groups = FORM_GROUPS
    .map(g => ({ ...g, types: g.types.filter(t => !q || (DONTU_CONFIG[t].title + ' ' + DONTU_CONFIG[t].desc).toLowerCase().includes(q)) }))
    .filter(g => g.types.length)

  return (
    <>
      {onPickType && <div className="blv-card">
        <div className="blv-card-head">
          <div>
            <h3>Tạo đơn mới</h3>
            <span className="blv-w-sub">Chọn loại đơn — đơn được gửi lần lượt qua từng người duyệt bạn thiết lập</span>
          </div>
          <label className="blv-search">
            <Icon name="search" size={14} />
            <input placeholder="Tìm loại đơn..." value={query} onChange={e => setQuery(e.target.value)} />
          </label>
        </div>
        {groups.length === 0 && <div className="blv-empty"><Icon name="search" size={22} stroke={1.6} /><span>Không tìm thấy loại đơn phù hợp</span></div>}
        {groups.map(g => (
          <div key={g.key} className="blv-form-group">
            <div className="blv-form-group-label">{g.label}</div>
            <div className="blv-form-grid">
              {g.types.map(t => {
                const c = DONTU_CONFIG[t]
                return (
                  <button key={t} className={`blv-form-card tone-${c.color}`} onClick={() => onPickType(t)}>
                    <span className="blv-ico"><Icon name={c.icon} size={16} stroke={1.9} /></span>
                    <span className="blv-row-main">
                      <span className="blv-form-title">{c.title}</span>
                      <span className="blv-form-desc">{c.desc}</span>
                    </span>
                    <span className="blv-form-arrow"><Icon name="arrowRight" size={14} stroke={2.2} /></span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>}

      <div className="blv-card">
        <div className="blv-card-head">
          <div>
            <h3>Lịch sử đơn từ</h3>
            <span className="blv-w-sub">{counts.pending} đơn đang chờ duyệt · bấm vào đơn để xem chi tiết</span>
          </div>
          <div className="blv-seg">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                {label}<span className="blv-seg-count">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 && <div className="blv-empty"><Icon name="inbox" size={22} stroke={1.6} /><span>Không có đơn nào trong mục này</span></div>}
        {shown.map(r => {
          const st = requestStatus(r)
          const cfg = DONTU_CONFIG[r.type]
          return (
            <button key={r.id} className="blv-request" onClick={() => onOpen(r.id)}>
              <span className={`blv-ico tone-${cfg.color}`}><Icon name={cfg.icon} size={15} /></span>
              <span className="blv-row-main">
                <span className="blv-row-title">{r.title}</span>
                <span className="blv-row-meta">Gửi {r.createdAt} · {r.reason}</span>
              </span>
              <MiniSteps approvers={r.approvers} />
              <span className={`blv-status ${st}`}>{REQUEST_STATUS_LABEL[st]}</span>
              <span className="blv-chev"><Icon name="chevron" size={15} /></span>
            </button>
          )
        })}
      </div>
    </>
  )
}
