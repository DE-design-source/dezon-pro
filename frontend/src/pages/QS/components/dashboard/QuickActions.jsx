import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { useQsCan } from '../../state/qsAccess'

/* Thao tác nhanh (port dashQuick_, PUB/dash.js:187-195); tab không được phép -> showTab tự chuyển tab hợp lệ đầu tiên */
const ACTIONS = [
  { key: 'muahang', label: 'Mua hàng', icon: 'cart' },
  { key: 'duan', label: 'SP trong dự án', icon: 'listLines' },
  { key: 'import', label: 'Nhập dữ liệu', icon: 'download' },
  { key: 'sanpham', label: 'Danh sách SP', icon: 'tag' },
]

export default function QuickActions() {
  const { navigate } = useQs()
  const qc = useQsCan()
  // N21: chỉ hiện lối tắt tới tab được xem; không còn lối nào thì ẩn cả thẻ
  const shown = ACTIONS.filter(a => qc(a.key, 'view'))
  if (!shown.length) return null
  return (
    <div className="qs-card">
      <div className="qs-dash-side-head"><Icon name="sliders" size={18} className="qs-dash-accent" /><h3 className="qs-dash-title">Thao tác nhanh</h3></div>
      <div className="qs-dash-quick">
        {shown.map(a => (
          <button key={a.key} type="button" className="qs-dash-quick-item" onClick={() => navigate(a.key)}>
            <Icon name={a.icon} size={20} className="qs-dash-accent" />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
