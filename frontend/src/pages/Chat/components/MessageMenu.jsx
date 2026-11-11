import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { serverNow } from '../api/chatApi'
import { canCopyMsg, canEditMsg, canForwardMsg, canReactMsg, canRecallMsg, canReplyMsg } from './msgActionUtil'
import './MessageActions.css'

const Ico = ({ d }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const ICONS = {
  react: <Ico d={<><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" /><line x1="9" y1="9.5" x2="9.01" y2="9.5" /><line x1="15" y1="9.5" x2="15.01" y2="9.5" /></>} />,
  reply: <Ico d={<><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>} />,
  forward: <Ico d={<><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></>} />,
  copy: <Ico d={<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />,
  edit: <Ico d={<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>} />,
  recall: <Ico d={<><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /></>} />,
  pin: <Ico d={<path d="M12 2a1 1 0 0 1 1 1v7l3 4v2H8v-2l3-4V3a1 1 0 0 1 1-1zM12 16v6" />} />,
}

/* Menu thao tác trên một tin (bấm "⋯" hoặc chuột phải / giữ lâu). Ẩn mục theo cùng luật với máy chủ (msgActionUtil);
   handler vắng = hội thoại không cho thao tác đó (đã rời, giải tán, bị chặn, chỉ trưởng / phó nhóm gửi tin...) -> ẩn mục.
   onRecall do Thread hỏi lại trước khi gọi máy chủ. */
export default function MessageMenu({ message, meId, conv, myRole, senderRole, pinned, canPin, onReply, onForward, onEdit, onRecall, onCopy, onPin, onUnpin, onReact, onClose }) {
  const ref = useRef(null)
  const [up, setUp] = useState(false)

  useEffect(() => {
    /* Nút mở menu (data-msg-menu-trigger) tự bật / tắt menu: không tính là bấm ngoài */
    const onDown = e => {
      if (!ref.current || ref.current.contains(e.target)) return
      if (e.target.closest && e.target.closest('[data-msg-menu-trigger]')) return
      onClose()
    }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /* Tin ở cuối khung: mở menu lên trên cho khỏi bị cắt */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = el.closest('.ch-thread-messages')
    const r = el.getBoundingClientRect()
    const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight
    if (r.bottom > bottom - 4) setUp(true)
  }, [])

  const m = message
  const now = serverNow()
  const items = []
  const add = (key, label, fn, danger) => items.push({ key, label, fn, danger })
  if (onReact && canReactMsg(m)) add('react', 'Thả cảm xúc', onReact)
  if (onReply && canReplyMsg(m)) add('reply', 'Trả lời', onReply)
  if (onForward && canForwardMsg(m)) add('forward', 'Chuyển tiếp', onForward)
  if (onCopy && canCopyMsg(m)) add('copy', 'Sao chép', onCopy)
  if (onEdit && canEditMsg(m, meId, now)) add('edit', 'Chỉnh sửa', onEdit)
  if (onRecall && canRecallMsg(m, meId, myRole, senderRole, conv && conv.type, now)) add('recall', 'Thu hồi', onRecall, true)
  if (canPin && !m.recalled) {
    if (pinned && onUnpin) add('pin', 'Bỏ ghim', onUnpin)
    else if (!pinned && onPin) add('pin', 'Ghim', onPin)
  }

  return (
    <div ref={ref} className={'ch-msg-menu' + (up ? ' up' : '')} role="menu" aria-label="Thao tác với tin nhắn">
      {items.length ? items.map(it => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          className={'ch-msg-menu-item' + (it.danger ? ' danger' : '')}
          onClick={() => {
            /* Thả cảm xúc: Thread thay menu bằng bảng chọn cảm xúc, không đóng ở đây */
            if (it.key !== 'react') onClose()
            it.fn()
          }}
        >
          {ICONS[it.key]}<span>{it.label}</span>
        </button>
      )) : <div className="ch-msg-menu-empty">Không có thao tác nào</div>}
    </div>
  )
}
