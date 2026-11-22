import { useEffect, useState } from 'react'
import { STAGES, STAGE_LABEL } from '../../../../data/kinhDoanhData'
import { useKdMap } from '../ShortlistSelect'
import { RatingStars } from '../CustomerPage'
import { fmtTy, lmInitials, phoneNorms } from '../../utils'
import { notifCount } from '../../../QS/api/qsApi'
import { isAbort } from '../../../QS/api/http'
import { leadOwner, fmtSince } from './CdOwners'

/* Header trang khách hàng dạng dashboard: tên, tóm tắt, Mức độ (sao), người phụ trách chính, giai đoạn + dải 9 bước,
   số thông báo chưa đọc, Đặt lịch hẹn / Gọi khách / Nhắn tin Zalo.
   Chuông thật nằm ở header trang Kinh doanh (KinhDoanh.jsx, NotifBell tự hỏi lại 30 s): ở đây chỉ đọc số chưa đọc 1 lần
   khi mở khách, bấm thì mở chuông đó.
   "Đặt lịch hẹn" phát sự kiện window 'kd:open-appt' {detail: {leadId: String}}; khối Việc tiếp theo (CdNext) nghe sự kiện
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

export default function CdHeader({ lead: l, onBack, onMove }) {
  const geoMap = useKdMap('geo')
  const projNameMap = useKdMap('projName')
  const id = String(l.id)
  const geo = geoMap[id] || {}
  const region = geo.tinh || geo.kv || ''
  const title = projNameMap[id] || l.name
  const sub = [[l.projectType || l.type, l.scale].filter(Boolean).join(' '), l.value > 0 ? fmtTy(l.value) : '', region].filter(Boolean).join(' · ')
  const owner = leadOwner(l)
  const cur = FLOW.indexOf(l.stage)
  const n = daysSince(l.stageChangedAt || l.updatedAt)
  /* phoneNorms không nhận dạng được (số nước ngoài, số lẻ) -> gọi thẳng chữ số đã gõ */
  const phone = phoneNorms(l.phone)[0] || String(l.phone || '').replace(/[^\d+]/g, '')
  const openAppt = () => { try { window.dispatchEvent(new CustomEvent(OPEN_APPT_EVENT, { detail: { leadId: id } })) } catch { /* bỏ qua */ } }
  return (
    <div className="cd-head">
      <button type="button" className="cd-back" onClick={onBack} title="Quay lại danh sách khách hàng (Esc)" aria-label="Quay lại"><Ic d="M15 5l-7 7 7 7" w={2.4} /></button>
      <div className="cd-h-id">
        <span className="cd-h-name" title={title !== l.name ? 'Khách hàng: ' + l.name : l.name}>{title}</span>
        {sub && <span className="cd-h-sub">{sub}</span>}
        <span className="cd-h-rate"><span>Mức độ</span><RatingStars id={id} /></span>
      </div>
      {owner && (
        <div className="cd-h-owner">
          <span className="cd-av lead">{lmInitials(owner.name)}</span>
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
              onClick={() => onMove(l.id, s)} title={'Chuyển sang "' + STAGE_LABEL[s] + '"'}>
              {i < FLOW.length - 1 && <i className="cd-step-line" />}
              <span className="cd-step-dot">{i < cur ? '✓' : i + 1}</span>
              <span className="cd-step-lbl">{SHORT[s] || STAGE_LABEL[s]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cd-h-acts">
        <NotifBadge leadId={id} />
        <button type="button" className="cd-hbtn" onClick={openAppt} title="Hẹn gặp khách: thời gian, địa điểm, nội dung">Đặt lịch hẹn</button>
        {phone
          ? <a className="cd-hbtn call" href={'tel:' + phone} title={'Gọi ' + phone}>Gọi khách</a>
          : <button type="button" className="cd-hbtn call" disabled title="Khách chưa có số điện thoại">Gọi khách</button>}
        {phone
          ? <a className="cd-hbtn zalo" href={'https://zalo.me/' + phone} target="_blank" rel="noopener noreferrer" title={'Zalo ' + phone}>Nhắn tin Zalo</a>
          : <button type="button" className="cd-hbtn zalo" disabled title="Khách chưa có số điện thoại">Nhắn tin Zalo</button>}
      </div>
    </div>
  )
}
