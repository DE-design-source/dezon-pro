/* Tìm tin nhắn (giai đoạn 2, mục D): chuẩn hoá bỏ dấu giống hệt SQL chat_search_fold (migration 0023) và Go foldVN:
   chữ thường -> bỏ dấu tổ hợp U+0300..U+036F (chuỗi NFD) -> chữ có dấu dựng sẵn về không dấu, đ -> d -> mọi chuỗi ký tự không
   phải chữ / số thành một khoảng trắng, cắt hai đầu. KHÔNG chuẩn hoá NFC / NFD trước (máy chủ cũng không), để ra cùng kết quả. */

export const SEARCH_MIN_CHARS = 2
export const SEARCH_MAX_QUERY = 100
export const SEARCH_MAX_TERMS = 8

/* Bảng 67 chữ của translate() trong chat_search_fold */
const FROM = 'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ'
const TO = 'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy'
const FOLD_MAP = new Map()
for (let i = 0; i < FROM.length; i++) FOLD_MAP.set(FROM[i], TO[i])

const COMBINING = /[̀-ͯ]/g
const ALNUM = /^[\p{L}\p{N}]$/u

/* Một ký tự (code point) gốc -> các ký tự sau chuẩn hoá (lowercase từng ký tự như lower() của PostgreSQL / Go ToLower) */
function foldChar(ch) {
  const low = ch.toLowerCase().replace(COMBINING, '')
  let out = ''
  for (const c of low) out += FOLD_MAP.get(c) || c
  return out
}

/* Chuẩn hoá kèm bản đồ vị trí: folded[k] đến từ text.slice(start[k], end[k]) (khoảng trắng nối: -1).
   Dấu tổ hợp rơi vào ký tự đứng trước nó (để tô đậm trọn chữ). */
function foldIndex(text) {
  const s = String(text == null ? '' : text)
  let folded = ''
  const start = []
  const end = []
  let gap = false
  let i = 0
  for (const ch of s) {
    const j = i + ch.length
    const out = foldChar(ch)
    if (!out) {
      if (end.length && end[end.length - 1] === i) end[end.length - 1] = j
    } else {
      for (const c of out) {
        if (ALNUM.test(c)) {
          if (gap && folded) { folded += ' '; start.push(-1); end.push(-1) }
          gap = false
          folded += c; start.push(i); end.push(j)
        } else gap = true
      }
    }
    i = j
  }
  return { folded, start, end }
}

/* Chuẩn hoá để so khớp (cùng luật SQL / Go) */
export function foldText(s) {
  return foldIndex(s).folded
}

/* Từ khoá -> các từ đã chuẩn hoá (tối đa 8 từ đầu, bỏ trùng). Dùng để tô đậm; máy chủ tự tách lại. */
export function searchTerms(q) {
  const out = []
  for (const t of foldText(q).split(' ')) {
    if (!t || out.includes(t)) continue
    out.push(t)
    if (out.length >= SEARCH_MAX_TERMS) break
  }
  return out
}

/* Lỗi của từ khoá trước khi gọi máy chủ ('' = hợp lệ): cùng câu với API */
export function searchQueryError(q) {
  if ([...String(q || '')].length > SEARCH_MAX_QUERY) return 'Từ khoá tối đa 100 ký tự'
  const n = foldText(q).split(' ').slice(0, SEARCH_MAX_TERMS).reduce((a, t) => a + [...t].length, 0)
  return n < SEARCH_MIN_CHARS ? 'Nhập ít nhất 2 ký tự để tìm' : ''
}

/* Các khoảng [a, b) trong chuỗi gốc khớp TIỀN TỐ của một từ (giống tsquery 'tu':*), đã gộp và sắp tăng dần */
function hitRanges(text, terms) {
  const { folded, start, end } = foldIndex(text)
  const ranges = []
  for (const t of terms || []) {
    if (!t) continue
    let k = folded.indexOf(t)
    while (k >= 0) {
      if (k === 0 || folded[k - 1] === ' ') ranges.push([start[k], end[k + t.length - 1]])
      k = folded.indexOf(t, k + 1)
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/* Tách chuỗi thành đoạn thường / đoạn khớp: [{text, hit}] (nối lại = chuỗi gốc) */
export function highlightParts(text, terms) {
  const s = String(text == null ? '' : text)
  const parts = []
  let pos = 0
  for (const [a, b] of hitRanges(s, terms)) {
    if (a > pos) parts.push({ text: s.slice(pos, a), hit: false })
    parts.push({ text: s.slice(a, b), hit: true })
    pos = b
  }
  if (pos < s.length || !parts.length) parts.push({ text: s.slice(pos), hit: false })
  return parts.filter(p => p.text || parts.length === 1)
}

/* Đoạn trích một dòng quanh từ khớp đầu tiên, tối đa maxChars ký tự (cắt ở khoảng trắng, thêm "…") */
export function snippetAround(text, terms, maxChars = 120) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (s.length <= maxChars) return s
  const first = hitRanges(s, terms)[0]
  const hit = first ? first[0] : 0
  let from = Math.max(0, Math.min(hit - Math.floor(maxChars / 3), s.length - maxChars))
  if (from > 0) {
    const sp = s.indexOf(' ', from)
    if (sp >= 0 && sp < hit) from = sp + 1
  }
  let to = Math.min(s.length, from + maxChars)
  if (to < s.length) {
    const sp = s.lastIndexOf(' ', to)
    if (sp > Math.max(from, hit)) to = sp
  }
  return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '')
}
