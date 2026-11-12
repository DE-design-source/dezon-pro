import { useEffect, useRef, useState } from 'react'
import { MrootPortal } from './Mroot'
import './common.css'

/* Xem ảnh cỡ lớn (port imgPop_, PUB/nhap.js:294-349): lật ‹ › bằng chuột hoặc phím ←/→, Esc để đóng, có số đếm.
   Phóng to / thu nhỏ (chỉ bản Go): lăn chuột, nút − / + / Vừa khung, phím + / − / 0, bấm đúp ảnh = 2.5x ↔ vừa khung;
   đang phóng to thì kéo ảnh để xem phần khác.
   Props: src (URL đã qua mediaUrl; rỗng = không hiện), gallery (mảng URL của panel chi tiết, tuỳ chọn),
          onClose(), onIndexChange(i) (tuỳ chọn: chỉ gọi khi đang lật đúng bộ ảnh gallery, để panel chi tiết đổi ảnh theo).
   Như bản gốc: chỉ dùng gallery khi src nằm trong gallery, ngược lại chỉ xem 1 ảnh src. */
export default function ImgViewer({ src, gallery, onClose, onIndexChange }) {
  const gal = gallery && gallery.length ? gallery : []
  const at = src ? gal.indexOf(src) : -1
  const list = at >= 0 ? gal : (src ? [src] : [])
  /* Vị trí đang xem gắn với src: mở ảnh khác thì quay về đúng ảnh vừa bấm */
  const [pos, setPos] = useState(() => ({ src, i: at >= 0 ? at : 0 }))
  const idx = pos.src === src ? pos.i : (at >= 0 ? at : 0)

  const many = list.length > 1
  const [z, setZ] = useState({ k: 1, x: 0, y: 0 })   // tỉ lệ + độ dời khi kéo
  const drag = useRef(null)
  const ZMIN = 0.5, ZMAX = 8
  const zoom = f => setZ(o => { const k = Math.min(ZMAX, Math.max(ZMIN, Math.round(o.k * f * 100) / 100)); return k <= 1 ? { k, x: 0, y: 0 } : { ...o, k } })
  const fit = () => setZ({ k: 1, x: 0, y: 0 })

  function go(d) {
    if (list.length < 2) return
    const n = (((idx + d) % list.length) + list.length) % list.length
    fit()
    setPos({ src, i: n })
    if (at >= 0 && onIndexChange) onIndexChange(n)
  }

  useEffect(() => {
    if (!src) return undefined
    const key = e => {
      if (e.key === 'Escape') onClose && onClose()
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.25) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(0.8) }
      else if (e.key === '0') { e.preventDefault(); fit() }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  if (!src) return null

  return (
    <MrootPortal>
      <div className="qsc-iv" onWheel={e => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
        onMouseMove={e => { const d = drag.current; if (!d) return; d.moved = true; setZ(o => ({ ...o, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy })) }}
        onMouseUp={() => { setTimeout(() => { drag.current = null }, 0) }}
        onClick={e => { if (drag.current && drag.current.moved) return; if (e.target.tagName !== 'IMG') onClose && onClose() }}>
        {many && <button type="button" className="qsc-iv-nav prev" title="Ảnh trước (←)" onClick={e => { e.stopPropagation(); go(-1) }}>‹</button>}
        <img src={list[idx] || src} alt="" draggable={false}
          className={z.k > 1 ? 'zoomed' : ''}
          style={{ transform: 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.k + ')', transition: drag.current ? 'none' : undefined }}
          onDoubleClick={e => { e.stopPropagation(); setZ(o => (o.k > 1 ? { k: 1, x: 0, y: 0 } : { k: 2.5, x: 0, y: 0 })) }}
          onMouseDown={e => { if (z.k <= 1) return; e.preventDefault(); drag.current = { sx: e.clientX, sy: e.clientY, x: z.x, y: z.y, moved: false } }} />
        <div className="qsc-iv-zoom" onClick={e => e.stopPropagation()}>
          <button type="button" title="Thu nhỏ (−)" onClick={() => zoom(0.8)} disabled={z.k <= ZMIN}>−</button>
          <button type="button" className="pct" title="Vừa khung (0)" onClick={fit}>{Math.round(z.k * 100)}%</button>
          <button type="button" title="Phóng to (+)" onClick={() => zoom(1.25)} disabled={z.k >= ZMAX}>+</button>
        </div>
        {many && <button type="button" className="qsc-iv-nav next" title="Ảnh sau (→)" onClick={e => { e.stopPropagation(); go(1) }}>›</button>}
        {many && <span className="qsc-iv-n">{idx + 1} / {list.length}</span>}
        <button type="button" className="qsc-iv-x" title="Đóng (Esc)" onClick={e => { e.stopPropagation(); onClose && onClose() }}>✕</button>
      </div>
    </MrootPortal>
  )
}
