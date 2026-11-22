import { useEffect, useRef, useState } from 'react'
import { INITIAL_STEPS, LEADERBOARD, REWARDS, initials, medal } from '../../../data/quanLyThietKeData'
import { useDelivery } from '../delivery'

const GAME_TABS = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'mission', label: 'Nhiệm vụ' },
  { key: 'rewards', label: 'Đổi quà' },
  { key: 'leaderboard', label: 'Bảng xếp hạng' },
]

const stepPoints = step => step.subtasks.reduce((s, x) => s + x.pts, 0)
const stepEarned = step => step.subtasks.reduce((s, x) => s + (x.done ? x.pts : 0), 0)
const vn = n => n.toLocaleString('vi-VN')

const Svg = ({ size, html, stroke = 'currentColor', sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: html }} />
)
const BUILDING_ICON = '<path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18"/><path d="M6 12h12M6 8h12M6 16h12"/>'
const CHECK_ICON = '<polyline points="4,12 9,17 20,6"/>'

function Kpi({ label, value, valueClass = '', color, sub }) {
  return (
    <div className="tk-card tk-game-kpi">
      <div className="tk-kpi-label">{label}</div>
      <div className={`tk-kpi-value ${valueClass}`} style={color ? { color } : undefined}>{value}</div>
      <div className="tk-game-kpi-sub">{sub}</div>
    </div>
  )
}

function RankBadge({ rank, size, fontSize }) {
  const m = medal(rank)
  return <span className="tk-rank" style={{ width: size, height: size, background: m.bg, color: m.color, fontSize }}>{rank}</span>
}
function LbAvatar({ p }) {
  return <span className="tk-lb-avatar" style={{ background: `${p.color}22`, color: p.color }}>{initials(p.name)}</span>
}

function CreateTaskModal({ steps, onClose, onSubmit }) {
  const currentIdx = steps.findIndex(s => s.status === 'current')
  const [name, setName] = useState('')
  const [stepIdx, setStepIdx] = useState(currentIdx >= 0 ? currentIdx : 0)
  const [who, setWho] = useState('')
  const [pts, setPts] = useState('20')
  const nameRef = useRef(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  function submit() {
    if (!name.trim()) { nameRef.current?.focus(); return }
    onSubmit({
      stepIdx: Number(stepIdx),
      task: { text: name.trim(), who: who.trim() || 'Chưa gán', pts: Math.max(0, Number(pts) || 0), done: false },
    })
  }

  return (
    <div className="tk-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tk-modal-box">
        <h3>Tạo nhiệm vụ mới</h3>
        <div className="tk-modal-sub">Dành cho lãnh đạo — tạo nhiệm vụ và chỉ định nhân sự tham gia.</div>
        <div className="tk-modal-field">
          <label>Tên nhiệm vụ *</label>
          <input ref={nameRef} type="text" placeholder="VD: Kiểm tra chất lượng cốt thép" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="tk-modal-field">
          <label>Thuộc bước thi công</label>
          <select value={stepIdx} onChange={e => setStepIdx(e.target.value)}>
            {steps.map((s, i) => <option key={i} value={i}>{i + 1}. {s.title}</option>)}
          </select>
        </div>
        <div className="tk-modal-field">
          <label>Nhân sự tham gia</label>
          <input type="text" placeholder="VD: Đội thi công A, Đỗ Thành Long" value={who} onChange={e => setWho(e.target.value)} />
        </div>
        <div className="tk-modal-field">
          <label>Điểm thưởng</label>
          <input type="text" inputMode="numeric" placeholder="VD: 30" value={pts} onChange={e => setPts(e.target.value)} />
        </div>
        <div className="tk-modal-actions">
          <button className="tk-modal-btn" onClick={onClose}>Huỷ</button>
          <button className="tk-modal-btn primary" onClick={submit}>Tạo nhiệm vụ</button>
        </div>
      </div>
    </div>
  )
}

export default function TaskGameTab({ gtab, onGtabChange }) {
  /* Phân quyền N21 (tab Nhiệm vụ): Tạo nhiệm vụ = create, đánh dấu hoàn thành = edit */
  const dv = useDelivery()
  const canCreate = dv.can('nhiemvu', 'create')
  const canEdit = dv.can('nhiemvu', 'edit')
  const [steps, setSteps] = useState(INITIAL_STEPS)
  const [wallet, setWallet] = useState(1240)
  const [modalOpen, setModalOpen] = useState(false)

  const totalMax = steps.reduce((s, st) => s + stepPoints(st), 0)
  const earned = steps.reduce((s, st) => s + stepEarned(st), 0)
  const missionPct = Math.round(earned / totalMax * 100)
  const doneSteps = steps.filter(s => s.status === 'done').length

  function checkSubtask(stepIdx, subIdx) {
    setSteps(prev => {
      const next = prev.map(s => ({ ...s, subtasks: [...s.subtasks] }))
      const step = next[stepIdx]
      if (step.subtasks[subIdx].done) return prev
      step.subtasks[subIdx] = { ...step.subtasks[subIdx], done: true }
      if (step.subtasks.every(s => s.done)) {
        step.status = 'done'
        if (next[stepIdx + 1] && next[stepIdx + 1].status === 'locked') next[stepIdx + 1].status = 'current'
      }
      return next
    })
  }

  function createTask({ stepIdx, task }) {
    setSteps(prev => prev.map((s, i) => i !== stepIdx ? s : {
      ...s,
      status: s.status === 'done' ? 'current' : s.status,
      subtasks: [...s.subtasks, task],
    }))
    setModalOpen(false)
  }

  const show = key => ({ display: gtab === key ? 'flex' : 'none' })

  return (
    <>
      <div className="tk-game-tabs">
        {GAME_TABS.map(t => (
          <button key={t.key} className={`tk-game-tab${gtab === t.key ? ' active' : ''}`} onClick={() => onGtabChange(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ---- Tổng quan ---- */}
      <div className="tk-game-panel" style={show('overview')}>
        <div className="tk-kpi-grid">
          <Kpi label="Nhân sự tham gia" value="24" sub="Trên 3 đội thi công" />
          <Kpi label="Tổng điểm đã phát" value="18.450" valueClass="mono tk-display" color="var(--gold)" sub="Từ đầu dự án đến nay" />
          <Kpi label="Nhiệm vụ hoàn thành tuần này" value="12" color="var(--success)" sub="+3 so với tuần trước" />
          <Kpi label="Quà đã đổi" value="7" color="var(--game)" sub="Xem lịch sử tại tab Đổi quà" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>Các quy trình đang "chơi"</h3>

            <div className="tk-card" style={{ borderColor: 'var(--game)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="tk-game-icon" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--game-tint)', color: 'var(--game)' }}>
                    <Svg size={19} html={BUILDING_ICON} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Quy trình thi công nhà phố — Lô B12</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>15 bước · Đội thi công A</div>
                  </div>
                </div>
                <span onClick={() => onGtabChange('mission')} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--game)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Chơi tiếp</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-alt)' }}>
                  <div style={{ width: `${Math.round(doneSteps / steps.length * 100)}%`, height: '100%', borderRadius: 4, background: 'var(--game)' }} />
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{doneSteps}/{steps.length} bước</span>
              </div>
            </div>

            <div className="tk-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="tk-game-icon" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--attendance-tint)', color: 'var(--attendance)' }}>
                    <Svg size={19} html={'<path d="M12 2 3 7v6c0 5 4 9 9 9s9-4 9-9V7z"/>'} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>An toàn lao động hàng ngày</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Chuỗi 12 ngày liên tiếp · Toàn công trường</div>
                  </div>
                </div>
                <span style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--surface-alt)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>Đang chạy</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chuỗi hiện tại:</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--attendance)' }}>12 ngày 🔥</span>
              </div>
            </div>

            <div className="tk-card" style={{ borderStyle: 'dashed', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, opacity: 0.7 }}>
              <div className="tk-game-icon" style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-alt)', color: 'var(--text-muted)', flex: 'none' }}>
                <Svg size={19} html={'<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0 1 10 0v3"/>'} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Quy trình nghiệm thu hoàn công</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Sắp ra mắt — đang thiết kế nhiệm vụ &amp; mốc điểm</div>
              </div>
            </div>
          </div>

          <div className="tk-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>Bảng xếp hạng tuần này</h3>
              <span onClick={() => onGtabChange('leaderboard')} style={{ fontSize: 12, color: 'var(--game)', fontWeight: 600, cursor: 'pointer' }}>Xem tất cả ›</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {LEADERBOARD.slice(0, 5).map((p, i) => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <RankBadge rank={i + 1} size={24} fontSize={11} />
                  <LbAvatar p={p} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--gold)', fontWeight: 700 }}>{p.week}đ</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Nhiệm vụ ---- */}
      <div className="tk-game-panel" style={show('mission')}>
        <div className="tk-card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div className="tk-game-icon" style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--game-tint)', color: 'var(--game)', flex: 'none' }}>
            <Svg size={26} html={BUILDING_ICON} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="tk-display" style={{ fontWeight: 800, fontSize: 16 }}>Quy trình thi công nhà phố — Lô B12</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>15 bước chính · Đội thi công A · Mỗi bước gồm các nhiệm vụ nhỏ, hoàn thành để nhận điểm</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tk-kpi-value mono tk-display" style={{ color: 'var(--gold)' }}>
              {vn(earned)} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>/ {vn(totalMax)} điểm</span>
            </div>
            <div style={{ width: 200, height: 7, borderRadius: 4, background: 'var(--surface-alt)', marginTop: 6 }}>
              <div style={{ width: `${missionPct}%`, height: '100%', borderRadius: 4, background: 'var(--game)' }} />
            </div>
          </div>
          {canCreate && <button className="tk-create-task-btn" title="Tạo nhiệm vụ mới" onClick={() => setModalOpen(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Tạo nhiệm vụ
          </button>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, idx) => {
            const isOpen = step.status === 'current'
            return (
              <div key={idx} className="tk-step-row">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  <div className={`tk-step-dot ${step.status}`}>
                    {step.status === 'done'
                      ? <Svg size={16} stroke="#fff" sw={3} html={CHECK_ICON} />
                      : step.status === 'locked'
                        ? <Svg size={14} sw={2.2} html={'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'} />
                        : idx + 1}
                  </div>
                  <div className="tk-line" />
                </div>
                <div className={`tk-step-card ${step.status}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{step.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {step.subtasks.length} nhiệm vụ nhỏ {step.status === 'locked' ? '· Hoàn thành bước trước để mở khoá' : ''}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: step.status === 'locked' ? 'var(--text-muted)' : 'var(--gold)' }}>
                      {stepEarned(step)}/{stepPoints(step)}đ
                    </span>
                  </div>
                  {step.status !== 'locked' && step.subtasks.map((s, si) => (
                    <div key={si} className="tk-subtask-row">
                      <div
                        className={`tk-subtask-chk${s.done ? ' checked' : ''}${isOpen && canEdit ? '' : ' disabled'}`}
                        onClick={isOpen && canEdit ? () => checkSubtask(idx, si) : undefined}
                      >
                        {s.done && <Svg size={12} sw={3} html={CHECK_ICON} />}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, ...(s.done ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : {}) }}>{s.text}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.who}</span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', width: 44, textAlign: 'right' }}>+{s.pts}đ</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ---- Đổi quà ---- */}
      <div className="tk-game-panel" style={show('rewards')}>
        <div className="tk-card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#0E8A8222', color: 'var(--attendance)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' }}>LV</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Lê Văn — Đội thi công A</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Điểm khả dụng để đổi quà</div>
          </div>
          <div className="tk-kpi-value mono tk-display" style={{ color: 'var(--gold)' }}>{vn(wallet)} điểm</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {REWARDS.map(r => {
            const affordable = r.cost <= wallet
            return (
              <div key={r.title} className="tk-reward-card">
                <div className="tk-game-icon" style={{ width: 40, height: 40, borderRadius: 10, background: `var(--${r.color}-tint)`, color: `var(--${r.color})` }}>
                  <Svg size={20} html={r.icon} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.title}</div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>{vn(r.cost)} điểm</div>
                <button className="tk-redeem-btn" disabled={!affordable} onClick={() => setWallet(w => (r.cost > w ? w : w - r.cost))}>
                  {affordable ? 'Đổi ngay' : 'Không đủ điểm'}
                </button>
              </div>
            )
          })}
          <div className="tk-reward-card locked">
            <div className="tk-game-icon" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-alt)', color: 'var(--text-muted)' }}>
              <Svg size={20} html={'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8V5a3 3 0 0 1 6 0v3"/>'} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Thưởng tiền mặt 500.000đ</div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>2.000 điểm</div>
            <button className="tk-redeem-btn" disabled>Không đủ điểm</button>
          </div>
        </div>

        <div className="tk-card" style={{ padding: '16px 20px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Lịch sử đổi quà gần đây</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ flex: 1 }}>Ngọc Hà — Áo đồng phục cao cấp</span><span className="mono" style={{ color: 'var(--gold)' }}>-500 điểm</span><span style={{ color: 'var(--text-muted)' }}>18/09</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 13 }}>
            <span style={{ flex: 1 }}>Phạm Quốc Bảo — Phiếu ăn trưa miễn phí</span><span className="mono" style={{ color: 'var(--gold)' }}>-300 điểm</span><span style={{ color: 'var(--text-muted)' }}>10/09</span>
          </div>
        </div>
      </div>

      {/* ---- Bảng xếp hạng ---- */}
      <div className="tk-game-panel" style={show('leaderboard')}>
        <div className="tk-card" style={{ padding: '6px 20px 14px' }}>
          <div className="tk-lb-grid" style={{ padding: '12px 4px', fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <span>Hạng</span><span>Nhân viên</span><span>Đội</span><span>Điểm tuần này</span><span>Tổng điểm</span>
          </div>
          <div>
            {LEADERBOARD.map((p, i) => (
              <div key={p.name} className="tk-lb-grid" style={{ padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
                <RankBadge rank={i + 1} size={26} fontSize={12} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}><LbAvatar p={p} />{p.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{p.team}</span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.week} đ</span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)' }}>{vn(p.total)} đ</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalOpen && canCreate && <CreateTaskModal steps={steps} onClose={() => setModalOpen(false)} onSubmit={createTask} />}
    </>
  )
}
