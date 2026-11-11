import { useState } from 'react'
import { MKT_WALLET_START } from '../../../data/marketingData'
import { MK_FONT } from './CampaignsTab'

const ip = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

/* Danh sách quà (markup tĩnh trong marketing.html) */
const REWARDS = [
  { name: 'Phiếu cà phê / trà sữa (1 tuần)', cost: 250, bg: 'var(--finance-tint)', color: 'var(--finance)', icon: <svg {...ip}><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" /><line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" /></svg> },
  { name: 'Ngày làm việc từ xa (1 ngày)', cost: 400, bg: 'var(--attendance-tint)', color: 'var(--attendance)', icon: <svg {...ip}><path d="M6 9V2h12v7" /><path d="M6 18h12v4H6z" /><path d="M6 14h12" /><rect x="4" y="9" width="16" height="9" rx="2" /></svg> },
  { name: 'Voucher mua sắm 200.000đ', cost: 500, bg: 'var(--primary-tint)', color: 'var(--primary)', icon: <svg {...ip}><path d="M20.4 14.5 16 10 4 20" /><path d="M6 20 20.4 5.5" /></svg> },
  { name: 'Khoá học thiết kế / dựng video nâng cao', cost: 800, bg: 'var(--success-tint)', color: 'var(--success)', icon: <svg {...ip}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></svg> },
  { name: 'Bộ phụ kiện quay dựng cá nhân', costLabel: '1.500 điểm', locked: true, icon: <svg {...ip}><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg> },
  { name: 'Thưởng tiền mặt 500.000đ', costLabel: '2.000 điểm', locked: true, icon: <svg {...ip}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8V5a3 3 0 0 1 6 0v3" /></svg> },
]

const btnBase = { border: 'none', padding: 8, borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }
const btnOn = { ...btnBase, background: 'var(--marketing)', color: '#fff', cursor: 'pointer' }
const btnOff = { ...btnBase, background: 'var(--surface-alt)', color: 'var(--text-muted)', cursor: 'not-allowed' }
const histRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 13 }

/* Tab con "Đổi quà": ví điểm + danh sách quà + lịch sử */
export default function RewardsPanel({ visible }) {
  const [wallet, setWallet] = useState(MKT_WALLET_START)

  function redeem(cost) {
    if (cost > wallet) return
    setWallet(w => w - cost)
  }

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#1F5FBF22', color: 'var(--marketing)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flex: 'none' }}>TV</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Đỗ Thảo Vy — Head Marketing</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Điểm khả dụng để đổi quà</div>
        </div>
        <div className="mono" style={{ fontFamily: MK_FONT, fontWeight: 800, fontSize: 24, color: 'var(--gold)' }}>{wallet.toLocaleString('vi-VN')} điểm</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {REWARDS.map(r => {
          /* Nút tự khoá khi ví không còn đủ điểm (updateWalletUIM); thẻ không đổi sang trạng thái mờ */
          const short = !r.locked && r.cost > wallet
          return (
            <div className={`mk-reward-card${r.locked ? ' locked' : ''}`} key={r.name}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: r.locked ? 'var(--surface-alt)' : r.bg, color: r.locked ? 'var(--text-muted)' : r.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
              <div className="mono" style={{ fontSize: 13, color: r.locked ? 'var(--text-muted)' : 'var(--gold)', fontWeight: 700 }}>{r.locked ? r.costLabel : r.cost + ' điểm'}</div>
              {r.locked || short
                ? <button disabled style={btnOff}>Không đủ điểm</button>
                : <button style={btnOn} onClick={() => redeem(r.cost)}>Đổi ngay</button>}
            </div>
          )
        })}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Lịch sử đổi quà gần đây</h3>
        <div style={{ ...histRow, borderBottom: '1px solid var(--border)' }}><span style={{ flex: 1 }}>Minh Quân — Ngày làm việc từ xa</span><span className="mono" style={{ color: 'var(--gold)' }}>-400 điểm</span><span style={{ color: 'var(--text-muted)' }}>19/09</span></div>
        <div style={histRow}><span style={{ flex: 1 }}>Ngọc Hà — Phiếu cà phê / trà sữa</span><span className="mono" style={{ color: 'var(--gold)' }}>-250 điểm</span><span style={{ color: 'var(--text-muted)' }}>12/09</span></div>
      </div>
    </div>
  )
}
