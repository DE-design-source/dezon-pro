import { useState } from 'react'
import PageShell from '../../components/layout/PageShell'
import { useAccess } from '../../services/accessService'

const summary = [
  { label: 'Ngày công',   value: '18' },
  { label: 'Nghỉ phép',  value: '2'  },
  { label: 'Giờ OT',     value: '4h' },
]

export default function ChamCongMobile() {
  const [checkedIn, setCheckedIn] = useState(false)
  const [checkedOut, setCheckedOut] = useState(false)
  /* Phân quyền N21: xem = HR > Chấm công & phép > Xem; chấm vào / ra = thêm Tạo */
  const a = useAccess()
  const canPunch = a.can('hr', 'attendance', 'view') && a.can('hr', 'attendance', 'create')
  const loadingAccess = !canPunch && !a.ready && !a.error
  const now = new Date()
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr = now.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <PageShell title="Chấm công" subtitle="Chấm công cá nhân qua thiết bị di động">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>

        {/* Clock Card */}
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 12px rgba(0,0,0,.1)', padding: '36px 48px', textAlign: 'center', maxWidth: 420, width: '100%' }}>
          <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>{dateStr}</div>
          <div style={{ fontSize: 52, fontWeight: 700, color: '#1f2937', letterSpacing: 2, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</div>

          {!canPunch && (
            <div style={{ marginTop: 28, fontSize: 14, color: '#6b7280' }}>
              {loadingAccess ? 'Đang tải phân quyền…' : 'Chưa được cấp quyền chấm công'}
            </div>
          )}
          {canPunch && <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28 }}>
            <button
              onClick={() => setCheckedIn(true)}
              disabled={checkedIn}
              style={{
                background: checkedIn ? '#d1fae5' : '#6366f1',
                color: checkedIn ? '#059669' : '#fff',
                border: 'none', borderRadius: 10, padding: '12px 28px',
                fontSize: 15, fontWeight: 600, cursor: checkedIn ? 'default' : 'pointer',
                transition: 'background .2s',
              }}
            >
              {checkedIn ? '✓ Đã chấm vào' : 'Chấm vào'}
            </button>
            <button
              onClick={() => setCheckedOut(true)}
              disabled={!checkedIn || checkedOut}
              style={{
                background: checkedOut ? '#fee2e2' : (!checkedIn ? '#f3f4f6' : '#ef4444'),
                color: checkedOut ? '#dc2626' : (!checkedIn ? '#9ca3af' : '#fff'),
                border: 'none', borderRadius: 10, padding: '12px 28px',
                fontSize: 15, fontWeight: 600, cursor: (!checkedIn || checkedOut) ? 'default' : 'pointer',
                transition: 'background .2s',
              }}
            >
              {checkedOut ? '✓ Đã chấm ra' : 'Chấm ra'}
            </button>
          </div>}
        </div>

        {/* Monthly Summary */}
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.08)', padding: '20px 32px', maxWidth: 420, width: '100%' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 14 }}>Tổng kết tháng này</div>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            {summary.map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#6366f1' }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </PageShell>
  )
}
