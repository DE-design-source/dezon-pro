import { NEWS_POSTS, NEWS_FILTERS } from '../../../data/dashboardData'
import PostCard from './PostCard'
import { useAccess } from '../../../services/accessService'

/* Tab "Tin tức": tiêu đề, ô đăng tin, bộ lọc và danh sách bài viết */
export default function NewsTab({ active, filter, onFilter }) {
  const { can } = useAccess()
  const posts = NEWS_POSTS.filter(p => filter === 'all' || p.cat === filter)

  return (
    <div className="db-view" style={{ display: active ? 'flex' : 'none' }}>
      <div className="db-section-head">
        <div className="db-section-icon" style={{ background: 'var(--primary-tint)', color: 'var(--primary)' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2>Tin tức &amp; cập nhật công ty</h2>
          <p>Cập nhật hàng ngày: dự án mới, sự kiện, giải thưởng và thông báo nội bộ.</p>
        </div>
      </div>

      {can('newsfeed', 'tintuc', 'create') && <div className="db-composer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="db-post-avatar" style={{ background: 'var(--primary-tint)', color: 'var(--primary)', borderColor: 'var(--primary)' }}>TA</div>
          <div className="db-composer-pill">Bạn có tin gì muốn chia sẻ?</div>
        </div>
        <div style={{ height: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="db-composer-action">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
            Ảnh/Video
          </button>
          <button className="db-composer-action">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--finance)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            Sự kiện
          </button>
          <button className="db-composer-post">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Đăng tin
          </button>
        </div>
      </div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {NEWS_FILTERS.map(f => (
          <button key={f.key} className={`db-news-filter${filter === f.key ? ' active' : ''}`} onClick={() => onFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {posts.map(p => <PostCard key={p.id} post={p} />)}
      </div>
    </div>
  )
}
