import { useState } from 'react'
import { TICKETS, TICKET_GROUPS, PRIO_LABEL, PRIO_COLOR, TICKET_CATEGORIES, categoryOf } from '../../../data/itData'

const PAGE_SIZE = 10
const CATEGORY = Object.fromEntries(TICKET_CATEGORIES)
const GROUP = Object.fromEntries(TICKET_GROUPS.map(([key, label, color]) => [key, { label, color }]))
const toISO = d => d.split('/').reverse().join('-')
const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
const initials = n => String(n || '').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase()
const AV_COLORS = ['#2E7DD6', '#0E9F9A', '#8B3FD9', '#D9822B', '#C2185B', '#1E8E5A']
const avColor = n => AV_COLORS[[...String(n)].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_COLORS.length]

const Chevron = ({ d }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
const HEADERS = [['', ''], ['Yêu cầu', ''], ['Người yêu cầu', ''], ['Phụ trách', ''], ['Hạng mục', ''], ['Mức độ', 'c'], ['Trạng thái', 'c'], ['Deadline', 'c'], ['Ngày tạo', 'c'], ['Thao tác', 'c']]

/* Danh sách yêu cầu hỗ trợ — cùng dáng "Danh sách dự án" của Bảng điều khiển QS:
   thanh tiêu đề xanh đậm (lọc trạng thái, tìm kiếm, tạo yêu cầu) + bảng cột; bấm 1 dòng mở trang yêu cầu */
export default function TicketList({ tickets = TICKETS, highlightId, onOpen, onCreate }) {
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const sorted = [...tickets].sort((a, b) => toISO(b.date).localeCompare(toISO(a.date)) || b.id - a.id)
  const term = norm(q.trim())
  const searched = sorted.filter(t => !term || norm(`#${t.id} ${t.issue} ${t.requester}`).includes(term))
  const list = status === 'all' ? searched : searched.filter(t => t.status === status)
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const cur = Math.min(page, pages)
  const rows = list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const count = key => (key === 'all' ? searched.length : searched.filter(t => t.status === key).length)
  const go = p => setPage(Math.max(1, Math.min(pages, p)))
  const pick = key => { setStatus(key); setPage(1) }

  return (
    <section className="it-tl">
      <div className="it-tl-head">
        <span className="it-tl-hic">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </span>
        <h2>Danh sách yêu cầu</h2>
        <span className="it-tl-count">{tickets.length}</span>
        <div className="it-tl-seg" role="tablist" aria-label="Lọc theo trạng thái">
          <button className={status === 'all' ? 'on' : ''} onClick={() => pick('all')}>Tất cả <small>{count('all')}</small></button>
          {TICKET_GROUPS.map(([key, label, color]) => (
            <button key={key} className={status === key ? 'on' : ''} onClick={() => pick(key)}>
              <i style={{ background: color }} />{label} <small>{count(key)}</small>
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label className="it-tl-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input placeholder="Tìm mã, nội dung, người yêu cầu..." value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
        </label>
        {onCreate && (
          <button className="it-tl-create" onClick={onCreate}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Tạo yêu cầu
          </button>
        )}
      </div>

      <div className="it-card it-tl-table">
        <div className="it-tl-scroll">
          <div className="it-tl-rows">
            <div className="it-tl-row it-tl-th">
              {HEADERS.map(([h, c], i) => <span key={i} className={c}>{h}</span>)}
            </div>
            {rows.length === 0 && <div className="it-tl-empty">Không có yêu cầu phù hợp</div>}
            {rows.map(t => {
              const g = GROUP[t.status]
              const who = t.roles?.find(r => /thực thi/i.test(r.label))?.people || [t.assignee].filter(Boolean)
              return (
                <div key={t.id} className={`it-tl-row${highlightId === t.id ? ' new' : ''}`} onClick={() => onOpen?.(t)} title="Mở trang yêu cầu">
                  <span className="it-tl-ic"><i style={{ background: g?.color }} /></span>
                  <span className="it-tl-2">
                    <b>{t.reported && <em className="it-tl-bug" title="Gửi từ nút Báo lỗi (Dezbot)">Báo lỗi</em>}{t.issue}</b>
                    <small>#{t.id}{t.desc ? ' · ' + t.desc : ''}</small>
                  </span>
                  <span className="it-tl-2"><span>{t.requester}</span></span>
                  <span className="it-tl-who">
                    {who.length ? (
                      <>
                        <span className="it-tl-avs">{who.slice(0, 3).map(p => <i key={p} style={{ background: avColor(p) }} title={p}>{initials(p)}</i>)}</span>
                        <span className="it-tl-whon">{who.length > 1 ? who[0] + ' +' + (who.length - 1) : who[0]}</span>
                      </>
                    ) : <span className="nil">Chưa giao</span>}
                  </span>
                  <span className="it-tl-cat">{CATEGORY[categoryOf(t)]}</span>
                  <span className="c"><span className="it-tl-prio" style={{ '--c': PRIO_COLOR[t.priority] }}>{PRIO_LABEL[t.priority]}</span></span>
                  <span className="c"><span className="it-tl-st" style={{ '--c': g?.color }}>{g?.label}</span></span>
                  <span className="c it-tl-date">{t.deadline || <span className="nil">—</span>}</span>
                  <span className="c it-tl-date">{t.date}</span>
                  <span className="c"><button className="it-tl-open" onClick={e => { e.stopPropagation(); onOpen?.(t) }}>Mở</button></span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="it-tl-foot">
          <span>Hiển thị {rows.length ? (cur - 1) * PAGE_SIZE + 1 : 0}–{(cur - 1) * PAGE_SIZE + rows.length} / {list.length} yêu cầu · cập nhật {sorted[0]?.date}</span>
          <div className="it-tl-pager">
            <button disabled={cur <= 1} onClick={() => go(1)} title="Trang đầu"><Chevron d="m11 17-5-5 5-5M18 17l-5-5 5-5" /></button>
            <button disabled={cur <= 1} onClick={() => go(cur - 1)} title="Trang trước"><Chevron d="m15 18-6-6 6-6" /></button>
            <span className="it-tl-page">{cur} / {pages}</span>
            <button disabled={cur >= pages} onClick={() => go(cur + 1)} title="Trang sau"><Chevron d="m9 18 6-6-6-6" /></button>
            <button disabled={cur >= pages} onClick={() => go(pages)} title="Trang cuối"><Chevron d="m13 17 5-5-5-5M6 17l5-5-5-5" /></button>
          </div>
        </div>
      </div>
    </section>
  )
}
