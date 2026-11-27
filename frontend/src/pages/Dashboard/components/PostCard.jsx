import { useState } from 'react'
import { statsSummary } from '../../../data/dashboardData'
import { useAccess } from '../../../services/accessService'

/* Các icon SVG dùng trong bài viết (giống NEWS_ICONS / ICON_* của bản HTML) */
const NEWS_ICONS = {
  building: <><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></>,
  award: <><circle cx="12" cy="8" r="6" /><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5" /></>,
}
const ICON_THUMB = <><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" /></>
const ICON_COMMENT = <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
const ICON_SHARE = <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>
const ICON_DOTS = <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>
const ICON_GLOBE = <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>
const ICON_PIN = <><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" /></>
const ICON_SMILE = <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>
const ICON_CAMERA = <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>

const lineIcon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

function PostComment({ c }) {
  return (
    <>
      <div className="db-post-comments-link">Xem thêm bình luận</div>
      <div className="db-post-comment">
        <div className="db-post-comment-avatar" style={{ background: `var(--${c.color}-tint)`, color: `var(--${c.color})` }}>{c.initials}</div>
        <div className="db-post-comment-body">
          <div className="db-post-comment-bubble">
            <div className="db-post-comment-author">{c.author}{c.isAuthor && <span className="db-post-comment-author-badge">Tác giả</span>}</div>
            <div className="db-post-comment-text">{c.text}</div>
          </div>
          <div className="db-post-comment-meta"><span>{c.time}</span><span className="db-reply-action">Thích</span><span className="db-reply-action">Phản hồi</span></div>
        </div>
      </div>
      <div className="db-post-comment-input-row">
        <div className="db-post-avatar" style={{ width: 30, height: 30, fontSize: 11, background: '#2A3040', color: '#fff', borderColor: '#2A3040' }}>TA</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', background: 'var(--surface-alt)', borderRadius: 20, padding: '7px 12px', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, color: 'var(--text-muted)', fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Bình luận dưới tên Trần Anh...</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flex: 'none', cursor: 'pointer' }}>{ICON_SMILE}</svg>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flex: 'none', cursor: 'pointer' }}>{ICON_CAMERA}</svg>
        </div>
      </div>
    </>
  )
}

/* Một bài viết trong bảng tin (giống renderPost). Nhãn "Bài viết đã ghim" nằm ngoài thẻ, như bản HTML */
export default function PostCard({ post: p }) {
  const { can } = useAccess()
  // Giữ logic cũ của trang React: bấm "Xem thêm" thì ẩn liên kết đi
  const [expanded, setExpanded] = useState(false)
  const accent = `var(--${p.color})`
  const tint = `var(--${p.color}-tint)`
  const summary = statsSummary(p)

  return (
    <>
      {p.pinned && (
        <div className="db-post-pinned-label">
          <svg width="13" height="13" {...lineIcon}>{ICON_PIN}</svg>Bài viết đã ghim
        </div>
      )}
      <div className="db-post-card">
        <div className="db-post-head">
          <div className="db-post-avatar" style={{ background: tint, color: accent, borderColor: accent }}>{p.initials}</div>
          <div className="db-post-head-text">
            <div className="db-post-author">{p.author}</div>
            <div className="db-post-meta">
              <span className="db-time">{p.time}</span>
              {p.pinned
                ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: 'none' }}>{ICON_GLOBE}</svg>
                : <><span>·</span><span className="db-post-badge" style={{ background: tint, color: accent }}>{p.badge}</span></>}
            </div>
          </div>
          {(can('newsfeed', 'tintuc', 'edit') || can('newsfeed', 'tintuc', 'delete')) && (
            <button className="db-post-menu-btn">
              <svg width="18" height="18" {...lineIcon} strokeWidth="1.75">{ICON_DOTS}</svg>
            </button>
          )}
        </div>

        <div className="db-post-body">
          <div className="db-post-title">{p.title}</div>
          <div className="db-post-text">
            {p.text}
            {p.readMore && !expanded && <> <span className="db-post-readmore" onClick={() => setExpanded(true)}>Xem thêm</span></>}
          </div>
        </div>

        {p.media && (
          <div className="db-post-media" style={{ background: p.media.gradient, aspectRatio: p.media.ratio || '4 / 3' }}>
            <svg width="20%" height="20%" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ minWidth: 36, minHeight: 36, maxWidth: 64, maxHeight: 64 }}>
              {NEWS_ICONS[p.media.icon]}
            </svg>
          </div>
        )}

        {(p.likes || p.comments || p.shares) ? (
          <div className="db-post-stats">
            <div className="db-post-stats-left">
              {p.likes > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={accent} stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICON_THUMB}</svg>
                  {p.likes}
                </span>
              )}
              {summary && <span>{summary}</span>}
            </div>
            {p.liked && (
              <div className="db-post-liked-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICON_THUMB}</svg>
              </div>
            )}
          </div>
        ) : null}

        <div className="db-post-actions">
          <button className={`db-fb-action${p.liked ? ' liked' : ''}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill={p.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={p.liked ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round">{ICON_THUMB}</svg>
            Thích
          </button>
          <button className="db-fb-action"><svg width="15" height="15" {...lineIcon}>{ICON_COMMENT}</svg>Bình luận</button>
          <button className="db-fb-action"><svg width="15" height="15" {...lineIcon}>{ICON_SHARE}</svg>Chia sẻ</button>
        </div>

        {p.comment && <PostComment c={p.comment} />}
      </div>
    </>
  )
}
