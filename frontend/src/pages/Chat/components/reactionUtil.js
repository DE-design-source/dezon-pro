/* Bộ cảm xúc cố định (khớp CHECK của chat_message_reactions và ReactionCodes bên Go) */
export const REACTIONS = [
  { code: 'like', emoji: '👍', label: 'Thích' },
  { code: 'love', emoji: '❤️', label: 'Yêu thích' },
  { code: 'haha', emoji: '😆', label: 'Haha' },
  { code: 'wow', emoji: '😮', label: 'Wow' },
  { code: 'sad', emoji: '😢', label: 'Buồn' },
  { code: 'angry', emoji: '😡', label: 'Phẫn nộ' },
]

const BY_CODE = Object.fromEntries(REACTIONS.map((r, i) => [r.code, { ...r, order: i }]))

export function reactionEmoji(code) { return BY_CODE[code] ? BY_CODE[code].emoji : '' }
export function reactionLabel(code) { return BY_CODE[code] ? BY_CODE[code].label : '' }
export function isReactionCode(code) { return !!BY_CODE[code] }

/* counts {code: n} -> [{code, emoji, label, count}] nhiều trước, bằng nhau theo thứ tự bộ cảm xúc; bỏ code lạ / <= 0 */
export function reactionEntries(counts) {
  if (!counts) return []
  return Object.keys(counts)
    .filter(c => BY_CODE[c] && Number(counts[c]) > 0)
    .map(c => ({ code: c, emoji: BY_CODE[c].emoji, label: BY_CODE[c].label, count: Number(counts[c]) }))
    .sort((a, b) => b.count - a.count || BY_CODE[a.code].order - BY_CODE[b.code].order)
}

/* Danh sách người thả (ReactionList.reactions) -> số theo code, cho các tab của hộp "Cảm xúc" */
export function countByCode(list) {
  const out = {}
  for (const r of list || []) if (BY_CODE[r.reaction]) out[r.reaction] = (out[r.reaction] || 0) + 1
  return out
}
