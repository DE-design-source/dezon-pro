import { useEffect, useRef, useState } from 'react'
import {
  MEMBERS, STATUS_LABEL, avatarColor, initials, parseD, dayDiff, fmtFull, statusOf,
} from '../../../data/quanLyThietKeData'

const MENTION_QUERY_RE = /(?:^|\s)@([\p{L}]*)$/u
const MENTION_TEXT_RE = /@([\p{L}\s]+?)(?=[.,!?]|\s@|$)/gu

/* Tô sáng "@Tên" trong nội dung bình luận (cùng quy tắc với bản HTML) */
function MentionText({ text }) {
  const parts = []
  let last = 0
  for (const m of text.matchAll(MENTION_TEXT_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<span key={m.index} className="tk-comment-mention">@{m[1].trim()}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function StatusBadge({ className, style, children }) {
  return (
    <span className={`tk-status-badge ${className || ''}`} style={style}>
      <span className="tk-dot" />{children}
    </span>
  )
}

export default function TaskDrawer({ task, open, comments, onClose, onAddComment, onConfirm, canEdit = true, canComment = canEdit }) {
  const [input, setInput] = useState('')
  const [mention, setMention] = useState(null) // { items, active }
  const inputRef = useRef(null)
  const menuRef = useRef(null)

  // Mở công việc khác → xoá nội dung đang soạn (giống openDrawer của bản HTML)
  useEffect(() => {
    setInput('')
    setMention(null)
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }, [task && task.id, open])

  useEffect(() => {
    if (!mention) return
    const close = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) && e.target !== inputRef.current) setMention(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [mention])

  function updateMention(value, cursor) {
    const match = value.slice(0, cursor).match(MENTION_QUERY_RE)
    if (!match) { setMention(null); return }
    const q = match[1].toLowerCase()
    const items = MEMBERS.filter(m => m.toLowerCase().includes(q)).slice(0, 6)
    setMention(items.length ? { items, active: 0 } : null)
  }

  function insertMention(name) {
    const el = inputRef.current
    const pos = el.selectionStart
    const upToCursor = input.slice(0, pos)
    const replaced = upToCursor.replace(MENTION_QUERY_RE, m => (m.startsWith(' ') ? ' ' : '') + '@' + name + ' ')
    setInput(replaced + input.slice(pos))
    setMention(null)
    el.focus()
  }

  function send() {
    const text = input.trim()
    if (!text || !task) return
    onAddComment(task.id, text)
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  function handleInput(e) {
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 90) + 'px'
    setInput(el.value)
    updateMention(el.value, el.selectionStart)
  }

  function handleKeyDown(e) {
    if (mention && mention.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention(m => ({ ...m, active: Math.min(m.active + 1, m.items.length - 1) })); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention(m => ({ ...m, active: Math.max(m.active - 1, 0) })); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mention.items[mention.active]); return }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const isFin = !!(task && task.finType)
  const isConfirmed = !task || task.confirmed !== false
  const st = task ? statusOf(task) : 'notstarted'
  const list = (task && comments[task.id]) || []

  let planDiff = null
  if (task && isFin && task.planStart && isConfirmed) {
    const diff = dayDiff(parseD(task.planStart), parseD(task.start))
    planDiff = diff > 0 ? { text: `Trễ ${diff} ngày`, color: 'var(--expense)' }
      : diff < 0 ? { text: `Sớm ${-diff} ngày`, color: 'var(--income)' }
        : { text: 'Đúng kế hoạch', color: 'var(--text-dim)' }
  }

  let statusNode = null
  let note = 'Chưa có ghi chú cho công việc này.'
  if (task && isFin) {
    if (!isConfirmed) {
      statusNode = <StatusBadge className="tk-status-pending">Chờ Kế toán xác nhận</StatusBadge>
      note = task.finType === 'thu'
        ? 'Người lập timeline (Quản lý dự án) đã đặt kế hoạch thu tiền. Khoản này cần Kế toán xác nhận đã thực thu và nhập ngày thực tế trước khi ghi nhận vào dòng tiền.'
        : 'Người lập timeline (Quản lý dự án) đã đặt kế hoạch chi tiền. Khoản này cần Kế toán xác nhận đã thực chi và nhập ngày thực tế trước khi ghi nhận vào dòng tiền.'
    } else {
      statusNode = <StatusBadge className={`tk-status-${task.finType === 'thu' ? 'income' : 'expense'}`}>{task.finType === 'thu' ? 'Thu tiền' : 'Chi tiền'} — đã xác nhận</StatusBadge>
      note = task.finType === 'thu'
        ? 'Khoản thu theo tiến độ hợp đồng, đã được Kế toán xác nhận và đối chiếu.'
        : 'Khoản chi phục vụ thi công/mua sắm, đã được Kế toán xác nhận và đối chiếu chứng từ.'
    }
  } else if (task) {
    statusNode = <StatusBadge className={`tk-status-${st}`}>{STATUS_LABEL[st]}</StatusBadge>
    note = task.critical
      ? 'Công việc nằm trên đường găng — mọi chậm trễ sẽ ảnh hưởng trực tiếp đến ngày bàn giao dự án.'
      : 'Công việc có thời gian dự phòng, chưa ảnh hưởng đến tiến độ tổng thể nếu chậm nhẹ.'
  }

  return (
    <>
      <div className={`tk-scrim${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`tk-drawer${open ? ' open' : ''}`}>
        <div className="tk-drawer-head">
          <h2>{task ? task.name : '—'}</h2>
          <button className="tk-drawer-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="tk-drawer-body">
          <div className="tk-d-row">
            <div className="tk-d-field">
              <span className="tk-fl">{isFin ? (isConfirmed ? 'Ngày thực tế' : 'Ngày kế hoạch') : 'Bắt đầu'}</span>
              <span className="tk-fv mono">{task ? fmtFull(parseD(isFin && !isConfirmed ? task.planStart : task.start)) : '—'}</span>
            </div>
            <div className="tk-d-field"><span className="tk-fl">Kết thúc</span><span className="tk-fv mono">{task ? fmtFull(parseD(task.end)) : '—'}</span></div>
          </div>
          {planDiff && (
            <div className="tk-d-row">
              <div className="tk-d-field"><span className="tk-fl">Ngày kế hoạch</span><span className="tk-fv mono">{fmtFull(parseD(task.planStart))}</span></div>
              <div className="tk-d-field"><span className="tk-fl">Chênh lệch</span><span className="tk-fv" style={{ color: planDiff.color }}>{planDiff.text}</span></div>
            </div>
          )}
          <div className="tk-d-row">
            <div className="tk-d-field">
              <span className="tk-fl">Thời lượng</span>
              <span className="tk-fv">{!task ? '—' : isFin ? 'Giao dịch' : task.milestone ? 'Mốc thời gian' : `${dayDiff(parseD(task.start), parseD(task.end)) + 1} ngày`}</span>
            </div>
            <div className="tk-d-field"><span className="tk-fl">Phụ trách</span><span className="tk-fv">{(task && task.assignee) || '—'}</span></div>
          </div>
          {isFin && (
            <div className="tk-d-field">
              <span className="tk-fl">Số tiền</span>
              <span className="tk-fv mono" style={{ fontSize: 16, fontWeight: 600, color: task.finType === 'thu' ? 'var(--income)' : 'var(--expense)' }}>
                {(task.finType === 'thu' ? '+ ' : '− ') + task.amount}
              </span>
            </div>
          )}
          {!isFin && (
            <div className="tk-d-field">
              <span className="tk-fl">Tiến độ hoàn thành</span>
              <span className="tk-fv">{task ? task.progress : 0}%</span>
              <div className="tk-progress-track"><div className="tk-fill" style={{ width: `${task ? task.progress : 0}%`, background: task ? `var(--${st})` : undefined }} /></div>
            </div>
          )}
          <div className="tk-d-field">
            <span className="tk-fl">Trạng thái</span>
            <span>{statusNode}</span>
          </div>
          <div className="tk-d-field">
            <span className="tk-fl">Ghi chú</span>
            <div className="tk-drawer-note">{note}</div>
          </div>
          {isFin && !isConfirmed && (
            <div className="tk-d-field">
              <span className="tk-fl">Luồng xác nhận</span>
              <div className="tk-drawer-note" style={{ marginBottom: 8 }}>
                Đang chờ {task.assignee} (Kế toán) xác nhận ngày {task.finType === 'thu' ? 'thực thu' : 'thực chi'} thực tế.
              </div>
              {canEdit && <button type="button" className="tk-comment-send-btn tk-confirm-btn" onClick={() => onConfirm(task)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Xác nhận đã thu/chi
              </button>}
            </div>
          )}
          <div className="tk-d-field">
            <span className="tk-fl">Bình luận</span>
            <div className="tk-comment-list">
              {list.length === 0
                ? <span className="tk-comment-empty">Chưa có bình luận nào. Hãy là người đầu tiên trao đổi về công việc này.</span>
                : list.map((c, i) => (
                  <div key={i} className="tk-comment-item">
                    <span className="tk-comment-avatar" style={{ background: avatarColor(c.who) }}>{initials(c.who)}</span>
                    <div className="tk-comment-col">
                      <div className="tk-comment-head"><span className="tk-comment-name">{c.who}</span><span className="tk-comment-time">{c.time}</span></div>
                      <div className="tk-comment-text"><MentionText text={c.text} /></div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
        {canComment && <div className="tk-comment-composer">
          {mention && (
            <div className="tk-mention-menu" ref={menuRef}>
              {mention.items.map((m, i) => (
                <div
                  key={m}
                  className={`tk-mention-item${i === mention.active ? ' active' : ''}`}
                  onMouseDown={e => { e.preventDefault(); insertMention(m) }}
                >
                  <span className="tk-m-avatar" style={{ background: avatarColor(m) }}>{initials(m)}</span>{m}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Viết bình luận... gõ @ để nhắc ai đó"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
          <div className="tk-comment-composer-row">
            <span className="tk-comment-hint">Enter để gửi · @ để nhắc nhân sự</span>
            <button className="tk-comment-send-btn" title="Gửi bình luận" onClick={send}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>}
      </div>
    </>
  )
}
