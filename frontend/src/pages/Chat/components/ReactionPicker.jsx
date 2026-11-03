import { useEffect, useRef } from 'react'
import { REACTIONS } from './reactionUtil'
import './Reaction.css'

/* Bảng chọn nhanh 6 cảm xúc. Vị trí: khung cha đặt position: relative, bảng nằm ngay trên (align 'left' | 'right').
   Bấm ngoài / Esc -> onClose. Nút mở bảng nên gắn data-reaction-trigger để lần bấm mở / đóng không bị tính là bấm ngoài.
   onPick(code): code trùng `mine` nghĩa là bỏ cảm xúc (chatStore.toggleReaction tự xử lý) */
export default function ReactionPicker({ mine, onPick, onClose, align = 'left' }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const el = ref.current
    if (el) {
      const first = el.querySelector('.ch-react-opt.mine') || el.querySelector('.ch-react-opt')
      if (first) first.focus({ preventScroll: true })
    }
    const onDown = e => {
      if (!ref.current || ref.current.contains(e.target)) return
      if (e.target.closest && e.target.closest('[data-reaction-trigger]')) return
      if (closeRef.current) closeRef.current()
    }
    const onKey = e => { if (e.key === 'Escape' && closeRef.current) { e.stopPropagation(); closeRef.current() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  /* mũi tên trái / phải chuyển giữa các nút */
  const onArrow = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const btns = Array.from(ref.current ? ref.current.querySelectorAll('.ch-react-opt') : [])
    const i = btns.indexOf(document.activeElement)
    if (i < 0 || !btns.length) return
    e.preventDefault()
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length
    btns[n].focus()
  }

  const pick = code => { if (onPick) onPick(code); if (onClose) onClose() }

  return (
    <div ref={ref} className={'ch-react-picker' + (align === 'right' ? ' right' : '')} role="toolbar" aria-label="Chọn cảm xúc"
      onKeyDown={onArrow} onClick={e => e.stopPropagation()}>
      {REACTIONS.map(r => {
        const on = r.code === mine
        return (
          <button key={r.code} type="button" className={'ch-react-opt' + (on ? ' mine' : '')} aria-pressed={on}
            title={on ? `Bỏ ${r.label}` : r.label} aria-label={on ? `Bỏ ${r.label}` : r.label} onClick={() => pick(r.code)}>
            <span aria-hidden="true">{r.emoji}</span>
          </button>
        )
      })}
    </div>
  )
}
