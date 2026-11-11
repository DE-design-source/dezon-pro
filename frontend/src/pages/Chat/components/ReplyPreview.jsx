import { replyText } from '../state/chatLogic'

/* Khung trích dẫn: trong bong bóng (onJump - bấm để nhảy tới tin gốc) hoặc thanh "Đang trả lời" trên ô soạn (onCancel) */
export default function ReplyPreview({ reply, onJump, onCancel }) {
  if (!reply) return null
  const name = reply.sender_name || 'Ai đó'
  const text = replyText(reply)
  if (onCancel) {
    return (
      <div className="ch-reply-bar">
        <span className="ch-reply-bar-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>
        </span>
        <div className="ch-reply-bar-main">
          <span className="ch-reply-bar-title">Đang trả lời <b>{name}</b></span>
          <span className={'ch-reply-bar-text' + (reply.recalled ? ' recalled' : '')}>{text}</span>
        </div>
        <button type="button" className="ch-reply-bar-x" title="Huỷ trả lời" aria-label="Huỷ trả lời" onClick={onCancel}>×</button>
      </div>
    )
  }
  return (
    <button type="button" className="ch-reply-quote" title="Xem tin nhắn gốc" onClick={onJump} disabled={!onJump}>
      <span className="ch-reply-quote-name">{name}</span>
      <span className={'ch-reply-quote-text' + (reply.recalled ? ' recalled' : '')}>{text}</span>
    </button>
  )
}
