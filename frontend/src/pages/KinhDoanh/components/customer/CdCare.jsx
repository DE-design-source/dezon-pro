import { useEffect, useRef, useState } from 'react'
import { INTERACTION_TYPES, OUTCOMES } from '../CustomerPage'
import { emitLeadChange } from '../../customerApi'
import './care.css'
import './care2.css'
import useDictation from './useDictation'

/* Khối "Cập nhật chăm sóc" của trang khách hàng dạng dashboard: tab lọc theo loại, ẩn / hiện log hệ thống,
   đếm tương tác + số ngày chưa liên hệ, ô ghi nhận nhanh, form đầy đủ (7 loại tương tác) và dòng thời gian chăm sóc.
   Dữ liệu = lịch sử chăm sóc (/sales/leads/:id/activities) do KinhDoanh.jsx tải, ghi qua onAddInteraction. */

export const Ic = ({ d, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
export const IC_EDIT = 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'
export const IC_X = 'M18 6 6 18M6 6l12 12'
export const IC_PLUS = 'M12 5v14M5 12h14'
export const IC_CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'
export const pad2 = n => String(n).padStart(2, '0')
export const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
export const fmtD = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
export const fmtDM = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')
const utc = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }
/* số ngày từ a tới b (b - a), theo lịch */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000)
const THU = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
export const weekdayOf = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return THU[new Date(y, m - 1, d).getDay()] }
/* Người liên quan của khách hàng (khi khối cha chưa truyền people) */
export function peopleOf(lead, me, people) {
  if (Array.isArray(people) && people.length) return people
  const l = lead || {}
  return [...new Set([me, l.manager, l.creator, ...(l.assignees || []).map(x => x && x.name)].map(x => String(x || '').trim()).filter(Boolean))]
}
/* Log hệ thống: ghi chú tự sinh khi phân công / chuyển giai đoạn, hoặc người viết là "Hệ thống" */
export const isSystemEntry = x => !!x && (String(x.by || '').trim() === 'Hệ thống'
  || (x.type === 'note' && /^(Phân công|Chuyển giai đoạn)/.test(String(x.title || '').trim())))

const OTHER = ['meeting', 'site', 'zalo', 'email', 'quote']
const TABS = [['all', 'Tất cả'], ['call', 'Gọi điện'], ['note', 'Ghi chú'], ['other', 'Khác']]
const SYS_IC = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'
/* nội dung nhiều hơn 6 dòng (vd bản ghi Live): thu gọn, bấm Xem hết */
const isLong = t => String(t).split('\n').length > 6
const inTab = (x, tab, sub) => tab === 'all' || (tab === 'other' ? (sub ? x.type === sub : OTHER.indexOf(x.type) >= 0) : x.type === tab)

export default function CdCare({ lead, me, interactions, onAddInteraction }) {
  const all = Array.isArray(interactions) ? interactions : []
  const [tab, setTab] = useState('all')
  const [sub, setSub] = useState('')            // tab Khác: lọc thêm 1 loại (meeting / site / zalo / email / quote)
  const [showSys, setShowSys] = useState(false)
  const [expand, setExpand] = useState(false)
  const [q, setQ] = useState('')
  const [qType, setQType] = useState('call')
  const [form, setForm] = useState(null)        // form đầy đủ đang mở (null = đóng)
  const [open, setOpen] = useState({})          // nội dung dài (vd bản ghi Live) đang mở hết: {id: true}
  const pending = useRef(false)
  const leadId = lead ? lead.id : ''
  /* Ghi âm -> chữ (nút micro): câu nói xong được nối vào ô Nội dung trao đổi của form (đang mở) hoặc ô ghi nhận nhanh */
  const joinTxt = (a, b) => (a && a.trim() ? a.replace(/\s+$/, '') + ' ' + b : b)
  const dict = useDictation(text => setForm(f => (f ? { ...f, content: joinTxt(f.content, text) } : f)))

  useEffect(() => { setTab('all'); setSub(''); setExpand(false); setQ(''); setForm(null); dict.stop() }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  // đóng form thì tắt micro
  useEffect(() => { if (!form) dict.stop() }, [form]) // eslint-disable-line react-hooks/exhaustive-deps
  // lịch sử chăm sóc đổi sau khi ghi -> báo các khối khác (chấm điểm, AI) tải lại
  const sig = all.length + ':' + (all[0] ? all[0].id : '')
  useEffect(() => { if (pending.current) { pending.current = false; emitLeadChange(leadId, 'activities') } }, [sig, leadId])
  // Esc khi đang mở form: đóng form, không quay lại danh sách khách hàng
  useEffect(() => {
    if (!form) return undefined
    const k = e => {
      if (e.key !== 'Escape' || document.querySelector('[role=dialog]')) return
      e.preventDefault(); e.stopPropagation(); setForm(null)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [form])
  if (!lead) return null

  const base = all.filter(x => showSys || !isSystemEntry(x))
  const real = all.filter(x => !isSystemEntry(x))
  const cnt = t => base.filter(x => inTab(x, t, '')).length
  const shown = base.filter(x => inTab(x, tab, sub))
  const list = expand ? shown : shown.slice(0, 2)
  const lastDate = real.reduce((m, x) => (x.date && String(x.date) > m ? String(x.date).slice(0, 10) : m), '')
  const today = todayIso()
  const gap = lastDate ? Math.max(0, daysBetween(lastDate, today)) : null
  const subCounts = OTHER.map(k => [k, base.filter(x => x.type === k).length]).filter(x => x[1])

  const pickTab = t => { setTab(t); setSub(''); if (t === 'call' || t === 'note') setQType(t) }
  const submit = x => {
    pending.current = true
    onAddInteraction({ ...x, id: 'i' + Date.now(), by: me || '' })
  }
  const quick = () => {
    const t = q.trim()
    if (!t) return
    const first = t.split('\n')[0].trim()
    const title = first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first
    submit({ type: qType, date: today, title, content: t === title ? '' : t, outcome: '', next: '', nextNote: '' })
    setQ('')
  }
  const openForm = () => setForm({ type: qType, date: today, title: '', content: q.trim(), outcome: 'good', next: '', nextNote: '' })
  const saveForm = () => {
    if (!form || (!form.title.trim() && !form.content.trim())) return
    submit({ ...form, title: form.title.trim() || INTERACTION_TYPES[form.type].label, content: form.content.trim() })
    setForm(null); setQ('')
  }

  return (
    <section className="cd-cc cd-care" aria-label="Cập nhật chăm sóc">
      <div className="cd-cc-h">
        <h3 className="cd-cc-t">Cập nhật chăm sóc</h3>
        <div className="cd-cseg" role="tablist" aria-label="Lọc theo loại tương tác">
          {TABS.filter(([k]) => k !== 'other' || cnt('other') || tab === 'other').map(([k, lab]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>{lab} ({cnt(k)})</button>
          ))}
        </div>
        <label className="cd-care-sys"><input type="checkbox" checked={showSys} onChange={e => setShowSys(e.target.checked)} />Log hệ thống</label>
      </div>
      {tab === 'other' && subCounts.length > 0 && (
        <div className="cd-care-sub">
          <button type="button" className={!sub ? 'on' : ''} onClick={() => setSub('')}>Tất cả loại khác</button>
          {subCounts.map(([k, n]) => (
            <button key={k} type="button" className={sub === k ? 'on' : ''} style={{ '--c': INTERACTION_TYPES[k].color }} onClick={() => setSub(k)}>
              <Ic d={INTERACTION_TYPES[k].icon} size={12} />{INTERACTION_TYPES[k].label} ({n})
            </button>
          ))}
        </div>
      )}

      <div className="cd-care-stats">
        <div><b>{real.length}</b><span>tương tác</span></div>
        {gap === null ? (
          <div className="warn"><b>Chưa có</b><span>chưa liên hệ lần nào</span></div>
        ) : gap > 0 ? (
          <div className="warn" title={'Liên hệ gần nhất: ' + fmtD(lastDate)}><b>{gap} ngày</b><span>chưa liên hệ · từ {fmtDM(lastDate)}</span></div>
        ) : (
          <div title={'Liên hệ gần nhất: ' + fmtD(lastDate)}><b>Hôm nay</b><span>liên hệ gần nhất</span></div>
        )}
      </div>

      {!form && (
        <div className="cd-care-quick">
          <span className="cd-care-qt" role="group" aria-label="Loại ghi nhận nhanh">
            {['call', 'note'].map(k => (
              <button key={k} type="button" className={qType === k ? 'on' : ''} title={INTERACTION_TYPES[k].label} aria-pressed={qType === k} onClick={() => setQType(k)}>
                <Ic d={INTERACTION_TYPES[k].icon} size={14} />
              </button>
            ))}
          </span>
          <input value={q} placeholder="Báo cáo" aria-label="Báo cáo tương tác mới" title="Báo cáo tương tác mới"
            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); quick() } }} />
          <button type="button" className="cd-care-mic" disabled={!dict.supported}
            title={dict.supported ? 'Ghi âm: bấm rồi nói, lời nói chuyển thành chữ trong ô Nội dung trao đổi' : 'Trình duyệt này chưa hỗ trợ ghi âm thành chữ (dùng Chrome / Edge)'}
            aria-label="Ghi âm thành chữ" onClick={() => { openForm(); dict.start() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></svg>
          </button>
          <button type="button" className="cd-care-more" onClick={openForm} title="Mở form đầy đủ: loại, ngày, kết quả, hẹn chăm sóc tiếp">Chi tiết</button>
          <button type="button" className="cd-cbtn-or" disabled={!q.trim()} onClick={quick}>+ Ghi nhận</button>
        </div>
      )}

      {form && (
        <div className="cd-care-form" data-cd-busy="1">
          <b className="cd-care-form-t">Ghi nhận tương tác mới</b>
          <div className="cd-care-types">
            {Object.entries(INTERACTION_TYPES).map(([k, t]) => (
              <button key={k} type="button" className={form.type === k ? 'on' : ''} style={{ '--c': t.color }} onClick={() => setForm({ ...form, type: k })}><Ic d={t.icon} size={13} />{t.label}</button>
            ))}
          </div>
          <div className="cd-care-grid">
            <label><span>Ngày</span><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label><span>Tiêu đề</span><input autoFocus value={form.title} placeholder={INTERACTION_TYPES[form.type].label} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <div className="full cd-care-dict">
              <span className="cd-care-dict-h">
                <label htmlFor={'cd-care-content-' + leadId}>Nội dung trao đổi</label>
                <button type="button" className={'cd-care-mic' + (dict.listening ? ' on' : '')} disabled={!dict.supported} aria-pressed={dict.listening}
                  title={!dict.supported ? 'Trình duyệt này chưa hỗ trợ ghi âm thành chữ (dùng Chrome / Edge)' : dict.listening ? 'Đang nghe - bấm để dừng' : 'Ghi âm: bấm rồi nói, lời nói chuyển thành chữ'}
                  onClick={dict.toggle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></svg>
                  {dict.listening ? 'Đang nghe… bấm để dừng' : 'Ghi âm'}
                </button>
              </span>
              <textarea id={'cd-care-content-' + leadId} rows={3} value={form.content} placeholder="Khách hỏi gì, đã tư vấn gì, phản hồi của khách… (hoặc bấm Ghi âm rồi nói)" onChange={e => setForm({ ...form, content: e.target.value })} />
              {dict.listening && dict.interim ? <em className="cd-care-interim">{dict.interim}</em> : null}
              {dict.error ? <em className="cd-care-dict-err" role="alert">{dict.error}</em> : null}
            </div>
            <div className="full"><span>Kết quả</span>
              <div className="cd-care-outs">{Object.entries(OUTCOMES).map(([k, [lab, c]]) => (
                <button key={k} type="button" className={form.outcome === k ? 'on' : ''} style={{ '--c': c }} onClick={() => setForm({ ...form, outcome: form.outcome === k ? '' : k })}>{lab}</button>
              ))}</div>
            </div>
            <label><span>Hẹn chăm sóc tiếp</span><input type="date" value={form.next} onChange={e => setForm({ ...form, next: e.target.value })} /></label>
            <label><span>Việc cần làm</span><input value={form.nextNote} placeholder="VD: Gửi phương án vật liệu 2" onChange={e => setForm({ ...form, nextNote: e.target.value })} /></label>
          </div>
          <div className="cd-care-foot">
            <button type="button" className="cd-cbtn" onClick={() => setForm(null)}>Hủy</button>
            <button type="button" className="cd-cbtn-or" disabled={!form.title.trim() && !form.content.trim()} onClick={saveForm}>Lưu tương tác</button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="cd-care-empty">
          <b>Chưa có tương tác nào{tab !== 'all' ? ' thuộc loại này' : ''}</b>
          <span>Ghi lại cuộc gọi, tin nhắn, buổi gặp… để cả nhóm theo dõi quá trình chăm sóc khách hàng.</span>
          {!form && <button type="button" className="cd-cbtn-or" onClick={openForm}><Ic d={IC_PLUS} size={13} />Ghi nhận tương tác đầu tiên</button>}
        </div>
      ) : (
        <ol className="cd-tl">
          {list.map(x => {
            const sys = isSystemEntry(x)
            const t = INTERACTION_TYPES[x.type] || INTERACTION_TYPES.note
            const o = OUTCOMES[x.outcome]
            return (
              <li key={x.id} className={'cd-tl-i' + (sys ? ' sys' : '')} style={{ '--c': sys ? '#98A2B3' : t.color }}>
                <div className="cd-tl-rail"><span className="cd-tl-ic" title={sys ? 'Log hệ thống' : t.label}><Ic d={sys ? SYS_IC : t.icon} size={14} /></span><i /></div>
                <div className="cd-tl-b">
                  <div className="cd-tl-top">
                    <b>{x.title}</b>
                    {!sys && <span className="cd-tl-type">{t.label}</span>}
                  </div>
                  <div className="cd-tl-meta">
                    {o && <em className="cd-tl-out" style={{ '--o': o[1] }}>{o[0]}</em>}
                    <span className="cd-tl-date">{fmtD(x.date)}</span>
                  </div>
                  {x.content && <p className={isLong(x.content) && !open[x.id] ? 'clip' : undefined}>{x.content}</p>}
                  {x.content && isLong(x.content) && (
                    <button type="button" className="cd-tl-more" onClick={() => setOpen(m => ({ ...m, [x.id]: !m[x.id] }))}>{open[x.id] ? 'Thu gọn' : 'Xem hết'}</button>
                  )}
                  <div className="cd-tl-by">
                    {x.by}
                    {x.next && <span className="cd-tl-next">{x.by ? ' · ' : ''}Hẹn tiếp {fmtDM(x.next)}{x.nextNote ? ': ' + x.nextNote : ''}</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {shown.length > 2 && (
        <button type="button" className="cd-cbtn cd-care-tog" aria-expanded={expand} onClick={() => setExpand(v => !v)}>
          {expand ? 'Thu gọn' : 'Mở rộng (+' + (shown.length - 2) + ')'}
        </button>
      )}
    </section>
  )
}
