import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import html from './DecoxMatBang.html?raw'
import './matbang.css'

/* Module "Mặt bằng" (DECOX Mặt Bằng & dự toán nhà phố): giao diện từ file DecoxMatBang.html (style theo trang Kinh doanh),
   chạy trong iframe srcDoc để CSS riêng (biến :root --bg, --accent...) và mã vẽ mặt bằng không đè / lẫn với Dezon.
   Iframe tự theo sáng / tối của app (đọc html[data-theme] của trang cha).
   Chỉ giao diện phía trình duyệt: dữ liệu nhập lưu localStorage "decox_leads" của chính module, chưa nối máy chủ. */
export function MatBangFrame({ className }) {
  return <iframe className={'kd-mb-frame' + (className ? ' ' + className : '')} title="DECOX Mặt bằng" srcDoc={html} />
}

/* Mở toàn màn hình (nút "Mặt bằng" ở Dezbot): header nằm trong iframe, nút Đóng đè góc phải header đó; Esc để đóng */
export default function MatBangOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', k, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k, true); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="kd-mb" role="dialog" aria-modal="true" aria-label="Mặt bằng">
      <MatBangFrame />
      <button type="button" className="kd-mb-x" onClick={onClose} title="Đóng (Esc)" aria-label="Đóng Mặt bằng">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>,
    document.body,
  )
}
