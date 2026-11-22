import { STATUS_LABEL, STATUS_COLOR, STATUS_TINT, fmt, monthsBetween, campaignTotal } from '../../../data/marketingData'
import { MK_FONT, kpiCard, kpiLabel, kpiGrid } from './CampaignsTab'
import QuoteBlock from './QuoteBlock'

/* Trang chi tiết chiến dịch (nguyên trang) — openCampaignDetail của bản HTML */
/* N21: canEdit = quyền Sửa ở Marketing > Chiến dịch; không có onViewQuote (không xem được Báo giá) -> ẩn nút */
export default function CampaignDetail({ visible, catalog, camp, onBack, onViewQuote, canEdit }) {
  const months = camp ? monthsBetween(camp.start, camp.end) : 1
  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      <button type="button" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0, width: 'fit-content' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        Quay lại danh sách chiến dịch
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: MK_FONT, fontWeight: 800, fontSize: 21 }}>{camp && camp.name}</h2>
            <span style={{ flex: 'none', padding: '4px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: camp ? STATUS_TINT[camp.status] : undefined, color: camp ? STATUS_COLOR[camp.status] : undefined }}>{camp && STATUS_LABEL[camp.status]}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{camp && (camp.type + ' · ' + camp.client)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
          {canEdit && <button
            type="button"
            onClick={() => alert('Mở form chỉnh sửa chiến dịch "' + (camp || {}).name + '" (demo).')}
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Chỉnh sửa</button>}
          {onViewQuote && <button type="button" onClick={onViewQuote} style={{ border: 'none', background: 'var(--marketing)', color: '#fff', padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Xem báo giá</button>}
        </div>
      </div>

      <div style={kpiGrid}>
        <div style={kpiCard}>
          <div style={kpiLabel}>Thời gian triển khai</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{camp && ((camp.start || '—') + ' → ' + (camp.end || '—') + ' (' + months + ' tháng)')}</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Người phụ trách</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{camp && camp.owner}</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Hạng mục đã chọn</div>
          <div style={{ fontWeight: 800, fontSize: 26 }}>{camp && camp.items.filter(i => i.qty > 0).length}</div>
        </div>
        <div style={kpiCard}>
          <div style={kpiLabel}>Tổng chi phí dự kiến</div>
          <div className="mono" style={{ fontWeight: 800, fontSize: 22, color: 'var(--marketing)' }}>{camp && fmt(campaignTotal(catalog, camp))}</div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', marginBottom: 8 }}>Ghi chú chiến dịch</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{camp && (camp.notes || 'Chưa có ghi chú cho chiến dịch này.')}</div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Chi tiết hạng mục chi phí</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {camp && <QuoteBlock catalog={catalog} camp={camp} vat={false} />}
        </div>
      </div>
    </div>
  )
}
