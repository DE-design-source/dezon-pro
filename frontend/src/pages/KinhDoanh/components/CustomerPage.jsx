import { useEffect, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL, DEPT_LABEL } from '../../../data/kinhDoanhData'
import { useKdMap, saveKdOptions } from './ShortlistSelect'
import { fmtTy, stageAccent, lmInitials } from '../utils'

/* Trang khách hàng riêng: hồ sơ, tiến trình pipeline, lịch sử chăm sóc & chi tiết từng lần tương tác */
export const INTERACTION_TYPES = {
  call: { label: 'Gọi điện', color: 'var(--primary)', icon: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' },
  meeting: { label: 'Gặp mặt', color: 'var(--sales)', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8' },
  site: { label: 'Khảo sát công trình', color: 'var(--finance)', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  zalo: { label: 'Zalo / tin nhắn', color: '#0EA5E9', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  email: { label: 'Email', color: 'var(--qs)', icon: 'M4 4h16v16H4zM22 6l-10 7L2 6' },
  quote: { label: 'Gửi báo giá', color: 'var(--marketing)', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5' },
  note: { label: 'Ghi chú', color: 'var(--text-muted)', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
}
export const OUTCOMES = { good: ['Tích cực', 'var(--success)'], neutral: ['Đang cân nhắc', 'var(--gold)'], bad: ['Chưa hài lòng', 'var(--danger)'] }

const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmtD = iso => (iso ? iso.split('-').reverse().join('/') : '')

/* Lịch sử mẫu — sinh theo giai đoạn hiện tại của khách hàng */
export function seedInteractions(l) {
  const by = (l.assignees && l.assignees[0]?.name) || l.creator || 'Nhân viên KD'
  const start = l.createdAt || '2026-09-01'
  const idx = Math.max(0, STAGES.indexOf(l.stage))
  const steps = [
    { type: 'call', title: 'Cuộc gọi đầu tiên', content: `Khách liên hệ qua hotline, quan tâm ${(l.type || 'công trình').toLowerCase()} khoảng ${fmtTy(l.value)}. Đã giới thiệu năng lực & hẹn gặp.`, outcome: 'good' },
    { type: 'meeting', title: 'Gặp tư vấn tại văn phòng', content: 'Trao đổi nhu cầu, phong cách mong muốn, ngân sách & tiến độ dự kiến. Khách gửi bản vẽ hiện trạng.', outcome: 'good' },
    { type: 'site', title: 'Khảo sát hiện trạng', content: 'Đo đạc hiện trạng, chụp ảnh, ghi nhận vướng mắc về kết cấu & hạ tầng.', outcome: 'neutral' },
    { type: 'quote', title: 'Gửi báo giá thiết kế - khái toán', content: `Báo giá tổng ${fmtTy(l.value)}; khách xin thêm phương án vật liệu tiết kiệm.`, outcome: 'neutral' },
    { type: 'meeting', title: 'Đàm phán điều khoản', content: 'Thống nhất tiến độ thanh toán 30-40-30, khách đề nghị giảm 3%.', outcome: 'neutral' },
    { type: 'meeting', title: 'Ký hợp đồng', content: 'Khách ký hợp đồng, chuyển tạm ứng đợt 1.', outcome: 'good' },
  ]
  const n = l.stage === 'truot-thau' ? 3 : Math.min(steps.length, idx + 1)
  const list = steps.slice(0, n).map((s, i) => ({ id: `${l.id}-h${i}`, date: addDays(start, i * 4), by, ...s }))
  if (l.stage === 'truot-thau') list.push({ id: `${l.id}-lost`, date: addDays(start, 14), by, type: 'call', title: 'Khách chọn đơn vị khác', content: 'Khách phản hồi giá cao hơn đối thủ ~8%. Lưu hồ sơ để chăm sóc lại sau 6 tháng.', outcome: 'bad' })
  if (l.notes) list.push({ id: `${l.id}-note`, date: start, by: l.creator || by, type: 'note', title: 'Ghi chú khi tạo khách hàng', content: l.notes, outcome: '' })
  return list.sort((a, b) => b.date.localeCompare(a.date))
}

/* Dải giai đoạn: ẩn thanh cuộn mặc định; khi tràn thì hiện nút ‹ › + mờ mép, lăn chuột để cuộn ngang */
function FlowStrip({ stageKey, children }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  const update = () => { const el = ref.current; if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }) }
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // đưa giai đoạn hiện tại vào tầm nhìn
    const now = el.querySelector('.now')
    if (now) el.scrollLeft = Math.max(0, now.offsetLeft - el.clientWidth / 2 + now.offsetWidth / 2)
    update()
    const onWheel = e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { e.preventDefault(); el.scrollLeft += e.deltaY } }
    el.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(update); ro.observe(el)
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect() }
  }, [stageKey])
  const step = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.6, behavior: 'smooth' })
  return (
    <div className={`kd-cp-flowwrap${edge.l ? ' fade-l' : ''}${edge.r ? ' fade-r' : ''}`}>
      {edge.l && <button className="kd-cp-flownav l" onClick={() => step(-1)} aria-label="Cuộn trái"><Ic d="m15 18-6-6 6-6" size={14} /></button>}
      <div className="kd-cp-flow" ref={ref} onScroll={update}>{children}</div>
      {edge.r && <button className="kd-cp-flownav r" onClick={() => step(1)} aria-label="Cuộn phải"><Ic d="m9 18 6-6-6-6" size={14} /></button>}
    </div>
  )
}

/* Đánh giá tiềm năng 1-5 sao (lưu chung công ty: kdOptions.rating {mã lead: số sao}); bấm lại đúng số sao đang chọn = bỏ đánh giá.
   small: bản gọn trên thẻ Pipeline (không nhãn chữ, bấm không mở thẻ / không kéo thẻ) */
const RATE_LABEL = ['', 'Rất thấp', 'Thấp', 'Trung bình', 'Cao', 'Rất cao']
export function RatingStars({ id, small }) {
  const map = useKdMap('rating')
  const v = Number(map[id]) || 0
  const [hov, setHov] = useState(0)
  const set = n => { const m = { ...map }; if (n === v) delete m[id]; else m[id] = n; saveKdOptions('rating', m) }
  const show = hov || v
  return (
    <span className={'kd-cp-stars' + (small ? ' sm' : '')} onMouseLeave={() => setHov(0)} title={v ? 'Tiềm năng: ' + RATE_LABEL[v] + ' (bấm lại để bỏ)' : 'Đánh giá tiềm năng'}
      onClick={small ? e => e.stopPropagation() : undefined} draggable={small ? false : undefined} onDragStart={small ? e => { e.preventDefault(); e.stopPropagation() } : undefined}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={n <= show ? 'on' : ''} onMouseEnter={() => setHov(n)} onClick={() => set(n)} aria-label={n + ' sao'}>
          <svg width={small ? 13 : 16} height={small ? 13 : 16} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
        </button>
      ))}
      {!small && <em>{show ? RATE_LABEL[show] : 'Chưa đánh giá'}</em>}
    </span>
  )
}

const Ic = ({ d, size = 15 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>

export default function CustomerPage({ lead: l, interactions, onAddInteraction, onBack, onEdit, onMove, me }) {
  const blank = () => ({ type: 'call', date: new Date().toISOString().slice(0, 10), title: '', content: '', outcome: 'good', next: '', nextNote: '' })
  const [f, setF] = useState(blank)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('all')
  useEffect(() => { setAdding(false); setFilter('all') }, [l?.id])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role=dialog]')) { if (adding) setAdding(false); else onBack() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [adding, onBack])
  if (!l) return null

  const accent = stageAccent(l.stage)
  const list = interactions.filter(x => filter === 'all' || x.type === filter)
  const upcoming = interactions.filter(x => x.next).map(x => ({ date: x.next, note: x.nextNote || `Theo dõi sau: ${x.title}`, from: x })).sort((a, b) => a.date.localeCompare(b.date))
  const last = interactions[0]
  const flow = STAGES.filter(s => s !== 'khong-tham-gia' && s !== 'truot-thau' && s !== 'spam')
  const cur = flow.indexOf(l.stage)
  const counts = Object.fromEntries(Object.keys(INTERACTION_TYPES).map(k => [k, interactions.filter(x => x.type === k).length]))
  function save() {
    if (!f.title.trim() && !f.content.trim()) return
    onAddInteraction({ ...f, id: 'i' + Date.now(), by: me, title: f.title.trim() || INTERACTION_TYPES[f.type].label, content: f.content.trim() })
    setF(blank()); setAdding(false)
  }

  return (
    <div className="kd-cp">
      <div className="kd-cp-head">
        <button className="kd-cp-back" onClick={onBack} title="Quay lại (Esc)"><Ic d="M19 12H5M12 19l-7-7 7-7" />Khách hàng</button>
        <div className="kd-cp-title">
          <h2>{l.name}</h2>
          <div><span className="kd-cp-stage" style={{ background: accent ? accent.bg : 'var(--sales-tint)', color: accent ? accent.color : 'var(--sales)' }}>{STAGE_LABEL[l.stage]}</span><span>{l.type} · {fmtTy(l.value)} · {DEPT_LABEL[l.dept]}</span></div>
        </div>
        <span style={{ flex: 1 }} />
        {l.phone && <a className="kd-cp-btn" href={`tel:${l.phone.replace(/\s/g, '')}`}><Ic d={INTERACTION_TYPES.call.icon} size={14} />Gọi</a>}
      </div>

      {/* tiến trình pipeline */}
      <FlowStrip stageKey={l.stage}>
        {flow.map((s, i) => (
          <button key={s} className={`kd-cp-step${i < cur ? ' done' : ''}${i === cur ? ' now' : ''}`} onClick={() => onMove(l.id, s)} title={`Chuyển sang "${STAGE_LABEL[s]}"`}>
            <i>{i < cur ? '✓' : i + 1}</i><span>{STAGE_LABEL[s]}</span>
          </button>
        ))}
        {l.stage === 'truot-thau' && <span className="kd-cp-lost">Đã trượt thầu</span>}
        {l.stage === 'spam' && <span className="kd-cp-lost">Spam</span>}
        {l.stage === 'khong-tham-gia' && <span className="kd-cp-lost">Không tham gia</span>}
      </FlowStrip>

      <div className="kd-cp-body">
        <aside className="kd-cp-side">
          <section>
            <h4>Thông tin liên hệ
              <button type="button" className="kd-cp-edit" title="Sửa thông tin khách hàng" aria-label="Sửa thông tin" onClick={onEdit}>
                <Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={14} />
              </button>
            </h4>
            <dl>
              <dt>Điện thoại</dt><dd>{l.phone || '—'}</dd>
              <dt>Email</dt><dd>{l.email || '—'}</dd>
              <dt>Địa chỉ</dt><dd>{l.address || '—'}</dd>
              <dt>Nguồn</dt><dd>{l.source || '—'}</dd>
              <dt>Tiềm năng</dt><dd><RatingStars id={String(l.id)} /></dd>
            </dl>
          </section>
          <section>
            <h4>Dự án quan tâm</h4>
            <dl>
              <dt>Loại dự án</dt><dd>{l.projectType || l.type}</dd>
              <dt>Quy mô</dt><dd>{l.scale || '—'}</dd>
              <dt>Giá trị ước tính</dt><dd className="kd-cp-money">{fmtTy(l.value)}</dd>
              <dt>Ngày tạo</dt><dd>{fmtD(l.createdAt)}</dd>
            </dl>
            {l.categories?.length > 0 && <div className="kd-cp-tags">{l.categories.map(c => <span key={c}>{c}</span>)}</div>}
          </section>
          <section>
            <h4>Phụ trách</h4>
            <div className="kd-cp-people">
              {[['Phòng', DEPT_LABEL[l.dept]], ['Khởi tạo', l.creator], ['Quản lý', l.manager], ...(l.assignees || []).map(a => [a.role || 'Phụ trách', a.name])].filter(x => x[1]).map(([r, n], i) => (
                <div key={i}><span className="kd-cp-av sm">{lmInitials(n)}</span><span><b>{n}</b><em>{r}</em></span></div>
              ))}
            </div>
          </section>
          <section>
            <h4>Tổng quan chăm sóc</h4>
            <div className="kd-cp-stats">
              <div><b>{interactions.length}</b><span>lần tương tác</span></div>
              <div><b>{last ? fmtD(last.date) : '—'}</b><span>liên hệ gần nhất</span></div>
            </div>
            <div className="kd-cp-mini">{Object.entries(INTERACTION_TYPES).filter(([k]) => counts[k]).map(([k, t]) => <span key={k} style={{ color: t.color }}><Ic d={t.icon} size={12} />{counts[k]}</span>)}</div>
          </section>
        </aside>

        <main className="kd-cp-main">
          {upcoming.length > 0 && (
            <div className="kd-cp-card kd-cp-upcoming">
              <h3>Lịch chăm sóc sắp tới</h3>
              {upcoming.map((u, i) => (
                <div key={i} className="kd-cp-up"><span className="kd-cp-up-date">{fmtD(u.date)}</span><span>{u.note}</span></div>
              ))}
            </div>
          )}

          {adding && (
            <div className="kd-cp-card kd-cp-form">
              <h3>Ghi nhận tương tác mới</h3>
              <div className="kd-cp-types">
                {Object.entries(INTERACTION_TYPES).map(([k, t]) => (
                  <button key={k} type="button" className={f.type === k ? 'active' : ''} style={{ '--c': t.color }} onClick={() => setF({ ...f, type: k })}><Ic d={t.icon} size={13} />{t.label}</button>
                ))}
              </div>
              <div className="kd-cp-grid">
                <label><span>Ngày</span><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
                <label><span>Tiêu đề</span><input autoFocus value={f.title} placeholder={INTERACTION_TYPES[f.type].label} onChange={e => setF({ ...f, title: e.target.value })} /></label>
                <label className="full"><span>Nội dung trao đổi</span><textarea rows={3} value={f.content} placeholder="Khách hỏi gì, đã tư vấn gì, phản hồi của khách…" onChange={e => setF({ ...f, content: e.target.value })} /></label>
                <div className="full"><span>Kết quả</span>
                  <div className="kd-cp-outcomes">{Object.entries(OUTCOMES).map(([k, [lab, c]]) => <button key={k} type="button" className={f.outcome === k ? 'active' : ''} style={{ '--c': c }} onClick={() => setF({ ...f, outcome: k })}>{lab}</button>)}</div>
                </div>
                <label><span>Hẹn chăm sóc tiếp</span><input type="date" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
                <label><span>Việc cần làm</span><input value={f.nextNote} placeholder="VD: Gửi phương án vật liệu 2" onChange={e => setF({ ...f, nextNote: e.target.value })} /></label>
              </div>
              <div className="kd-cp-form-foot"><button className="kd-cp-btn" onClick={() => setAdding(false)}>Hủy</button><button className="kd-cp-btn primary" disabled={!f.title.trim() && !f.content.trim()} onClick={save}>Lưu tương tác</button></div>
            </div>
          )}

          <div className="kd-cp-card">
            <div className="kd-cp-tl-head">
              <h3>Lịch sử chăm sóc</h3>
              <button className="kd-cp-btn primary" onClick={() => setAdding(true)}><Ic d="M12 5v14M5 12h14" size={14} />Ghi nhận tương tác</button>
              <span style={{ flex: 1 }} />
              <div className="kd-cp-filter">
                <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tất cả ({interactions.length})</button>
                {Object.entries(INTERACTION_TYPES).filter(([k]) => counts[k]).map(([k, t]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{t.label} ({counts[k]})</button>)}
              </div>
            </div>
            {list.length === 0 && (
              <div className="kd-cp-empty">
                <span className="ic"><Ic d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" size={22} /></span>
                <b>Chưa có tương tác nào{filter !== 'all' ? ' thuộc loại này' : ''}</b>
                <span>Ghi lại cuộc gọi, tin nhắn, buổi gặp… để cả nhóm theo dõi quá trình chăm sóc khách hàng.</span>
                <button className="kd-cp-btn primary" onClick={() => setAdding(true)}><Ic d="M12 5v14M5 12h14" size={14} />Ghi nhận tương tác đầu tiên</button>
              </div>
            )}
            <ol className="kd-cp-tl">
              {list.map(x => {
                const t = INTERACTION_TYPES[x.type] || INTERACTION_TYPES.note
                const o = OUTCOMES[x.outcome]
                return (
                  <li key={x.id} style={{ '--c': t.color }}>
                    <div className="kd-cp-tl-body">
                      <div className="kd-cp-tl-top"><span className="kd-cp-tl-ic"><Ic d={t.icon} size={13} /></span><b>{x.title}</b><span className="kd-cp-tl-type">{t.label}</span>{o && <em style={{ color: o[1], background: `color-mix(in srgb, ${o[1]} 14%, transparent)` }}>{o[0]}</em>}<span className="kd-cp-tl-date">{fmtD(x.date)}</span></div>
                      {x.content && <p>{x.content}</p>}
                      <div className="kd-cp-tl-by"><span className="kd-cp-av sm">{lmInitials(x.by)}</span>{x.by}{x.next && <span className="kd-cp-tl-next">· Hẹn tiếp {fmtD(x.next)}{x.nextNote ? `: ${x.nextNote}` : ''}</span>}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          {(l.concept || l.notes || l.boqFile) && (
            <div className="kd-cp-card">
              <h3>Tài liệu & ghi chú</h3>
              {l.boqFile && <div className="kd-cp-file"><Ic d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />{l.boqFile}</div>}
              {l.concept && <p className="kd-cp-note"><b>Concept:</b> {l.concept}</p>}
              {l.notes && <p className="kd-cp-note"><b>Ghi chú nội bộ:</b> {l.notes}</p>}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
