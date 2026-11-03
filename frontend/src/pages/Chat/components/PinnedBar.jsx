import { useState } from 'react'
import './PinnedBar.css'

const TYPE_LABEL = { image: '[Hình ảnh]', video: '[Video]', voice: '[Tin nhắn thoại]', file: '[Tệp]' }

/* Tóm tắt một tin ghim: chữ (cắt ngắn) hoặc nhãn loại tệp */
function preview(p) {
  if (p.msg_type === 'file' && p.file_name) return '[Tệp] ' + p.file_name
  const t = (p.content || '').trim()
  if (t) return t.length > 120 ? t.slice(0, 120) + '…' : t
  return TYPE_LABEL[p.msg_type] || ''
}

/* Thanh tin ghim ở đầu thread: hiện tin ghim mới nhất, bấm để nhảy tới tin (nếu đã tải), mở rộng xem cả danh sách (tối đa 5) */
export default function PinnedBar({ pins, canPin, onJump, onUnpin }) {
  const [open, setOpen] = useState(false)
  if (!pins || !pins.length) return null
  const shown = open ? pins : pins.slice(0, 1)
  return (
    <div className="ch-pinned-bar">
      {shown.map(p => (
        <div key={p.message_id} className="ch-pinned-item">
          <span className="ch-pinned-icon" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4z" /></svg></span>
          <button type="button" className="ch-pinned-text" title="Xem tin nhắn" onClick={() => onJump(p)}>
            <b>{p.sender_name}</b>: {preview(p)}
          </button>
          {canPin && <button type="button" className="ch-pinned-x" title="Bỏ ghim" onClick={() => onUnpin(p)}>×</button>}
        </div>
      ))}
      {pins.length > 1 && (
        <button type="button" className="ch-pinned-more" onClick={() => setOpen(v => !v)}>
          {open ? 'Thu gọn' : `+${pins.length - 1} tin ghim khác`}
        </button>
      )}
    </div>
  )
}
