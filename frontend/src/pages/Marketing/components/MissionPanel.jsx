import { M_TOTAL_MAX, stepPointsM, stepEarnedM } from '../../../data/marketingData'
import { MK_FONT } from './CampaignsTab'

const checkIcon = (size, stroke) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,12 9,17 20,6" /></svg>
const lockIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>

/* Tab con "Nhiệm vụ": các bước chiến dịch + nhiệm vụ nhỏ (renderTaskSteps) */
/* N21: không có onOpenCreateTask / onCheckSubtask (không có quyền Thêm / Sửa ở Marketing > Nhiệm vụ) -> ẩn nút / không tích được */
export default function MissionPanel({ visible, steps, onCheckSubtask, onOpenCreateTask }) {
  const earned = steps.reduce((s, st) => s + stepEarnedM(st), 0)
  const pct = Math.round(earned / M_TOTAL_MAX * 100)

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--marketing-tint)', color: 'var(--marketing)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 17, fontFamily: MK_FONT }}>Quy trình chiến dịch — Ra mắt Riverside Giai đoạn 3</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>5 bước chính · Phòng Marketing · Mỗi bước gồm các nhiệm vụ nhỏ, hoàn thành để nhận điểm</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontFamily: MK_FONT, fontWeight: 800, fontSize: 22, color: 'var(--gold)' }}>{earned.toLocaleString('vi-VN')} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>/ {M_TOTAL_MAX.toLocaleString('vi-VN')} điểm</span></div>
          <div style={{ width: 200, height: 7, borderRadius: 4, background: 'var(--surface-alt)', marginTop: 6 }}><div style={{ width: pct + '%', height: '100%', borderRadius: 4, background: 'var(--marketing)' }} /></div>
        </div>
        {onOpenCreateTask && <button className="mk-create-task-btn" title="Tạo nhiệm vụ mới" onClick={onOpenCreateTask}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Tạo nhiệm vụ
        </button>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((step, idx) => {
          /* Chỉ bước đang "current" mới tick được nhiệm vụ nhỏ */
          const isOpen = step.status === 'current'
          const dotContent = step.status === 'done' ? checkIcon(16, '#fff') : step.status === 'locked' ? lockIcon : (idx + 1)
          return (
            <div className="mk-step-row" key={idx}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <div className={`mk-step-dot ${step.status}`}>{dotContent}</div>
                <div className="mk-step-line" />
              </div>
              <div className={`mk-step-card ${step.status}`}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{step.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{step.subtasks.length} nhiệm vụ nhỏ {step.status === 'locked' ? '· Hoàn thành bước trước để mở khoá' : ''}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: step.status === 'locked' ? 'var(--text-muted)' : 'var(--gold)' }}>{stepEarnedM(step)}/{stepPointsM(step)}đ</span>
                </div>
                {step.status !== 'locked' && step.subtasks.map((s, si) => (
                  <div className="mk-subtask-row" key={si}>
                    <div
                      className={`mk-subtask-chk${s.done ? ' checked' : ''}${isOpen && onCheckSubtask ? '' : ' disabled'}`}
                      onClick={isOpen && onCheckSubtask ? () => onCheckSubtask(idx, si) : undefined}
                    >
                      {s.done ? checkIcon(12, 'currentColor') : null}
                    </div>
                    <span style={{ flex: 1, fontSize: 13, ...(s.done ? { color: 'var(--text-muted)', textDecoration: 'line-through' } : null) }}>{s.text}</span>
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
  )
}
