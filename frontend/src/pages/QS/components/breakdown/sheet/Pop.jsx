import { useEffect, useLayoutEffect, useRef } from 'react'
import { MrootPortal } from '../../common/Mroot'
import '../../common/common.css'
import './sheet.css'

/* Khung popup dùng chung của bảng Bóc tách (cùng dáng .qsc-pop), vẽ trong .qs-mroot.
   anchor: phần tử / DOMRect để đặt dưới (thiếu chỗ thì lật lên trên), hoặc {x, y} = điểm chuột (menu chuột phải).
   place = 'below' | 'above' (ưu tiên phía trên như thanh thao tác hàng loạt) · width (px bố cục) · onClose() khi bấm ra ngoài / Esc.
   Popup nằm trong vùng bị zoom nên đo tỉ lệ px style -> px màn hình bằng hai lần đặt thử (như DocsPopover). */
/* matchAnchor: hộp rộng đúng bằng phần tử neo (vd. ô chọn % VAT của Mua hàng: danh sách xổ cùng bề rộng với ô) */
export default function Pop({ anchor, place = 'below', width, className = '', onClose, children, keepOpenOn, matchAnchor }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop || !anchor) return
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect()
      : (anchor.x !== undefined ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 } : anchor)
    pop.style.left = '0px'; pop.style.top = '0px'
    const a = pop.getBoundingClientRect()
    pop.style.left = '100px'; pop.style.top = '100px'
    const b = pop.getBoundingClientRect()
    const z = (b.left - a.left) / 100 || 1
    if (matchAnchor && r.width) pop.style.width = r.width / z + 'px'
    const w = matchAnchor && r.width ? r.width : a.width; const h = pop.getBoundingClientRect().height
    const vw = window.innerWidth; const vh = window.innerHeight
    let top
    if (anchor.x !== undefined && !anchor.getBoundingClientRect) top = Math.min(r.top, vh - h - 12 * z)
    else if (place === 'above') { top = r.top - h - 8 * z; if (top < 8 * z) top = r.bottom + 8 * z }
    else { top = r.bottom + 6 * z; if (top + h > vh - 10 * z) top = Math.max(10 * z, r.top - h - 6 * z) }
    let left = anchor.x !== undefined && !anchor.getBoundingClientRect ? r.left : (place === 'center' ? r.left + (r.width || 0) / 2 - w / 2 : r.left)
    left = Math.max(8 * z, Math.min(left, vw - w - 10 * z))
    top = Math.max(8 * z, top)
    pop.style.left = (left - a.left) / z + 'px'
    pop.style.top = (top - a.top) / z + 'px'
  })

  useEffect(() => {
    const out = e => {
      if (ref.current && ref.current.contains(e.target)) return
      if (keepOpenOn && e.target.closest && e.target.closest(keepOpenOn)) return
      if (anchor && anchor.contains && anchor.contains(e.target)) return
      closeRef.current && closeRef.current()
    }
    const key = e => { if (e.key === 'Escape') closeRef.current && closeRef.current() }
    const t = setTimeout(() => document.addEventListener('mousedown', out), 0)
    document.addEventListener('keydown', key)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [anchor, keepOpenOn])

  return (
    <MrootPortal>
      <div className={`qsc-pop qs-tkp${className ? ' ' + className : ''}`} ref={ref} style={width ? { width } : undefined} role="dialog">
        {children}
      </div>
    </MrootPortal>
  )
}

/* Khung tiêu đề nhỏ của popup (bgt-h của bản gốc) */
export function PopHead({ title, sub, onClose }) {
  return (
    <div className="qs-tkp-h">
      <b>{title}</b>{sub ? <span className="qs-tkp-sub">{sub}</span> : null}
      {onClose && <button type="button" className="qsc-x" onClick={onClose}>✕</button>}
    </div>
  )
}
