import { useState } from 'react'
import { Icon, SectionHead, StatusBadge, useFlash } from './shared'
import { useAccess } from '../../../services/accessService'

function DataRow({ label, value, last, strong, padding }) {
  return (
    <div className="bim-data-row" style={{ padding, ...(last ? { borderBottom: 'none' } : {}) }}>
      <span style={{ flex: 1, fontSize: strong ? 13.5 : 13, ...(strong ? { fontWeight: 700 } : { color: 'var(--text-muted)' }) }}>{label}</span>
      <span className="mono" style={{ fontWeight: strong ? 800 : 700, ...(strong ? { fontSize: 15 } : {}) }}>{value}</span>
    </div>
  )
}

export default function BoqTab() {
  const { can } = useAccess()
  const [reloading, reload] = useFlash(700)
  const [generating, generate] = useFlash(900)
  const [updated, setUpdated] = useState(false)

  return (
    <>
      <SectionHead eyebrow="BOQ" title="Thiết lập báo cáo" desc="Chỉ liệt kê object đã gán Product và vật liệu đã liên kết danh mục.">
        <button className="bim-btn-ghost" onClick={() => reload()}>
          {reloading ? 'Đang tải lại...' : <><Icon name="refresh" />Tải lại dữ liệu</>}
        </button>
      </SectionHead>
      <div className="bim-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="bim-field"><label>Loại BOQ</label>
            <select><option>Object Product BOQ</option><option>Object Material BOQ</option><option>Room Finish BOQ</option></select>
          </div>
          <div className="bim-field"><label>Pricing policy</label>
            <select><option>Giá dự toán Q3/2026 · Rev 04</option><option>Giá dự toán Q2/2026 · Rev 03</option><option>Giá thầu phụ · Rev 01</option></select>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <DataRow label="Objects đủ dữ liệu" value="12.682 / 12.846" padding="10px 4px" />
          <DataRow label="Product có đơn giá" value="74 / 81" padding="10px 4px" />
          <DataRow label="Mức VAT" value="8%" padding="10px 4px" last />
        </div>
        {can('bim', 'main', 'edit') && (
          <button className="bim-btn-dark" onClick={() => generate(() => setUpdated(true))}>
            <Icon html={'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'} size={15} stroke="#fff" />
            <span>{generating ? 'Đang tạo bảng...' : 'Tạo / Cập nhật bảng'}</span>
          </button>
        )}
        <button className="bim-btn-ghost" onClick={() => alert('Bảng BOQ rời sẽ mở trong Dezon Bim Workspace (trình duyệt).')}>
          <Icon html={'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'} size={15} />
          Mở bảng BOQ rời
        </button>
      </div>
      <div className="bim-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--success-tint)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Icon html={'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'} size={18} sw={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>BOQ thiết kế kỹ thuật</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>126 dòng · VND</div>
          </div>
          <StatusBadge color="success">{updated ? '● Vừa cập nhật' : '● Dữ liệu mới'}</StatusBadge>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <DataRow label="Trước VAT" value="16,75 tỷ" padding="9px 4px" />
          <DataRow label="VAT 8%" value="1,34 tỷ" padding="9px 4px" />
          <DataRow label="Sau VAT" value="18,09 tỷ" padding="9px 4px" last strong />
        </div>
      </div>
    </>
  )
}
