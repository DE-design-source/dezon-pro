import { retry } from '../state/chatStore'

/* Cổng Dezon Chat: chat đăng nhập bằng tài khoản Dezon Pro (chatStore đổi phiên Dezon Pro lấy phiên chat), nên cổng chỉ
   còn thẻ trạng thái - chưa cấu hình VITE_API_URL / đang kết nối / không tới được máy chủ / chưa được cấp quyền Chat.
   Không có OTP, QR hay chọn tài khoản trên web; đăng xuất là đăng xuất Dezon Pro. */

function Card({ title, text, children }) {
  return (
    <div className="ch-gate">
      <div className="ch-gate-card">
        <div className="ch-gate-title">{title}</div>
        {text && <div className="ch-gate-text">{text}</div>}
        {children}
      </div>
    </div>
  )
}

const retryBtn = <button type="button" className="ch-gate-btn" onClick={retry}>Thử lại</button>

export default function ChatGate({ chat }) {
  if (chat.auth === 'unconfigured') return <Card title="Dezon Chat" text="Chưa cấu hình địa chỉ máy chủ (VITE_API_URL) nên chưa dùng được Dezon Chat." />
  if (chat.auth === 'checking') return <Card title="Dezon Chat" text="Đang kết nối Dezon Chat bằng tài khoản Dezon Pro…" />
  if (chat.auth === 'unreachable') return <Card title="Dezon Chat" text={chat.error || 'Không kết nối được máy chủ chat.'}>{retryBtn}</Card>
  if (chat.auth === 'denied') {
    return (
      <Card title="Dezon Chat" text={chat.error || 'Tài khoản chưa được cấp quyền Chat. Nhờ quản trị viên cấp quyền.'}>
        {retryBtn}
      </Card>
    )
  }
  return <Card title="Dezon Chat" text="Chưa kết nối được Dezon Chat. Đăng nhập Dezon Pro rồi thử lại.">{retryBtn}</Card>
}
