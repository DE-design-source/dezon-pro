import { useEffect, useRef } from 'react'
import './customer.css'
import CdHeader from './CdHeader'
import CdProfile from './CdProfile'
import CdOwners from './CdOwners'
import CdCare from './CdCare'
import CdNext from './CdNext'
import CdTasks from './CdTasks'
import CdScore from './CdScore'
import CdAi from './CdAi'

/* Trang khách hàng dạng dashboard (thay CustomerPage): header + lưới 3 cột (hẹp: 2 rồi 1 cột).
   Cột 1: Hồ sơ, Phụ trách · Cột 2: Cập nhật chăm sóc, Việc tiếp theo, Danh sách Task · Cột 3: Chỉ số chính, Phân tích AI.
   Mỗi khối nhận {lead, me, interactions, onAddInteraction, onEdit, people}, tự tải dữ liệu thêm qua customerApi
   và báo nhau bằng emitLeadChange / useLeadChange.
   Esc = quay lại danh sách, trừ khi đang có hộp thoại ([role=dialog]), đang gõ trong ô nhập, hoặc một khối đang mở
   form tại chỗ (khối đặt thuộc tính data-cd-busy lên phần tử của form đó; Esc lúc ấy để khối tự xử lý). */
/* Lưới 3 cột: Chỉ số chính kéo dài cho khối AI (cột 3) bắt đầu ngang "Danh sách Task" (cột 2), không bao giờ đẩy Task xuống;
   AI chưa có phân tích thì cao bằng Task. Chỉ khi 2 cột đứng cạnh nhau (cùng mép trên); xếp 2 / 1 cột thì bỏ. */
function useAlignScore(ref) {
  useEffect(() => {
    const root = ref.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const col2 =root.querySelector('.cd-col2'), col3 = root.querySelector('.cd-col3')
        if (!col2 || !col3) return
        const c2 = col2.getBoundingClientRect(), c3 = col3.getBoundingClientRect()
        // 1) Phụ trách không kéo dài nữa: thẻ cao vừa nội dung, Việc tiếp theo / Danh sách Task xích lên ngay dưới
        const tasks = root.querySelector('.cd-tasks'), owners = root.querySelector('.cd-owners')
        if (owners && owners.style.minHeight) owners.style.minHeight = '' // bỏ chiều cao cũ còn sót (bản trước có kéo dài)
        // 2) Chỉ số chính thu gọn (thấp hơn cột 2): kéo dài cho khối AI bắt đầu ngang Danh sách Task.
        //    Chỉ số chính mở rộng (cao hơn cột 2): Danh sách Task giữ nguyên chỗ (không đẩy xuống), AI nằm dưới Chỉ số chính.
        //    Chỉnh dần từ giá trị đang đặt (không xoá rồi đo lại) để không giật với phần tự lấp tiêu chí của CdScore.
        const score = root.querySelector('.cd-score'), ai = root.querySelector('.cd-ai')
        const side = Math.abs(c2.top - c3.top) < 2 && c3.left >= c2.right - 1
        if (tasks && tasks.style.marginTop) tasks.style.marginTop = '' // bản trước có đẩy Task xuống
        if (score && ai && tasks) {
          let minH = parseFloat(score.style.minHeight) || 0
          if (!side) minH = 0
          else {
            const d = Math.round(ai.getBoundingClientRect().top - tasks.getBoundingClientRect().top)
            const sh = score.getBoundingClientRect().height
            const bound = minH > 0 && sh <= minH + 1 // minHeight đang quyết định chiều cao Chỉ số chính
            if (d > 1 && bound) minH = Math.max(0, minH - d)
            else if (d < -1) minH = Math.round(sh - d)
          }
          const v = minH > 0 ? Math.round(minH) + 'px' : ''
          if (score.style.minHeight !== v) score.style.minHeight = v
        }
        // 3) Khối AI chưa có phân tích: cao bằng Danh sách Task (khi 2 cột đứng cạnh nhau) cho 2 thẻ bằng nhau
        if (ai && tasks) {
          const va = ai.classList.contains('is-empty') && side ? Math.round(tasks.getBoundingClientRect().height) + 'px' : ''
          if (ai.style.minHeight !== va) ai.style.minHeight = va
        }
      })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(root)
    root.querySelectorAll('.cd-col1 > *, .cd-col2 > *, .cd-col3 > *').forEach(el => ro.observe(el))
    // thẻ trong cột 2 / 3 có thể dựng lại (đổi khách, tải xong) -> theo dõi lại
    const mo = new MutationObserver(() => { root.querySelectorAll('.cd-col1 > *, .cd-col2 > *, .cd-col3 > *').forEach(el => ro.observe(el)); fit() })
    mo.observe(root, { childList: true, subtree: true })
    fit()
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect() }
  }, [ref])
}

const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export default function CustomerDashboard({ lead: l, me, interactions, onAddInteraction, onBack, onEdit, onMove, onSetCreated, onOpenNotif, onPatch }) {
  const gridRef = useRef(null)
  useAlignScore(gridRef)
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
    <div className="cd">
      <CdHeader lead={l} me={me} people={people} onBack={onBack} onMove={onMove} onOpenNotif={onOpenNotif} />
      {/* key = khách: đổi khách khi trang đang mở (bấm thông báo) thì các khối dựng lại, bỏ trạng thái của khách cũ */}
      <div className="cd-grid" data-g2="1" key={String(l.id)} ref={gridRef}>
        <div className="cd-col cd-col1">
          <CdProfile {...bp} onSetCreated={onSetCreated} />
          <CdCare {...bp} />
        </div>
        <div className="cd-col cd-col2">
          <CdOwners {...bp} onPatch={onPatch} />
          <CdNext {...bp} />
          <CdTasks {...bp} />
        </div>
        <div className="cd-col cd-col3">
          <CdScore {...bp} />
          <CdAi {...bp} />
        </div>
      </div>
    </div>
  )
}
