import PageShell from '../../components/layout/PageShell'
import { useAccess } from '../../services/accessService'

const PRIORITY = {
  Cao: { bg: '#fee2e2', color: '#dc2626' },
  TB:  { bg: '#fef3c7', color: '#d97706' },
  Thấp: { bg: '#d1fae5', color: '#059669' },
}

const columns = [
  {
    title: 'Cần làm',
    color: '#6366f1',
    cards: [
      { title: 'Thiết kế logo mới', assignee: 'Nguyễn A', priority: 'Cao' },
      { title: 'Viết tài liệu API', assignee: 'Trần B',   priority: 'TB'  },
      { title: 'Phân tích yêu cầu',assignee: 'Lê C',     priority: 'Thấp'},
    ],
  },
  {
    title: 'Đang làm',
    color: '#f59e0b',
    cards: [
      { title: 'Phát triển màn hình đăng nhập', assignee: 'Phạm D', priority: 'Cao' },
      { title: 'Cấu hình CI/CD',                assignee: 'Hoàng E', priority: 'TB' },
    ],
  },
  {
    title: 'Hoàn thành',
    color: '#10b981',
    cards: [
      { title: 'Kick-off dự án',     assignee: 'Nguyễn A', priority: 'TB'  },
      { title: 'Thiết lập kho lưu trữ', assignee: 'Trần B', priority: 'Thấp'},
    ],
  },
]

const col = {
  flex: '1 1 0',
  minWidth: 220,
  background: '#f9fafb',
  borderRadius: 10,
  padding: 16,
}

const cardStyle = {
  background: '#fff',
  borderRadius: 8,
  padding: '12px 14px',
  marginTop: 10,
  boxShadow: '0 1px 3px rgba(0,0,0,.07)',
}

/* Phân quyền N21: xem Bàn làm việc hoặc Lịch (giống quyền route /nhiem-vu trong data/navigation.js) */
export default function NhiemVu() {
  const { can } = useAccess()
  if (!can('banlamviec', 'main') && !can('lich', 'main')) {
    return (
      <PageShell title="Nhiệm vụ" subtitle="Quản lý việc cần làm">
        <div style={{ ...cardStyle, marginTop: 0, color: '#6b7280', fontSize: 14 }}>Tài khoản chưa được cấp quyền xem phần này. Nhờ quản trị viên cấp quyền.</div>
      </PageShell>
    )
  }
  return (
    <PageShell title="Nhiệm vụ" subtitle="Quản lý việc cần làm">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {columns.map(col_ => (
          <div key={col_.title} style={col}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: col_.color, display: 'inline-block' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{col_.title}</span>
              <span style={{ marginLeft: 'auto', background: '#e5e7eb', borderRadius: 12, padding: '1px 8px', fontSize: 12, color: '#6b7280' }}>{col_.cards.length}</span>
            </div>
            {col_.cards.map((c, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', marginBottom: 8 }}>{c.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{c.assignee}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '2px 8px', background: PRIORITY[c.priority].bg, color: PRIORITY[c.priority].color }}>{c.priority}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  )
}
