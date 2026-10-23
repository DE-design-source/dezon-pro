import { useEffect, useRef } from 'react'
import Icon from '../../../../components/ui/Icon'
import { clearAllFilters } from './catalog/filterStore'

/* Bảng "Bộ lọc" mở bên phải cột Hạng mục (port toggleFiltDrop, PUB/app.js:909-1012 + index.html:6705-6726): khung + nút đóng,
   thân là danh sách module do CatalogPanel / FilterSections dựng (Khối hiển thị, Đang lọc, Phạm vi sản phẩm, các khối lọc…).
   Props: title (mặc định "Bộ lọc"), foot (chân bảng; thiếu = Xoá lọc + Xong), children, onClose(), anchorRef (nút mở: bấm vào nó không tính là bấm ngoài; mọi phần tử .qs-bd-pop-anchor cũng vậy, vd. nút trái tim) */
export default function FilterPopover({ title = 'Bộ lọc', foot, children, onClose, anchorRef }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /* Bấm ra ngoài hộp thì đóng (filtOutside_) */
  useEffect(() => {
    const down = e => {
      const t = e.target
      if (ref.current && ref.current.contains(t)) return
      if (anchorRef && anchorRef.current && anchorRef.current.contains(t)) return
      if (t && t.closest && t.closest('.qs-bd-pop-anchor')) return
      closeRef.current && closeRef.current()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [anchorRef])

  return (
    <div className="qs-bd-pop" ref={ref}>
      <div className="qs-bd-pop-head">
        <span>{title}</span>
        <button className="qs-bd-pop-close" title="Đóng" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <div className="qs-bd-pop-body">
        <div className="qs-bd-pop-filters">{children}</div>
      </div>
      <div className="qs-bd-pop-foot">
        {foot || (
          <>
            <button className="qs-modal-btn" onClick={clearAllFilters}>Xoá lọc</button>
            <button className="qs-modal-btn primary" onClick={onClose}>Xong</button>
          </>
        )}
      </div>
    </div>
  )
}
