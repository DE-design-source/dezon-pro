import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import html from './DecoxMatBang.html?raw'
import './matbang.css'

/* Module "Mặt bằng" (DECOX Mặt Bằng & dự toán nhà phố): giao diện nguyên bản từ file thiết kế DecoxMatBang.html,
   chạy trong iframe srcDoc để CSS riêng (biến :root --bg, --accent...) và mã vẽ mặt bằng không đè / lẫn với Dezon.
   Chỉ giao diện phía trình duyệt: dữ liệu nhập lưu localStorage "decox_leads" của chính module, chưa nối máy chủ. */
export function MatBangFrame({ className }) {
  return <iframe className={'kd-mb-frame' + (className ? ' ' + className : '')} title="DECOX Mặt bằng" srcDoc={html} />
}

/* Mở toàn màn hình (nút "Mặt bằng" ở Dezbot): nút Đóng, Esc để đóng */
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
      <div className="kd-mb-bar">
        <span className="kd-mb-t">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M3 12h8V3" /><path d="M11 21v-5h10" /><path d="M15 3v5" /></svg>
          Mặt bằng
        </span>
        <button type="button" className="kd-mb-x" onClick={onClose} title="Đóng (Esc)" aria-label="Đóng Mặt bằng">×</button>
      </div>
      <MatBangFrame />
    </div>,
    document.body,
  )
}
