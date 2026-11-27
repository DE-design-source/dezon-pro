import { useEffect, useState } from 'react'
import { STAGES, STAGE_LABEL } from '../../../../data/kinhDoanhData'
import { useKdMap } from '../ShortlistSelect'
import { RatingStars } from '../CustomerPage'
import { fmtTy, phoneNorms } from '../../utils'
import { notifCount } from '../../../QS/api/qsApi'
import { isAbort } from '../../../QS/api/http'
import { leadOwner, fmtSince } from './CdOwners'

/* Header trang khách hàng dạng dashboard (dải tràn viền nền gradient, CSS .cd-h-* trong customer.css):
   tên, tóm tắt, Mức độ (sao), Quản lý / người phụ trách chính (chỉ chữ, viền trái mờ), giai đoạn + dải 9 bước,
   số thông báo chưa đọc, Nhắn tin Zalo (bỏ nút Đặt lịch hẹn / Gọi khách, MarkUp 2026-11-25).
   Chuông thật nằm ở header trang Kinh doanh (KinhDoanh.jsx, NotifBell tự hỏi lại 30 s): ở đây chỉ đọc số chưa đọc 1 lần
   khi mở khách, bấm thì mở chuông đó.
   OPEN_APPT_EVENT (giữ cho nơi khác dùng): sự kiện window 'kd:open-appt' {detail: {leadId: String}}; khối Việc tiếp theo (CdNext) nghe sự kiện
   này để mở hộp đặt lịch hẹn mới cho đúng khách. */
export const OPEN_APPT_EVENT = 'kd:open-appt'
const FLOW = STAGES.filter(s => s !== 'khong-tham-gia' && s !== 'truot-thau' && s !== 'spam')
const SHORT = {
  'tiep-can': 'Tiếp cận', 'giao-ns': 'NV KD phụ trách', 'tu-van': 'Tư vấn (Concept)', 'bao-gia': 'Báo giá TK', 'dam-phan': 'Đàm phán',
  'chot-hd': 'Chốt hợp đồng', 'bao-gia-thi-cong': 'Báo giá TC', 'thiet-ke': 'Dự án (TK)', 'thi-cong': 'Dự án (TC)',
}
const TERMINAL = { 'truot-thau': 'Đã trượt thầu', spam: 'Spam', 'khong-tham-gia': 'Không tham gia' }
const ddmm = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] : '' }
const daysSince = v => {
  if (!v) return null
  const d = new Date(v)
  if (isNaN(d)) return null
  const a = new Date(); a.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((a - d) / 86400000))
}
const Ic = ({ d, size = 14, w = 2 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>

/* Mở chuông ở header trang (CdHeader không còn render NotifBell nên .nb-btn đầu tiên là chuông của trang) */
const openPageBell = () => {
  const b = document.querySelector('.nb > .nb-btn')
  if (!b) return
  try { b.scrollIntoView({ block: 'nearest' }) } catch { /* bỏ qua */ }
  b.click()
}

function NotifBadge({ leadId }) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    const ac = new AbortController()
    notifCount(ac.signal).then(c => setUnread((c && c.unread) || 0), e => { if (!isAbort(e)) setUnread(0) })
    return () => ac.abort()
  }, [leadId])
  if (!unread) return null
  return (
    <button type="button" className="cd-h-notif" onClick={openPageBell} title={unread + ' thông báo chưa đọc - mở chuông thông báo'} aria-label={unread + ' thông báo chưa đọc'}>
      <Ic d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <span>{unread > 99 ? '99+' : unread}</span>
    </button>
  )
}

/* readOnly (N21: không có quyền Sửa): sao Mức độ chỉ xem, các bước giai đoạn không bấm chuyển được */
export default function CdHeader({ lead: l, onBack, onMove, readOnly }) {
  const geoMap = useKdMap('geo')
  const projNameMap = useKdMap('projName')
  const id = String(l.id)
  /* Sao chép link riêng của khách (/kinh-doanh/<mã khách>) để gửi nhân viên */
  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    const url = window.location.origin + '/kinh-doanh/' + encodeURIComponent(id)
    let ok = false
    try { await navigator.clipboard.writeText(url); ok = true } catch {
      try { const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove() } catch { ok = false }
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) } else window.prompt('Sao chép link khách hàng:', url)
  }
  const geo = geoMap[id] || {}
  const region = geo.tinh || geo.kv || ''
  const title = projNameMap[id] || l.name
  const sub = [[l.projectType || l.type, l.scale].filter(Boolean).join(' '), l.value > 0 ? fmtTy(l.value) : '', region].filter(Boolean).join(' · ')
  const owner = leadOwner(l)
  const mgrName = String(l.manager || '').trim()
  const cur = FLOW.indexOf(l.stage)
  const n = daysSince(l.stageChangedAt || l.updatedAt)
  /* phoneNorms không nhận dạng được (số nước ngoài, số lẻ) -> gọi thẳng chữ số đã gõ */
  const phone = phoneNorms(l.phone)[0] || String(l.phone || '').replace(/[^\d+]/g, '')
  return (
    <div className="cd-head">
      <button type="button" className="cd-back" onClick={onBack} title="Quay lại danh sách khách hàng (Esc)" aria-label="Quay lại"><Ic d="M15 5l-7 7 7 7" w={2.4} /></button>
      <div className="cd-h-id">
        <span className="cd-h-name" title={title !== l.name ? 'Khách hàng: ' + l.name : l.name}>{title}</span>
        {sub && <span className="cd-h-sub">{sub}</span>}
        <span className="cd-h-rate"><span>Mức độ</span><RatingStars id={id} readOnly={readOnly} /></span>
      </div>
      {/* Có Quản lý: hiện tên Quản lý, dòng dưới là những người phụ trách; chưa có Quản lý: người phụ trách chính như cũ */}
      {mgrName ? (
        <div className="cd-h-owner" title={'Quản lý: ' + mgrName}>
          <span className="cd-h-owner-t">
            <span>Quản lý</span>
            <b>{mgrName}</b>
          </span>
        </div>
      ) : owner && (
        <div className="cd-h-owner" title={'Phụ trách: ' + owner.name}>
          <span className="cd-h-owner-t">
            <span>Phụ trách</span>
            <b>{owner.name}</b>
            <span>{[owner.role, owner.since ? 'từ ' + fmtSince(owner.since) : ''].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      )}
      <div className="cd-h-stage">
        <div className="cd-h-stage-t">
          <b>{STAGE_LABEL[l.stage] || l.stage}</b>
          {TERMINAL[l.stage] && <span className="cd-h-lost">{TERMINAL[l.stage]}</span>}
          <span>{[n != null ? 'Đã ở giai đoạn này ' + n + ' ngày' : '', l.createdAt ? 'tạo ' + ddmm(l.createdAt) : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="cd-steps">
          {FLOW.map((s, i) => (
            <button key={s} type="button" className={'cd-step' + (i < cur ? ' done' : '') + (i === cur ? ' now' : '')}
              onClick={readOnly ? undefined : () => onMove(l.id, s)} disabled={readOnly} title={readOnly ? STAGE_LABEL[s] : 'Chuyển sang "' + STAGE_LABEL[s] + '"'}>
              {i < FLOW.length - 1 && <i className="cd-step-line" />}
              <span className="cd-step-dot">{i < cur ? '✓' : i + 1}</span>
              <span className="cd-step-lbl">{SHORT[s] || STAGE_LABEL[s]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cd-h-acts">
        <NotifBadge leadId={id} />
        <button type="button" className="cd-hbtn" onClick={copyLink} title={'Sao chép link khách này để gửi nhân viên: ' + window.location.origin + '/kinh-doanh/' + id}>{copied ? 'Đã chép link' : 'Sao chép link'}</button>
        {phone
          ? <a className="cd-hbtn zalo" href={'https://zalo.me/' + phone} target="_blank" rel="noopener noreferrer" title={'Zalo ' + phone}>Nhắn tin Zalo</a>
          : <button type="button" className="cd-hbtn zalo" disabled title="Khách chưa có số điện thoại">Nhắn tin Zalo</button>}
      </div>
    </div>
  )
}
