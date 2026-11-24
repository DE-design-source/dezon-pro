import { useEffect } from 'react'
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

/* Trang khách hàng dạng dashboard (thay CustomerPage): đầu trang tràn viền + lưới 2 cột (hẹp: 1 cột), xem layout2.css.
   Cột chính: [Hồ sơ | Cập nhật chăm sóc] (2 thẻ cùng hàng, cao bằng nhau), Chỉ số chính, Phân tích AI.
   Cột phụ: Việc tiếp theo, Danh sách Task, Phụ trách.
   Mỗi khối nhận {lead, me, interactions, onAddInteraction, onEdit, people}, tự tải dữ liệu thêm qua customerApi
   và báo nhau bằng emitLeadChange / useLeadChange.
   Esc = quay lại danh sách, trừ khi đang có hộp thoại ([role=dialog]), đang gõ trong ô nhập, hoặc một khối đang mở
   form tại chỗ (khối đặt thuộc tính data-cd-busy lên phần tử của form đó; Esc lúc ấy để khối tự xử lý).
   Bố cục mới không kéo dài thẻ bằng JS nữa (bỏ useAlignScore): không thẻ nào nhận style minHeight. */

const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export default function CustomerDashboard({ lead: l, me, interactions, onAddInteraction, onBack, onEdit, onMove, onSetCreated, onOpenNotif, onPatch }) {
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role=dialog]') || document.querySelector('.cd [data-cd-busy]') || typing(e.target)) return
      onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])
  if (!l) return null
  const people = [...new Set([me, l.manager, l.creator, ...(l.assignees || []).map(x => x && x.name)].map(x => String(x || '').trim()).filter(Boolean))]
  const bp = { lead: l, me, interactions: interactions || [], onAddInteraction, onEdit, people }
  return (
    <div className="cd cd2">
      <CdHeader lead={l} me={me} people={people} onBack={onBack} onMove={onMove} onOpenNotif={onOpenNotif} />
      {/* key = khách: đổi khách khi trang đang mở (bấm thông báo) thì các khối dựng lại, bỏ trạng thái của khách cũ */}
      <div className="cd-grid" key={String(l.id)}>
        <div className="cd-col cd-col-main">
          <div className="cd-pair">
            <CdProfile {...bp} onSetCreated={onSetCreated} />
            <CdCare {...bp} />
          </div>
          <CdScore {...bp} />
          <CdAi {...bp} />
        </div>
        <div className="cd-col cd-col-side">
          <CdNext {...bp} />
          <CdTasks {...bp} />
          <CdOwners {...bp} onPatch={onPatch} />
        </div>
      </div>
    </div>
  )
}
