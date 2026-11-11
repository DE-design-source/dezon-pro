/* Luật hiện nút trên menu tin (hàm thuần; máy chủ kiểm lại theo ma trận quyền API.md "Giai đoạn 2").
   now = api.serverNow() (giờ máy chủ, tránh lệch đồng hồ máy). Điều kiện theo hội thoại (đã rời, giải tán, chặn,
   chỉ trưởng / phó nhóm gửi tin) do Thread.jsx xét, ở đây chỉ xét bản thân tin. */

export const MSG_ACTION_WINDOW_MS = 24 * 3600 * 1000

const live = m => !!m && !!m.id && m.msg_type !== 'system' && !m.recalled

/* Còn trong 24 giờ từ created_at */
export function withinWindow(m, now = Date.now()) {
  const t = Date.parse(m && m.created_at)
  return Number.isFinite(t) && now - t < MSG_ACTION_WINDOW_MS
}

/* Sửa: tin văn bản của chính mình, chưa thu hồi, trong 24 giờ */
export function canEditMsg(m, meId, now = Date.now()) {
  return live(m) && m.sender_id === meId && m.msg_type === 'text' && withinWindow(m, now)
}

/* Thu hồi: tin của mình trong 24 giờ (mọi vai trò, cả chat 1-1); nhóm: owner thu hồi tin của mọi người khác, admin thu hồi tin
   của người đang là member hoặc đã rời nhóm (senderRole rỗng), không giới hạn thời gian */
export function canRecallMsg(m, meId, myRole, senderRole, convType, now = Date.now()) {
  if (!live(m)) return false
  if (m.sender_id === meId) return withinWindow(m, now)
  if (convType !== 'group') return false
  if (myRole === 'owner') return true
  if (myRole === 'admin') return !senderRole || senderRole === 'member'
  return false
}

export const canReplyMsg = m => live(m)
export const canForwardMsg = m => live(m)
export const canReactMsg = m => live(m)

/* Có chữ để sao chép (tin văn bản hoặc chú thích) */
export const canCopyMsg = m => live(m) && !!String(m.content || '').trim()
