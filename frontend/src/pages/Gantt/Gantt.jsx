import PageShell from '../../components/layout/PageShell'
import { useAccess } from '../../services/accessService'

const tasks = [
  { name: 'Khởi động dự án', owner: 'Nguyễn A', start: '01/10', end: '05/10', pct: 100 },
  { name: 'Thiết kế UI/UX',  owner: 'Trần B',   start: '04/10', end: '12/10', pct: 75  },
  { name: 'Phát triển backend', owner: 'Lê C',  start: '08/10', end: '22/10', pct: 40  },
  { name: 'Kiểm thử tích hợp', owner: 'Phạm D', start: '20/10', end: '28/10', pct: 10  },
  { name: 'Triển khai sản phẩm', owner: 'Hoàng E', start: '27/10', end: '31/10', pct: 0  },
]

const card = {
  background: '#fff',
  borderRadius: 10,
  boxShadow: '0 1px 4px rgba(0,0,0,.08)',
  padding: '20px 24px',
  overflowX: 'auto',
}

const th = { padding: '10px 14px', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #f0f0f0' }
const td = { padding: '12px 14px', fontSize: 14, color: '#374151', verticalAlign: 'middle' }

function Bar({ pct }) {
  return (
    <div style={{ background: '#f3f4f6', borderRadius: 6, height: 10, width: 140 }}>
      <div style={{ background: pct === 100 ? '#10b981' : '#6366f1', width: `${pct}%`, height: '100%', borderRadius: 6, transition: 'width .3s' }} />
    </div>
  )
}

/* Phân quyền N21: xem Tiến độ của Quản lý dự án hoặc Bàn làm việc (giống quyền route /gantt trong data/navigation.js) */
export default function Gantt() {
  const { can } = useAccess()
  if (!can('thicong', 'tiendo') && !can('banlamviec', 'main')) {
    return (
      <PageShell title="Gantt Chart" subtitle="Biểu đồ tiến độ dự án">
        <div style={{ ...card, color: '#6b7280', fontSize: 14 }}>Tài khoản chưa được cấp quyền xem phần này. Nhờ quản trị viên cấp quyền.</div>
      </PageShell>
    )
  }
  return (
    <PageShell title="Gantt Chart" subtitle="Biểu đồ tiến độ dự án">
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Nhiệm vụ', 'Phụ trách', 'Bắt đầu', 'Kết thúc', 'Tiến độ'].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
                <td style={{ ...td, fontWeight: 500 }}>{t.name}</td>
                <td style={td}>{t.owner}</td>
                <td style={td}>{t.start}</td>
                <td style={td}>{t.end}</td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Bar pct={t.pct} />
                    <span style={{ fontSize: 12, color: '#6b7280', minWidth: 32 }}>{t.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
