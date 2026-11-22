import { useState } from 'react'
import { TASK_TABS, KD_LEADERBOARD, KD_TOTAL_MAX, KD_REWARDS, KD_REDEEM_HISTORY } from '../../../data/kinhDoanhData'
import { FONT_STACK, initialsOfK, medalK } from '../utils'

/* ===================== Tab Nhiệm vụ & điểm thưởng ===================== */

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }
const kpiCard = { ...card, padding: '17px 20px', display: 'flex', flexDirection: 'column', gap: 8 }
const kpiLabel = { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const kpiNum = { fontFamily: FONT_STACK, fontWeight: 800, fontSize: 26 }
const kpiSub = { fontSize: 12, color: 'var(--text-muted)' }
const LB_COLS = '0.6fr 2fr 1.4fr 1fr 1fr'

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const TrendIcon = ({ size }) => <svg width={size} height={size} {...svg}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>

const REWARD_ICONS = {
  coffee: <svg width="20" height="20" {...svg}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" /><line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" /></svg>,
  voucher: <svg width="20" height="20" {...svg}><path d="M20.4 14.5 16 10 4 20" /><path d="M6 20 20.4 5.5" /></svg>,
  course: <svg width="20" height="20" {...svg}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></svg>,
  calendar: <svg width="20" height="20" {...svg}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  chat: <svg width="20" height="20" {...svg}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  bag: <svg width="20" height="20" {...svg}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8V5a3 3 0 0 1 6 0v3" /></svg>,
}

const stepPointsK = step => step.subtasks.reduce((s, x) => s + x.pts, 0)
const stepEarnedK = step => step.subtasks.reduce((s, x) => s + (x.done ? x.pts : 0), 0)

const redeemBtnBase = { border: 'none', padding: 8, borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }
const redeemBtnOn = { ...redeemBtnBase, background: 'var(--sales)', color: '#fff', cursor: 'pointer' }
const redeemBtnOff = { ...redeemBtnBase, background: 'var(--surface-alt)', color: 'var(--text-muted)', cursor: 'not-allowed' }

/* N21: không có onOpenCreateTask (không có quyền Thêm) -> ẩn "Tạo nhiệm vụ"; không có onCheckSubtask (không có quyền Sửa) -> không tích được */
export default function TasksTab({ steps, onCheckSubtask, wallet, onRedeem, onOpenCreateTask }) {
  const [ktab, setKtab] = useState('overview')
  const panel = (name, extra) => ({ display: ktab === name ? 'flex' : 'none', flexDirection: 'column', gap: 16, ...extra })

  const earned = steps.reduce((s, st) => s + stepEarnedK(st), 0)
  const pct = Math.round(earned / KD_TOTAL_MAX * 100)
  const doneSteps = steps.filter(s => s.status === 'done').length

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {TASK_TABS.map(([key, label]) => (
          <button key={key} className={`kd-task-tab${ktab === key ? ' active' : ''}`} onClick={() => setKtab(key)}>{label}</button>
        ))}
      </div>

      {/* ---- Tổng quan ---- */}
      <div style={panel('overview')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div style={kpiCard}>
            <div style={kpiLabel}>Nhân sự tham gia</div>
            <div style={kpiNum}>5</div>
            <div style={kpiSub}>2 phòng KD Dự Án &amp; Dân dụng</div>
          </div>
          <div style={kpiCard}>
            <div style={kpiLabel}>Tổng điểm đã phát</div>
            <div className="mono" style={{ ...kpiNum, color: 'var(--gold)' }}>7.240</div>
            <div style={kpiSub}>Từ đầu quý đến nay</div>
          </div>
          <div style={kpiCard}>
            <div style={kpiLabel}>Nhiệm vụ hoàn thành tuần này</div>
            <div style={{ ...kpiNum, color: 'var(--success)' }}>6</div>
            <div style={kpiSub}>+2 so với tuần trước</div>
          </div>
          <div style={kpiCard}>
            <div style={kpiLabel}>Quà đã đổi</div>
            <div style={{ ...kpiNum, color: 'var(--sales)' }}>4</div>
            <div style={kpiSub}>Xem lịch sử tại tab Đổi quà</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 700 }}>Quy trình đang "chơi"</h3>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--sales)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--sales-tint)', color: 'var(--sales)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <TrendIcon size={19} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Quy trình chốt hợp đồng — BQL Riverside GĐ3</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>5 bước · Phòng KD Dự Án</div>
                  </div>
                </div>
                <span onClick={() => setKtab('mission')} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--sales)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Chơi tiếp</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-alt)' }}>
                  <div style={{ width: Math.round(doneSteps / steps.length * 100) + '%', height: '100%', borderRadius: 4, background: 'var(--sales)' }} />
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{doneSteps}/{steps.length} bước</span>
              </div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, opacity: 0.7 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <svg width="19" height="19" {...svg}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V8a5 5 0 0 1 10 0v3" /></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Quy trình chăm sóc khách hàng sau bàn giao</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Sắp ra mắt — đang thiết kế nhiệm vụ &amp; mốc điểm</div>
              </div>
            </div>
          </div>

          <div style={{ ...card, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 14.5, fontWeight: 700 }}>Bảng xếp hạng tuần này</h3>
              <span onClick={() => setKtab('leaderboard')} style={{ fontSize: 12, color: 'var(--sales)', fontWeight: 600, cursor: 'pointer' }}>Xem tất cả ›</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {KD_LEADERBOARD.slice(0, 5).map((p, i) => {
                const m = medalK(i + 1)
                return (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', background: m.bg, color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>{i + 1}</span>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', background: p.color + '22', color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: 'none' }}>{initialsOfK(p.name)}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 12.5, color: 'var(--gold)', fontWeight: 700 }}>{p.week}đ</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Nhiệm vụ ---- */}
      <div style={panel('mission')}>
        <div style={{ ...card, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--sales-tint)', color: 'var(--sales)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <TrendIcon size={26} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17, fontFamily: FONT_STACK }}>Quy trình chốt hợp đồng — BQL Riverside GĐ3</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>5 bước chính · Phòng KD Dự Án · Mỗi bước gồm các nhiệm vụ nhỏ, hoàn thành để nhận điểm</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: 22, color: 'var(--gold)' }}>
              {earned.toLocaleString('vi-VN')} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>/ {KD_TOTAL_MAX.toLocaleString('vi-VN')} điểm</span>
            </div>
            <div style={{ width: 200, height: 7, borderRadius: 4, background: 'var(--surface-alt)', marginTop: 6 }}>
              <div style={{ width: pct + '%', height: '100%', borderRadius: 4, background: 'var(--sales)' }} />
            </div>
          </div>
          {onOpenCreateTask && <button className="kd-create-task-btn" title="Tạo nhiệm vụ mới" onClick={onOpenCreateTask}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Tạo nhiệm vụ
          </button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, idx) => {
            const isOpen = step.status === 'current'
            return (
              <div className="kd-step-row" key={idx}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  <div className={`kd-step-dot ${step.status}`}>
                    {step.status === 'done'
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,12 9,17 20,6" /></svg>
                      : step.status === 'locked'
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        : idx + 1}
                  </div>
                  <div className="kd-line" />
                </div>
                <div className={`kd-step-card ${step.status}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{step.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{step.subtasks.length} nhiệm vụ nhỏ {step.status === 'locked' ? '· Hoàn thành bước trước để mở khoá' : ''}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: step.status === 'locked' ? 'var(--text-muted)' : 'var(--gold)' }}>{stepEarnedK(step)}/{stepPointsK(step)}đ</span>
                  </div>
                  {step.status !== 'locked' && step.subtasks.map((s, si) => (
                    <div className="kd-subtask-row" key={si}>
                      <div
                        className={`kd-subtask-chk${s.done ? ' checked' : ''}${isOpen && onCheckSubtask ? '' : ' disabled'}`}
                        onClick={isOpen && onCheckSubtask ? () => onCheckSubtask(idx, si) : undefined}
                      >
                        {s.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,12 9,17 20,6" /></svg>}
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

      {/* ---- Đổi quà ---- */}
      <div style={panel('rewards')}>
        <div style={{ ...card, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#C2621A22', color: 'var(--sales)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' }}>TA</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Trần Anh — Trưởng phòng Kinh doanh</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Điểm khả dụng để đổi quà</div>
          </div>
          <div className="mono" style={{ fontFamily: FONT_STACK, fontWeight: 800, fontSize: 24, color: 'var(--gold)' }}>{wallet.toLocaleString('vi-VN')} điểm</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {KD_REWARDS.map(r => {
            /* Bản HTML (updateWalletUIK): nút bị khoá khi giá > ví, nhưng thẻ không thêm class locked */
            const cannot = r.locked || r.cost > wallet
            return (
              <div key={r.name} className={`kd-reward-card${r.locked ? ' locked' : ''}`}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: r.locked ? 'var(--surface-alt)' : r.bg, color: r.locked ? 'var(--text-muted)' : r.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{REWARD_ICONS[r.icon]}</div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
                <div className="mono" style={{ fontSize: 13, color: r.locked ? 'var(--text-muted)' : 'var(--gold)', fontWeight: 700 }}>{r.costLabel}</div>
                {cannot
                  ? <button disabled style={redeemBtnOff}>Không đủ điểm</button>
                  : <button style={redeemBtnOn} onClick={() => onRedeem(r.cost)}>Đổi ngay</button>}
              </div>
            )
          })}
        </div>

        <div style={{ ...card, padding: '16px 20px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Lịch sử đổi quà gần đây</h3>
          {KD_REDEEM_HISTORY.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', ...(i < KD_REDEEM_HISTORY.length - 1 ? { borderBottom: '1px solid var(--border)' } : null), fontSize: 13 }}>
              <span style={{ flex: 1 }}>{h.text}</span>
              <span className="mono" style={{ color: 'var(--gold)' }}>{h.pts}</span>
              <span style={{ color: 'var(--text-muted)' }}>{h.date}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Bảng xếp hạng ---- */}
      <div style={panel('leaderboard')}>
        <div style={{ ...card, padding: '6px 20px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: LB_COLS, gap: 10, padding: '12px 4px', fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <span>Hạng</span><span>Nhân sự</span><span>Phòng ban</span><span>Điểm tuần này</span><span>Tổng điểm</span>
          </div>
          <div>
            {KD_LEADERBOARD.map((p, i) => {
              const m = medalK(i + 1)
              return (
                <div key={p.name} style={{ display: 'grid', gridTemplateColumns: LB_COLS, gap: 10, alignItems: 'center', padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: m.bg, color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', background: p.color + '22', color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{initialsOfK(p.name)}</span>
                    {p.name}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{p.team}</span>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.week} đ</span>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gold)' }}>{p.total.toLocaleString('vi-VN')} đ</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
