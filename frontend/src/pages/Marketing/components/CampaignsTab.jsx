import { useState } from 'react'
import { STATUS_LABEL, STATUS_COLOR, STATUS_TINT, fmt, monthsBetween, campaignTotal } from '../../../data/marketingData'

export const MK_FONT = "var(--app-font, 'Montserrat'), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
export const kpiCard = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '17px 20px', display: 'flex', flexDirection: 'column', gap: 8 }
export const kpiLabel = { fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }
export const kpiSub = { fontSize: 12, color: 'var(--text-muted)' }
export const kpiGrid = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }

/* icon nét mảnh dùng chung cho các ô số / thẻ (kiểu QS) */
const IC = {
  list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></>,
  draft: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  money: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  mega: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  cal: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M16 2.5v4M8 2.5v4M3 10h18" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
}
export const Ic = ({ n, s = 16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{IC[n]}</svg>

/* ô số kiểu QS: ô icon nền nhạt + số đậm + nhãn nhỏ */
export function KpiTile({ icon, color = 'var(--marketing)', tint = 'var(--marketing-tint)', value, label, sub }) {
  return (
    <div className="mk-kpi2">
      <span className="ic" style={{ color, background: tint }}><Ic n={icon} s={18} /></span>
      <div className="t">
        <b style={{ color: color === 'var(--marketing)' ? 'var(--text)' : color }}>{value}</b>
        <span>{label}{sub ? <em> · {sub}</em> : null}</span>
      </div>
    </div>
  )
}

const LOC = [['', 'Tất cả'], ['active', 'Đang chạy'], ['draft', 'Bản nháp'], ['done', 'Đã hoàn tất']]

/* Tab "Chiến dịch" (kiểu QS): dải ô số có icon · module "Danh sách chiến dịch" (thanh tiêu đề: số đếm, lọc trạng thái, ô tìm) · lưới thẻ */
export default function CampaignsTab({ visible, catalog, campaigns, onOpenDetail }) {
  const [loc, setLoc] = useState('')
  const [q, setQ] = useState('')
  const dem = k => campaigns.filter(c => !k || c.status === k).length
  const tim = q.trim().toLowerCase()
  const ds = campaigns.filter(c => (!loc || c.status === loc) && (!tim || (c.name + ' ' + c.type + ' ' + c.client + ' ' + c.owner).toLowerCase().indexOf(tim) >= 0))
  const tongNS = campaigns.reduce((s, c) => s + campaignTotal(catalog, c), 0)
  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
      <div className="mk-kpi2-grid">
        <KpiTile icon="list" value={campaigns.length} label="Tổng chiến dịch" sub="đã khởi tạo" />
        <KpiTile icon="play" color="var(--success)" tint="var(--success-tint)" value={dem('active')} label="Đang chạy" sub="đã duyệt / triển khai" />
        <KpiTile icon="draft" color="var(--finance)" tint="var(--finance-tint)" value={dem('draft')} label="Bản nháp" sub="chờ duyệt ngân sách" />
        <KpiTile icon="money" value={fmt(tongNS)} label="Tổng ngân sách" sub="cộng dồn báo giá" />
      </div>

      <div className="mk-mod">
        <div className="mk-mod-h">
          <span className="mk-mod-ic"><Ic n="mega" /></span>
          <b>Danh sách chiến dịch</b><span className="mk-cnt">{campaigns.length}</span>
          <div className="mk-seg2" role="radiogroup" aria-label="Lọc trạng thái">
            {LOC.map(([k, nhan]) => (
              <button type="button" key={k || 'all'} role="radio" aria-checked={loc === k} className={loc === k ? 'on' : ''} onClick={() => setLoc(k)}>{nhan} <i>{dem(k)}</i></button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <label className="mk-search"><Ic n="search" s={14} /><input value={q} placeholder="Tìm chiến dịch, khách hàng, phụ trách…" onChange={e => setQ(e.target.value)} /></label>
        </div>
        {ds.length ? (
          <div className="mk-camp-grid">
            {ds.map(c => {
              const total = campaignTotal(catalog, c)
              const months = monthsBetween(c.start, c.end)
              return (
                <div className="mk-camp2" key={c.id} onClick={() => onOpenDetail(c.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpenDetail(c.id) }}>
                  <div className="hd">
                    <span className="ic"><Ic n="mega" /></span>
                    <div className="nm"><b>{c.name}</b><span>{c.type} · {c.client || 'Chưa có khách hàng'}</span></div>
                    <span className="st" style={{ background: STATUS_TINT[c.status], color: STATUS_COLOR[c.status] }}>{STATUS_LABEL[c.status]}</span>
                  </div>
                  <div className="bd">
                    <span><Ic n="cal" s={13} />{c.start || '—'} → {c.end || '—'} · {months} tháng</span>
                    <span><Ic n="user" s={13} />{c.owner || 'Chưa giao'}</span>
                    <span><Ic n="layers" s={13} />{c.items.filter(i => i.qty > 0).length} hạng mục</span>
                  </div>
                  <div className="ft"><span>Ngân sách</span><b>{fmt(total)}</b></div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mk-empty">{campaigns.length ? 'Không có chiến dịch khớp bộ lọc.' : 'Chưa có chiến dịch nào — bấm "Tạo chiến dịch" để khởi tạo và lập báo giá.'}</div>
        )}
      </div>
    </div>
  )
}
