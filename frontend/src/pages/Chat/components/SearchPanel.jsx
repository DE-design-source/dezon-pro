import { useEffect, useRef, useState } from 'react'
import * as L from '../state/chatLogic'
import { searchMessages, useChat } from '../state/chatStore'
import { ConvAvatar, SearchIcon, avatarConv, colorFor, errText } from './shared'
import { SEARCH_MAX_QUERY, highlightParts, searchQueryError, searchTerms, snippetAround } from './searchUtil'
import './Search.css'

const DEBOUNCE_MS = 300
const PAGE = 20
const SNIPPET_CHARS = 140
const TYPE_LABEL = { image: '[Hình ảnh]', video: '[Video]', file: '[Tệp]', voice: '[Tin nhắn thoại]' }
const EMPTY = { hits: [], next: null, loading: false, more: false, error: '', moreError: '', done: false }

/* Chuỗi có từ khớp được tô đậm (cùng luật bỏ dấu với máy chủ) */
function Highlight({ text, terms }) {
  return highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i} className="ch-sr-hit">{p.text}</mark> : <span key={i}>{p.text}</span>))
}

/* Nội dung một kết quả: nhãn loại tin (không tô) + tên tệp + đoạn trích quanh từ khớp */
function HitBody({ hit, terms }) {
  const label = TYPE_LABEL[hit.msg_type]
  const content = snippetAround(hit.content, terms, SNIPPET_CHARS)
  const file = hit.msg_type === 'file' && hit.file_name ? hit.file_name : ''
  return (
    <>
      {label && <span className="ch-sr-type">{label} </span>}
      {file && <Highlight text={file} terms={terms} />}
      {file && content && <span> - </span>}
      {content && <Highlight text={content} terms={terms} />}
    </>
  )
}

/* Avatar của kết quả: tìm mọi hội thoại -> avatar hội thoại; tìm trong một hội thoại -> avatar người gửi */
function hitAvatar(hit, conv, global) {
  if (!global) return { type: 'dm', name: hit.sender_name || '', color: colorFor(hit.sender_id) }
  if (conv) return avatarConv(conv, false)
  if (hit.conversation_type === 'direct') return { type: 'dm', name: hit.conversation_name || '', color: colorFor(hit.conversation_id) }
  return { type: 'group', name: hit.conversation_name || '', color: colorFor(hit.conversation_id), icon: 'group' }
}

/* Cột tìm tin nhắn bên phải (thay InfoPanel khi đang tìm): conversationId = số -> tìm trong hội thoại đó, null -> mọi hội thoại.
   Gõ xong 300 ms mới gọi máy chủ; cuộn gần cuối (hoặc bấm "Xem thêm") -> trang sau theo next_cursor; bấm kết quả -> onJump(cid, seq). */
export default function SearchPanel({ conversationId, initialQuery, onClose, onJump }) {
  const chat = useChat()
  const cid = conversationId || null
  const global = !cid
  const [q, setQ] = useState(initialQuery || '')
  const [res, setRes] = useState(EMPTY)
  const [retry, setRetry] = useState(0)
  const [active, setActive] = useState(null)
  const runRef = useRef(0)
  const moreRef = useRef(false)
  const inputRef = useRef(null)

  /* Mở lại với từ khoá / phạm vi khác (vd. bấm "Tìm tin nhắn chứa ..." ở danh sách khi bảng đang mở) */
  useEffect(() => {
    setQ(initialQuery || '')
    setActive(null)
    if (inputRef.current) inputRef.current.focus()
  }, [initialQuery, cid])

  const query = q.trim()
  const qErr = query ? searchQueryError(query) : ''
  const terms = searchTerms(query)

  useEffect(() => {
    const run = ++runRef.current
    moreRef.current = false
    if (!query || searchQueryError(query)) { setRes(EMPTY); return undefined }
    setRes(r => ({ ...r, loading: true, error: '', moreError: '' }))
    const t = setTimeout(async () => {
      try {
        const r = await searchMessages(query, { cid, limit: PAGE })
        if (run !== runRef.current) return
        setRes({ ...EMPTY, hits: (r && r.hits) || [], next: (r && r.next_cursor) || null, done: true })
      } catch (e) {
        if (run !== runRef.current) return
        setRes({ ...EMPTY, error: errText(e), done: true })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, cid, retry])

  async function loadMore() {
    if (!res.next || res.loading || moreRef.current) return
    const run = runRef.current
    const cursor = res.next
    moreRef.current = true
    setRes(r => ({ ...r, more: true, moreError: '' }))
    try {
      const r = await searchMessages(query, { cid, cursor, limit: PAGE })
      if (run !== runRef.current) return
      setRes(prev => {
        const seen = new Set(prev.hits.map(h => h.message_id))
        const add = ((r && r.hits) || []).filter(h => !seen.has(h.message_id))
        return { ...prev, hits: prev.hits.concat(add), next: (r && r.next_cursor) || null, more: false }
      })
    } catch (e) {
      if (run !== runRef.current) return
      setRes(prev => ({ ...prev, more: false, moreError: errText(e) }))
    } finally {
      if (run === runRef.current) moreRef.current = false
    }
  }

  function onScroll(e) {
    const el = e.currentTarget
    if (res.next && !res.moreError && el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  function pick(hit) {
    setActive(hit.message_id)
    onJump(hit.conversation_id, hit.seq)
  }

  const meId = chat.me ? chat.me.id : 0
  const scopeConv = cid ? chat.convs[cid] : null
  const now = Date.now()

  let note = null
  if (!query) note = global ? 'Nhập từ khoá để tìm tin nhắn trong mọi cuộc trò chuyện. Không phân biệt dấu và chữ hoa.' : 'Nhập từ khoá để tìm tin nhắn trong cuộc trò chuyện này. Không phân biệt dấu và chữ hoa.'
  else if (qErr) note = qErr
  else if (res.error) note = null
  else if (!res.hits.length && (res.loading || !res.done)) note = 'Đang tìm…'
  else if (!res.hits.length) note = 'Không tìm thấy tin nhắn nào phù hợp'

  return (
    <div className="ch-sr-panel">
      <div className="ch-sr-head">
        <div className="ch-sr-title">
          <div className="ch-sr-title-text">
            <span>{global ? 'Tìm tin nhắn' : 'Tìm trong trò chuyện'}</span>
            {scopeConv && <span className="ch-sr-scope">{L.convTitle(scopeConv)}</span>}
          </div>
          <button type="button" className="ch-icon-btn ch-sr-close" title="Đóng tìm kiếm" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="ch-search-box ch-sr-box">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={q}
            maxLength={SEARCH_MAX_QUERY}
            placeholder={global ? 'Tìm tin nhắn, tên tệp...' : 'Tìm trong cuộc trò chuyện...'}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {q && (
            <button type="button" className="ch-sr-clear" title="Xoá từ khoá" onClick={() => { setQ(''); if (inputRef.current) inputRef.current.focus() }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {query && !qErr && res.loading && res.hits.length > 0 && <div className="ch-sr-busy">Đang tìm…</div>}
      </div>

      <div className="ch-sr-list" onScroll={onScroll}>
        {note && <div className="ch-sr-note">{note}</div>}
        {query && !qErr && res.error && (
          <div className="ch-sr-note error">
            <div>{res.error}</div>
            <button type="button" className="ch-sr-more" onClick={() => setRetry(n => n + 1)}>Thử lại</button>
          </div>
        )}
        {!qErr && res.hits.map(hit => {
          const conv = chat.convs[hit.conversation_id]
          const mine = hit.sender_id === meId
          const sender = mine ? 'Bạn' : hit.sender_name || ''
          const title = global ? (conv ? L.convTitle(conv) : hit.conversation_name) || '' : sender
          /* tìm mọi hội thoại: tiền tố người gửi như danh sách hội thoại ("Bạn: " / nhóm "Lan: ") */
          const prefix = global && (mine || hit.conversation_type === 'group') && sender ? sender + ': ' : ''
          return (
            <button
              type="button"
              key={hit.message_id}
              className={'ch-sr-item' + (active === hit.message_id ? ' active' : '')}
              onClick={() => pick(hit)}
            >
              <ConvAvatar conv={hitAvatar(hit, conv, global)} size={36} />
              <div className="ch-sr-body">
                <div className="ch-sr-top">
                  <span className="ch-sr-name">{title}</span>
                  <span className="ch-sr-time" title={hit.created_at ? new Date(hit.created_at).toLocaleString('vi-VN') : ''}>
                    {L.listTimeLabel(hit.created_at, now)}
                  </span>
                </div>
                <div className="ch-sr-text">
                  {prefix && <span className="ch-sr-sender">{prefix}</span>}
                  <HitBody hit={hit} terms={terms} />
                </div>
              </div>
            </button>
          )
        })}
        {!qErr && res.hits.length > 0 && (
          res.more ? <div className="ch-sr-note">Đang tải thêm…</div>
            : res.next ? (
              <div className="ch-sr-note">
                {res.moreError && <div className="ch-sr-err">{res.moreError}</div>}
                <button type="button" className="ch-sr-more" onClick={() => { setRes(r => ({ ...r, moreError: '' })); loadMore() }}>Xem thêm kết quả</button>
              </div>
            )
              : <div className="ch-sr-note small">Đã hiện hết kết quả</div>
        )}
      </div>
    </div>
  )
}
