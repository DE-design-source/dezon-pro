/* @nhắc tên: hàm thuần cho ô soạn tin (Composer) và hiển thị (MentionText).
   Vị trí (offset / length) tính theo đơn vị UTF-16 = chỉ số chuỗi JavaScript (API.md mục "Định dạng @nhắc tên"). */

export const MENTION_ALL_ID = 0
export const MENTION_ALL_NAME = 'Tất cả'
export const MAX_MENTIONS = 50
const MAX_QUERY = 40

/* Bỏ dấu tiếng Việt + chữ thường để lọc tên ("binh" khớp "Bình") */
export function foldVN(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

/* Sau khi sửa chữ (prev -> next): đoạn nhắc tên nằm trước chỗ sửa giữ nguyên, nằm sau thì dời theo độ lệch,
   bị sửa vào bên trong thì bỏ (giữ chữ, chỉ mất đánh dấu) */
export function shiftMentions(mentions, prev, next) {
  if (!mentions.length || prev === next) return mentions
  const max = Math.min(prev.length, next.length)
  let p = 0
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++
  const oldEnd = prev.length - s
  const delta = next.length - prev.length
  const out = []
  for (const m of mentions) {
    if (m.offset + m.length <= p) out.push(m)
    else if (m.offset >= oldEnd) out.push({ ...m, offset: m.offset + delta })
  }
  return out
}

/* Đang gõ "@abc" ngay trước con trỏ? -> {start, query}; '@' phải ở đầu chuỗi hoặc sau khoảng trắng,
   không xuống dòng, không nằm trong đoạn đã chèn */
export function mentionQuery(text, caret, mentions) {
  if (caret == null || caret < 1) return null
  const from = Math.max(0, caret - MAX_QUERY - 1)
  for (let i = caret - 1; i >= from; i--) {
    const ch = text[i]
    if (ch === '\n') return null
    if (ch !== '@') continue
    if (i > 0 && !/\s/.test(text[i - 1])) return null
    if (mentions.some(m => i >= m.offset && i < m.offset + m.length)) return null
    return { start: i, query: text.slice(i + 1, caret) }
  }
  return null
}

/* Danh sách gợi ý: @Tất cả (khi được phép) rồi thành viên khớp chữ gõ (không dấu, không phân biệt hoa thường).
   Chữ gõ có khoảng trắng mà không khớp ai -> không gợi ý (người dùng đang gõ câu bình thường) */
export function mentionCandidates(members, query, allowAll, limit = 8) {
  const q = foldVN(query).trim()
  const out = []
  if (allowAll && (!q || foldVN(MENTION_ALL_NAME).includes(q) || 'all'.startsWith(q))) out.push({ user_id: MENTION_ALL_ID, display_name: MENTION_ALL_NAME, all: true })
  const starts = []
  const contains = []
  for (const m of members || []) {
    const n = foldVN(m.display_name)
    if (!q) starts.push(m)
    else if (n.startsWith(q) || n.split(/\s+/).some(w => w.startsWith(q))) starts.push(m)
    else if (n.includes(q)) contains.push(m)
  }
  for (const m of starts.concat(contains)) {
    if (out.length >= limit) break
    out.push(m)
  }
  return out
}

/* Mentions gửi lên máy chủ: tính lại trên chuỗi ĐÃ trim(), chỉ giữ đoạn còn đúng "@Tên", sắp theo offset, bỏ chồng nhau, tối đa 50 */
export function finalizeMentions(text, mentions) {
  const lead = text.length - text.replace(/^\s+/, '').length
  const t = text.trim()
  const sorted = mentions
    .map(m => ({ user_id: m.user_id, offset: m.offset - lead, length: m.length, name: m.name }))
    .filter(m => m.offset >= 0 && m.length >= 2 && m.offset + m.length <= t.length && t.slice(m.offset, m.offset + m.length) === '@' + m.name)
    .sort((a, b) => a.offset - b.offset)
  const out = []
  let end = 0
  for (const m of sorted) {
    if (m.offset < end) continue
    out.push({ user_id: m.user_id, offset: m.offset, length: m.length })
    end = m.offset + m.length
    if (out.length >= MAX_MENTIONS) break
  }
  return out
}

/* Chia nội dung thành các đoạn {text, mention?} để hiển thị; đoạn hỏng (vượt chuỗi, chồng nhau, không bắt đầu bằng '@') bị bỏ qua */
export function splitMentions(text, mentions) {
  const s = String(text || '')
  if (!Array.isArray(mentions) || !mentions.length) return [{ text: s }]
  const list = mentions
    .filter(m => m && Number.isInteger(m.offset) && Number.isInteger(m.length) && m.offset >= 0 && m.length >= 2 && m.offset + m.length <= s.length && s[m.offset] === '@')
    .sort((a, b) => a.offset - b.offset)
  const parts = []
  let pos = 0
  for (const m of list) {
    if (m.offset < pos) continue
    if (m.offset > pos) parts.push({ text: s.slice(pos, m.offset) })
    parts.push({ text: s.slice(m.offset, m.offset + m.length), mention: m })
    pos = m.offset + m.length
  }
  if (pos < s.length) parts.push({ text: s.slice(pos) })
  return parts
}
