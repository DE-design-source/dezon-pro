import { useEffect, useState } from 'react'
import { TICKET_GROUPS, TICKET_CATEGORIES, isOpenTicket, categoryOf } from '../../../data/itData'

/* Thẻ "Yêu cầu theo hạng mục" hiện tối đa CAT_MAX hạng mục; nhiều hơn thì có nút tròn (>) mở ô đầy đủ bên phải cột */
const CAT_MAX = 4

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const fmtPct = n => String(n).replace('.', ',') + '%'
const ic = d => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>

/* Cột trái Bảng điều khiển IT — cùng dáng cột trái Bảng điều khiển QS (DashSummary + QuickActions):
   thẻ 1 số lớn + thanh phân bổ + các dòng số · thẻ 2 thanh ngang theo hạng mục · thẻ 3 thao tác nhanh */
export default function DashSide({ tickets, onCreate, onGoto }) {
  const total = tickets.length
  const open = tickets.filter(isOpenTicket)
  const done = total - open.length
  const urgent = open.filter(t => t.priority === 'high' || t.priority === 'urgent').length
  const byStatus = TICKET_GROUPS.map(([k, l, c]) => ({ k, l, c, n: tickets.filter(t => t.status === k).length })).filter(x => x.n)
  const cats = TICKET_CATEGORIES.map(([k, l]) => ({ k, l, n: tickets.filter(t => categoryOf(t) === k).length })).filter(x => x.n).sort((a, b) => b.n - a.n)
  const maxCat = cats[0]?.n || 1
  const more = cats.length - CAT_MAX
  const [catOpen, setCatOpen] = useState(false)
  useEffect(() => {
    if (!catOpen) return undefined
    const esc = e => { if (e.key === 'Escape') setCatOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [catOpen])
  const catRow = (c, i) => (
    <div key={c.k} className="it-sm-g">
      <div className="t"><span className="nm">{c.l}</span><b>{c.n}</b></div>
      <div className="tr">
        <span className="track"><i className={i === 0 ? 'top' : ''} style={{ width: (c.n / maxCat) * 100 + '%' }} /></span>
        <span className="pc">{fmtPct(pct(c.n, total))}</span>
      </div>
    </div>
  )

  return (
    <aside className="it-side">
      <section className="it-card it-sm">
        <div className="it-sm-h"><h3>Yêu cầu đang mở</h3><span className="it-sm-sub">{total} yêu cầu · Tất cả</span></div>
        <div className="it-sm-hero">
          <div className="it-sm-big">{open.length}</div>
          <div className="it-sm-chiprow">
            <span className="it-sm-chip"><i>▲</i>27 xong tuần này</span>
            <span>+5 so với tuần trước</span>
          </div>
          <div className="it-sm-split">
            <span className="it-sm-cap">Phân bổ theo trạng thái</span>
            <div className="it-sm-bar">
              {byStatus.map(s => <i key={s.k} title={`${s.l}: ${s.n}`} style={{ width: pct(s.n, total) + '%', background: s.c }} />)}
            </div>
            <div className="it-sm-barl">
              <span>Đang mở {fmtPct(pct(open.length, total))}</span>
              <span className="pos">Đã xong {fmtPct(pct(done, total))}</span>
            </div>
          </div>
        </div>
        <dl className="it-sm-rows">
          <div><dt>Quan trọng đang mở</dt><dd><b className={urgent ? 'warn' : ''}>{urgent}</b></dd></div>
          <div><dt>Hoàn thành tuần này</dt><dd><b>27</b></dd></div>
        </dl>
      </section>

      <section className="it-card it-sm">
        <div className="it-sm-h"><h3>Yêu cầu theo hạng mục</h3><span className="it-sm-sub" title={cats.length + " hạng mục"}>{cats.length} mục</span>
          {more > 0 && (
            <button type="button" className={'it-sm-more' + (catOpen ? ' on' : '')} aria-expanded={catOpen}
              title={catOpen ? 'Đóng danh sách hạng mục' : 'Còn ' + more + ' hạng mục chưa hiện - bấm để xem tất cả'} onClick={() => setCatOpen(o => !o)}>
              {ic(<polyline points="9 18 15 12 9 6" />)}{!catOpen && <em>+{more}</em>}
            </button>
          )}
        </div>
        <div className="it-sm-grp">{cats.slice(0, CAT_MAX).map(catRow)}</div>
      </section>
      {/* Ô "Yêu cầu theo hạng mục" đầy đủ: mở bên phải cột trái, đè lên danh sách (như "Giá trị theo nhóm" của QS) */}
      {catOpen && (
        <aside className="it-card it-sm it-sm-panel" aria-label="Yêu cầu theo hạng mục - đầy đủ">
          <div className="it-sm-h"><h3>Yêu cầu theo hạng mục</h3><span className="it-sm-sub" title={cats.length + " hạng mục"}>{cats.length} mục</span>
            <button type="button" className="it-sm-x" title="Đóng (Esc)" onClick={() => setCatOpen(false)}>✕</button>
          </div>
          <div className="it-sm-grp">{cats.map(catRow)}</div>
        </aside>
      )}

      <section className="it-card it-sm">
        <div className="it-sm-h it-sm-hq">
          {ic(<><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>)}
          <h3>Thao tác nhanh</h3>
        </div>
        <div className="it-quick">
          <button onClick={onCreate}>{ic(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)}Tạo yêu cầu</button>
          <button onClick={() => onGoto('assets')}>{ic(<><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></>)}Thiết bị</button>
          <button onClick={() => onGoto('releases')}>{ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>)}Ghi chú cập nhật</button>
          <button onClick={() => onGoto('nhansu')}>{ic(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>)}Cơ cấu phòng ban</button>
        </div>
      </section>
    </aside>
  )
}
