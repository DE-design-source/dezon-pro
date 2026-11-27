import { useEffect, useState } from 'react'
import './customer.css'
import './layout2.css'
import CdHeader from './CdHeader'
import CdProfile from './CdProfile'
import CdOwners from './CdOwners'
import CdCare from './CdCare'
import CdNext from './CdNext'
import CdTasks from './CdTasks'
import CdScore from './CdScore'
import CdAi from './CdAi'
import CdAiChat from './CdAiChat'
import CdLive, { readLiveDraft } from './CdLive'
import CdRecordings from './CdRecordings'

/* Trang khách hàng dạng dashboard (thay CustomerPage): đầu trang tràn viền + lưới 2 cột (hẹp: 1 cột), xem layout2.css.
   Cột chính: [Hồ sơ | Cập nhật chăm sóc] (2 thẻ cùng hàng, cao bằng nhau), Chỉ số chính, Phân tích AI.
   Cột phụ: Việc tiếp theo, Danh sách Task, Phụ trách.
   Mỗi khối nhận {lead, me, interactions, onAddInteraction, onEdit, people}, tự tải dữ liệu thêm qua customerApi
   và báo nhau bằng emitLeadChange / useLeadChange.
   Esc = quay lại danh sách, trừ khi đang có hộp thoại ([role=dialog]), đang gõ trong ô nhập, hoặc một khối đang mở
   form tại chỗ (khối đặt thuộc tính data-cd-busy lên phần tử của form đó; Esc lúc ấy để khối tự xử lý).
   Bố cục mới không kéo dài thẻ bằng JS nữa (bỏ useAlignScore): không thẻ nào nhận style minHeight.
   Nút Live ở phần AI mở khối CdLive (ghi lại cuộc trò chuyện) dưới Hỏi AI; khách còn bản ghi Live dở thì tự mở lại.
   Ngay dưới (Live / Hỏi AI) là khối CdRecordings "Hội thoại đã ghi" (ẩn khi khách chưa có hội thoại nào).
   readOnly (N21: không có quyền Sửa ở Kinh doanh > Pipeline): các khối ẩn nút sửa / thêm / xoá, không có nút Live, ẩn khối Hỏi AI
   (máy chủ chặn hỏi AI khi thiếu quyền Sửa). Không có onAddInteraction (thiếu quyền Thêm): Cập nhật chăm sóc chỉ xem, không có Live. */

const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export default function CustomerDashboard({ lead: l, me, interactions, onAddInteraction, onBack, onEdit, onMove, onSetCreated, onOpenNotif, onPatch, readOnly }) {
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role=dialog]') || document.querySelector('.cd [data-cd-busy]') || typing(e.target)) return
      onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])
  const lid = l ? String(l.id) : ''
  // đổi khách: chỉ mở sẵn Live khi khách đó còn bản ghi dở của chính người này (mở tạm dừng, không tự bật micro)
  const [liveId, setLiveId] = useState(() => (lid && readLiveDraft(lid, me) ? lid : ''))
  useEffect(() => { setLiveId(lid && readLiveDraft(lid, me) ? lid : '') }, [lid]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null
  const canAdd = !readOnly && !!onAddInteraction   // ghi tương tác / lưu bản ghi Live: máy chủ cần quyền Thêm
  const live = canAdd && liveId === lid
  const people = [...new Set([me, l.manager, l.creator, ...(l.assignees || []).map(x => x && x.name)].map(x => String(x || '').trim()).filter(Boolean))]
  const bp = { lead: l, me, interactions: interactions || [], onAddInteraction: readOnly ? undefined : onAddInteraction, onEdit: readOnly ? undefined : onEdit, people, readOnly: !!readOnly }
  return (
    <div className="cd cd2">
      <CdHeader lead={l} me={me} people={people} onBack={onBack} onMove={onMove} onOpenNotif={onOpenNotif} readOnly={!!readOnly} />
      {/* key = khách: đổi khách khi trang đang mở (bấm thông báo) thì các khối dựng lại, bỏ trạng thái của khách cũ */}
      <div className="cd-grid" key={String(l.id)}>
        <div className="cd-col cd-col-main">
          <div className="cd-pair">
            <CdProfile {...bp} onSetCreated={readOnly ? undefined : onSetCreated} />
            <CdCare {...bp} readOnly={!canAdd} />
          </div>
          <CdScore {...bp} />
          <CdAi {...bp} live={live} onLive={!canAdd ? undefined : () => {
            if (!live) { setLiveId(lid); return }
            const el = document.querySelector('.cd2 .cd-live')
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }} />
        </div>
        <div className={'cd-col cd-col-side' + (live ? ' live' : '')}>
          <CdNext {...bp} />
          <CdTasks {...bp} />
          <CdOwners {...bp} onPatch={readOnly ? undefined : onPatch} />
          {!readOnly && <CdAiChat {...bp} />}
          {live && <CdLive {...bp} onClose={() => setLiveId(v => (v === lid ? '' : v))} />}
          <CdRecordings {...bp} />
        </div>
      </div>
    </div>
  )
}
