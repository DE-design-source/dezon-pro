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
/* Lưới 3 cột: Phụ trách kéo dài cho đáy cột 2 bằng đáy Hồ sơ; Chỉ số chính kéo dài cho khối AI bắt đầu
   ngang thẻ "Danh sách Task". Chỉ khi 2 cột đứng cạnh nhau (cùng mép trên); xếp 2 / 1 cột thì bỏ. */
function useAlignScore(ref) {
  useEffect(() => {
    const root = ref.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const fit = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const col1 = root.querySelector('.cd-col1'), col2 = root.querySelector('.cd-col2'), col3 = root.querySelector('.cd-col3')
        if (!col2 || !col3) return
        const c2 = col2.getBoundingClientRect(), c3 = col3.getBoundingClientRect()
        // 1) Phụ trách (đầu cột 2) kéo dài cho đáy cột 2 (Danh sách Task) bằng đáy Hồ sơ khách hàng (cột 1)
        const prof = root.querySelector('.cd-profile'), owners = root.querySelector('.cd-owners'), tasks = root.querySelector('.cd-tasks')
        if (col1 && prof && owners && tasks) {
          const c1 = col1.getBoundingClientRect()
          const side1 = Math.abs(c1.top - c2.top) < 2 && c2.left >= c1.right - 1
          const h = Math.round(owners.getBoundingClientRect().height + prof.getBoundingClientRect().bottom - tasks.getBoundingClientRect().bottom)
          const vo = side1 && h > 0 ? h + 'px' : ''
          if (owners.style.minHeight !== vo) owners.style.minHeight = vo
        }
        // 2) Sau khi cột 2 đã đổi (đọc lại vị trí): Chỉ số chính kéo dài cho khối AI (cột 3) bắt đầu ngang Danh sách Task
        const score = root.querySelector('.cd-score'), ai = root.querySelector('.cd-ai')
        if (score && ai && tasks) {
          const side = Math.abs(c2.top - c3.top) < 2 && c3.left >= c2.right - 1
          const want = side ? Math.round(score.getBoundingClientRect().height + tasks.getBoundingClientRect().top - ai.getBoundingClientRect().top) : 0
          const v = want > 0 ? want + 'px' : ''
          if (score.style.minHeight !== v) score.style.minHeight = v
        }
        // 3) Khối AI chưa có phân tích: cao bằng Danh sách Task (cùng hàng) cho 2 thẻ bằng nhau
        if (ai && tasks) {
          const same = Math.abs(ai.getBoundingClientRect().top - tasks.getBoundingClientRect().top) < 3
          const va = ai.classList.contains('is-empty') && same ? Math.round(tasks.getBoundingClientRect().height) + 'px' : ''
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

export default function CustomerDashboard({ lead: l, me, interactions, onAddInteraction, onBack, onEdit, onMove, onSetCreated, onOpenNotif }) {
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
          <CdOwners {...bp} />
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
