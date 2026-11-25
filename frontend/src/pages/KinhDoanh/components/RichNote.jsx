import { Fragment } from 'react'
import './RichNote.css'

/* Ghi chú có định dạng kiểu Slack / Lark, lưu dạng chữ (markdown rút gọn) trong cột ghi chú như cũ:
   **đậm**  ~~gạch~~  _nghiêng_  __gạch chân__  `code`  [chữ](https://...)  link https://... tự bấm được;
   đầu dòng: "1. " danh sách số, "- " / "• " gạch đầu dòng, "> " trích dẫn.
   Ký hiệu chỉ có hiệu lực khi đóng mở trên CÙNG một dòng: ghi chú cũ kiểu "**Ngân sách: ..." (không đóng) giữ nguyên chữ. */

const WB = '[\\p{L}\\p{N}_]'
const INLINE = [
  { t: 'code', re: /`([^`\n]+)`/u },
  { t: 'link', re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/u },
  { t: 'url', re: /https?:\/\/[^\s<>"'`]+/u },
  { t: 'b', re: /\*\*(?=\S)(.*?\S)\*\*/u },
  { t: 'u', re: new RegExp('(?:^|(?<=[^\\p{L}\\p{N}_]))__(?=\\S)(.*?\\S)__(?!' + WB + ')', 'u') },
  { t: 's', re: /~~(?=\S)(.*?\S)~~/u },
  { t: 'i', re: new RegExp('(?:^|(?<=[^\\p{L}\\p{N}_]))_(?=[^\\s_])(.*?[^\\s_])_(?!' + WB + ')', 'u') },
]

/* link trần: bỏ dấu câu dính cuối (". , ; : ! ?") và ")" thừa không có "(" đi kèm */
function trimUrl(u) {
  let s = u.replace(/[.,;:!?]+$/, '')
  while (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1).replace(/[.,;:!?]+$/, '')
  return s
}

export function parseInline(str) {
  const out = []
  let rest = String(str || '')
  while (rest) {
    let best = null
    for (const p of INLINE) {
      const m = p.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { p, m }
    }
    if (!best) { out.push(rest); break }
    const { p, m } = best
    let whole = m[0]
    if (p.t === 'url') whole = trimUrl(whole)
    if (m.index) out.push(rest.slice(0, m.index))
    if (p.t === 'code') out.push({ t: 'code', text: m[1] })
    else if (p.t === 'link') out.push({ t: 'a', href: m[2], kids: parseInline(m[1]) })
    else if (p.t === 'url') out.push({ t: 'a', href: whole, kids: [whole] })
    else out.push({ t: p.t, kids: parseInline(m[1]) })
    rest = rest.slice(m.index + whole.length)
  }
  return out
}

const LINE = [
  { t: 'ol', re: /^\s*(\d{1,3})[.)]\s+(.*)$/ },
  { t: 'ul', re: /^\s*[-•*]\s+(.*)$/ },
  { t: 'q', re: /^\s*>(?:\s+(.*)|$)/ },   // "> " mới là trích dẫn; ">100m2" (lớn hơn) giữ nguyên chữ
]
export function parseBlocks(text) {
  const blocks = []
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
    let kind = 'p', body = line, num = null
    for (const L of LINE) {
      const m = L.re.exec(line)
      if (m) { kind = L.t; if (L.t === 'ol') { num = Number(m[1]); body = m[2] } else body = m[1] || ''; break }
    }
    const last = blocks[blocks.length - 1]
    if (last && last.t === kind) { last.lines.push(body); last.nums.push(num) }
    else blocks.push({ t: kind, start: num, lines: [body], nums: [num] })
  })
  return blocks
}

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return <Fragment key={i}>{n}</Fragment>
    if (n.t === 'code') return <code key={i} className="rn-code">{n.text}</code>
    const kids = <Inline nodes={n.kids} />
    if (n.t === 'a') return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="rn-a">{kids}</a>
    if (n.t === 'b') return <strong key={i} className="rn-b">{kids}</strong>
    if (n.t === 'i') return <em key={i} className="rn-i">{kids}</em>
    if (n.t === 'u') return <u key={i}>{kids}</u>
    if (n.t === 's') return <s key={i}>{kids}</s>
    return null
  })
}

/* Hiển thị ghi chú. Đoạn thường là span (nối tiếp được nhãn đứng trước như "Ghi chú nội bộ:"), danh sách / trích dẫn là khối */
export default function RichNote({ text }) {
  return parseBlocks(text).map((b, i) => {
    if (b.t === 'p') return (
      <span key={i} className="rn-p">
        {b.lines.map((ln, j) => <Fragment key={j}>{j ? <br /> : null}<Inline nodes={parseInline(ln)} /></Fragment>)}
      </span>
    )
    const items = b.lines.map((ln, j) => <li key={j} value={b.t === 'ol' ? b.nums[j] : undefined}><Inline nodes={parseInline(ln)} /></li>)
    if (b.t === 'ol') return <ol key={i} className="rn-ol" start={b.start || 1}>{items}</ol>
    if (b.t === 'ul') return <ul key={i} className="rn-ul">{items}</ul>
    return <blockquote key={i} className="rn-q">{b.lines.map((ln, j) => <Fragment key={j}>{j ? <br /> : null}<Inline nodes={parseInline(ln)} /></Fragment>)}</blockquote>
  })
}

/* ---------- Thanh định dạng cho ô nhập (textarea) ---------- */
const IC = {
  s: 'M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16',
  i: 'M19 4h-9M14 20H5M15 4 9 20',
  u: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
  ol: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  ul: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  q: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zM15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z',
  a: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
}
const WRAP = { b: '**', s: '~~', i: '_', u: '__', code: '`' }

/* Bọc / bỏ bọc phần đang chọn bằng ký hiệu; chưa chọn gì thì chèn cặp ký hiệu và đặt con trỏ ở giữa.
   Ký hiệu chỉ có hiệu lực trong 1 dòng nên bọc / bỏ bọc TỪNG dòng; tiền tố danh sách / trích dẫn và khoảng trắng đầu cuối để ngoài ký hiệu.
   "_" (nghiêng) không nhận nhầm "__" (gạch chân). */
const LINE_PREFIX = /^\s*(?:\d{1,3}[.)]\s+|[-•*]\s+|>(?:\s+|$))?/
function isWrapped(c, mk) {
  if (c.length <= 2 * mk.length || !c.startsWith(mk) || !c.endsWith(mk)) return false
  if (mk === '_') return !c.startsWith('__') && !c.endsWith('__')
  return true
}
export function applyWrap(value, a, b, mk) {
  const v = String(value || '')
  const single = mk === '_'
  const around = v.slice(a - mk.length, a) === mk && v.slice(b, b + mk.length) === mk
    && (!single || (v[a - 2] !== '_' && v[b + 1] !== '_'))
  if (around && v.slice(a, b).indexOf('\n') < 0) {
    return { value: v.slice(0, a - mk.length) + v.slice(a, b) + v.slice(b + mk.length), a: a - mk.length, b: b - mk.length }
  }
  if (a === b) return { value: v.slice(0, a) + mk + mk + v.slice(a), a: a + mk.length, b: a + mk.length }
  const atLineStart = a === 0 || v[a - 1] === '\n'
  const parts = v.slice(a, b).split('\n').map((ln, i) => {
    const pre = (i > 0 || atLineStart) ? ln.match(LINE_PREFIX)[0] : ln.match(/^\s*/)[0]
    const restL = ln.slice(pre.length)
    const trail = restL.match(/\s*$/)[0]
    return { pre, core: restL.slice(0, restL.length - trail.length), trail }
  })
  const filled = parts.filter(p => p.core)
  if (!filled.length) return { value: v, a, b }
  const unwrap = filled.every(p => isWrapped(p.core, mk))
  const out = parts.map(p => p.pre + (!p.core ? '' : unwrap ? p.core.slice(mk.length, -mk.length) : isWrapped(p.core, mk) ? p.core : mk + p.core + mk) + p.trail).join('\n')
  return { value: v.slice(0, a) + out + v.slice(b), a, b: a + out.length }
}

/* Thêm / bỏ tiền tố đầu dòng cho mọi dòng trong vùng chọn */
const PREFIX_RE = { ol: /^\s*\d{1,3}[.)]\s+/, ul: /^\s*[-•*]\s+/, q: /^\s*>(?:\s+|$)/ }
export function applyLines(value, a, b, kind) {
  const v = String(value || '')
  const s = a > 0 ? v.lastIndexOf('\n', a - 1) + 1 : 0
  let e = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b)
  if (e < 0) e = v.length
  const lines = v.slice(s, e).split('\n')
  const has = lines.filter(l => l.trim()).every(l => PREFIX_RE[kind].test(l)) && lines.some(l => l.trim())
  let n = 0
  const next = lines.map(l => {
    if (has) return l.replace(PREFIX_RE[kind], '')
    if (!l.trim() && lines.length > 1) return l
    const bare = l.replace(PREFIX_RE.ol, '').replace(PREFIX_RE.ul, '').replace(PREFIX_RE.q, '')
    n += 1
    return (kind === 'ol' ? n + '. ' : kind === 'ul' ? '- ' : '> ') + bare
  }).join('\n')
  const out = v.slice(0, s) + next + v.slice(e)
  return { value: out, a: a === b ? s + next.length : s, b: s + next.length }
}

export function applyLink(value, a, b, url) {
  const v = String(value || '')
  const raw = v.slice(a, b)
  const lead = raw.match(/^\s*/)[0], trail = raw.slice(lead.length).match(/\s*$/)[0]
  const sel = (raw.trim() || 'liên kết').replace(/[[\]\n]/g, ' ')
  const href = url.replace(/\(/g, '%28').replace(/\)/g, '%29')   // ")" trong link làm gãy cú pháp [chữ](link)
  const ins = lead + '[' + sel + '](' + href + ')' + trail
  const st = a + lead.length + 1
  return { value: v.slice(0, a) + ins + v.slice(b), a: st, b: st + sel.length }
}

export function NoteToolbar({ taRef, value, onChange }) {
  const run = fn => {
    const el = taRef.current
    if (!el) return
    const r = fn(value, el.selectionStart, el.selectionEnd)
    if (!r) return
    onChange(r.value)
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(r.a, r.b) } catch { /* bỏ qua */ } })
  }
  const wrap = k => run((v, a, b) => applyWrap(v, a, b, WRAP[k]))
  const lines = k => run((v, a, b) => applyLines(v, a, b, k))
  const link = () => {
    const el = taRef.current
    if (!el) return
    const a = el.selectionStart, b = el.selectionEnd
    let url = window.prompt('Dán đường link (https://...):', 'https://')
    if (url == null) return
    url = url.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) { if (url && url !== 'https://') window.alert('Link phải bắt đầu bằng http:// hoặc https:// và không có khoảng trắng.'); return }
    run(v => applyLink(v, a, b, url))
  }
  const Btn = ({ k, title, onClick, children }) => (
    <button type="button" className="rn-tb-b" title={title} aria-label={title} onMouseDown={e => e.preventDefault()} onClick={onClick}>
      {children || <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={IC[k]} /></svg>}
    </button>
  )
  return (
    <div className="rn-tb" role="toolbar" aria-label="Định dạng ghi chú">
      <Btn title="Đậm (Ctrl+B)" onClick={() => wrap('b')}><b className="rn-tb-B">B</b></Btn>
      <Btn k="s" title="Gạch ngang" onClick={() => wrap('s')} />
      <Btn k="i" title="Nghiêng (Ctrl+I)" onClick={() => wrap('i')} />
      <Btn k="u" title="Gạch chân (Ctrl+U)" onClick={() => wrap('u')} />
      <span className="rn-tb-sep" />
      <Btn k="ol" title="Danh sách số" onClick={() => lines('ol')} />
      <Btn k="ul" title="Gạch đầu dòng" onClick={() => lines('ul')} />
      <Btn k="q" title="Trích dẫn" onClick={() => lines('q')} />
      <span className="rn-tb-sep" />
      <Btn k="a" title="Chèn link" onClick={link} />
      <Btn k="code" title="Code" onClick={() => wrap('code')} />
    </div>
  )
}

/* Phím tắt trong ô nhập: Ctrl/Cmd + B / I / U */
export function noteHotkey(e, value, onChange) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  const k = { b: 'b', i: 'i', u: 'u' }[String(e.key).toLowerCase()]
  if (!k) return
  e.preventDefault()
  const el = e.currentTarget
  const r = applyWrap(value, el.selectionStart, el.selectionEnd, WRAP[k])
  onChange(r.value)
  requestAnimationFrame(() => { try { el.setSelectionRange(r.a, r.b) } catch { /* bỏ qua */ } })
}
