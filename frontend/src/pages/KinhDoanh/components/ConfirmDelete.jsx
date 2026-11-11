import { useEffect } from 'react'

/* Hộp xác nhận xoá ở giữa màn hình (thay window.confirm): biểu tượng thùng rác đỏ, tên khách hàng, cảnh báo không hoàn tác.
   Enter = Xoá, Esc / bấm nền / Huỷ = đóng. Props: open, name, detail, onCancel(), onConfirm() */
export default function ConfirmDelete({ open, name, detail, onCancel, onConfirm }) {
  useEffect(() => {
    if (!open) return undefined
    const k = e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') { e.preventDefault(); onConfirm() } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onCancel, onConfirm])
  if (!open) return null
  return (
    <div className="kd-del-ov" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="kd-del" role="alertdialog" aria-modal="true" aria-label="Xác nhận xoá">
        <span className="ic">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-.9 14a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
        </span>
        <b>Xoá khách hàng?</b>
        <p>Khách hàng <strong>{name}</strong>{detail ? <> · {detail}</> : null} cùng lịch sử chăm sóc sẽ bị xoá vĩnh viễn. Hành động này không thể hoàn tác.</p>
        <div className="bt">
          <button type="button" onClick={onCancel}>Huỷ</button>
          <button type="button" className="danger" autoFocus onClick={onConfirm}>Xoá khách hàng</button>
        </div>
      </div>
    </div>
  )
}
