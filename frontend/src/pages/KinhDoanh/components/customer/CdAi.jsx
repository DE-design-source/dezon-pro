import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getInsights, generateInsights, updateInsight, addTask, emitLeadChange, useLeadChange } from '../../customerApi'
import DatePicker from '../../../../components/ui/DatePicker'
import { uploadRaw, saveBlob } from '../../../QS/api/files'
import { useKdMap, saveKdOptions } from '../ShortlistSelect'
import { phoneNorms } from '../../utils'
import './ai.css'
import './scoreai2.css'
import { LiveCoachCards } from './CdLiveCoach'

/* Khối AI của trang khách hàng (Customer Dashboard): 1 Timeline đề xuất · 2 Phân tích chiến lược · 3 Đề xuất hành động
   · Nguồn dữ liệu AI đã phân tích. Dữ liệu: customerApi getInsights / generateInsights (lưu database, máy chủ gọi Gemini
   hoặc tự tính theo quy tắc). "Tạo task" -> addTask(source 'ai') rồi báo khối Danh sách Task tải lại. */

const pad = n => String(n).padStart(2, '0')
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '') }
const dm = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] : String(iso || '') }
function atLabel(ts) {
  const d = ts ? new Date(ts) : null
  if (!d || isNaN(d)) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1)
}

/* Ngày có thật (loại 31/02, 2026-13-40...): trả Date hoặc null */
function realDate(y, mo, d) {
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null
}
/* Hạn task từ nhãn của AI (chỉ tag / when / priority, không đọc tiêu đề, mô tả):
   'Trước 24/11', '24/11/2026', '2026-11-24', 'Hôm nay', 'Ngày mai'; không đọc được hoặc ngày không có thật -> '' */
function parseDue(...texts) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  for (const raw of texts) {
    const t = String(raw || '').trim()
    if (!t) continue
    let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t)
    if (m) { const dt = realDate(Number(m[1]), Number(m[2]), Number(m[3])); if (dt) return isoOf(dt); continue }
    m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.exec(t)
    if (m) {
      const d = Number(m[1]), mo = Number(m[2])
      const y = m[3] ? Number(m[3]) : now.getFullYear()
      let dt = realDate(y, mo, d)
      if (dt && !m[3] && now - dt > 180 * 864e5) dt = realDate(y + 1, mo, d)
      if (dt) return isoOf(dt)
      continue
    }
    if (/hôm nay/i.test(t)) return isoOf(now)
    if (/ngày mai/i.test(t)) { const d = new Date(now); d.setDate(d.getDate() + 1); return isoOf(d) }
  }
  return ''
}

const why_ = s => { s = String(s || '').trim(); return !s || /^vì sao/i.test(s) ? s : 'Vì sao: ' + s }

/* Màu nhãn ưu tiên của thẻ phụ (theo bản thiết kế) */
function tagTone(tag) {
  const t = String(tag || '')
  if (/cao|gấp|khẩn|hôm nay|ngay/i.test(t)) return 'red'
  if (/trước|sớm|hạn/i.test(t)) return 'orange'
  if (/upsell|bán thêm|cơ hội/i.test(t)) return 'green'
  return 'navy'
}
const scoreTone = s => (s >= 70 ? 'good' : s >= 40 ? 'warn' : 'bad')

/* Nhận định: tô đỏ các cụm rủi ro (risks[] là chuỗi con của headline) */
function Highlight({ text, risks }) {
  const rs = (risks || []).map(r => String(r || '').trim()).filter(Boolean)
  if (!rs.length) return text
  const esc = rs.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length)
  const re = new RegExp('(' + esc.join('|') + ')', 'g')
  return String(text || '').split(re).map((p, i) => (rs.indexOf(p) >= 0 ? <span key={i} className="cd-ai-risk">{p}</span> : p))
}

const KIND = {
  call: 'Cuộc gọi', meeting: 'Gặp mặt', site: 'Khảo sát công trình', zalo: 'Zalo / tin nhắn', email: 'Email', quote: 'Gửi báo giá',
  note: 'Ghi chú', form: 'Form', lead: 'Hồ sơ khách', file: 'Tệp', appointment: 'Lịch hẹn', task: 'Task', score: 'Chỉ số',
}
function sourceLine(s, i) {
  const kind = KIND[s.kind] || s.kind || 'Dữ liệu'
  const date = s.date ? ' ' + (/^\d{4}-\d{2}-\d{2}/.test(s.date) ? dm(s.date) : s.date) : ''
  return (i + 1) + '. ' + kind + date + (s.summary ? ' – ' + s.summary : '') + (s.by ? ' (' + s.by + ')' : '')
}

function stepDate(d) {
  const s = String(d || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s === isoOf(new Date()) ? dm(s) + ' · Hôm nay' : dm(s)
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch (e) { /* thử cách cũ */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch (e) { return false }
}

const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const STATE_LABEL = { done: 'Đã xong', now: 'Đang làm', open: 'Sắp tới', key: 'Mốc quan trọng', end: 'Mốc cuối' }

function roadmapText(lead, rm, head) {
  return [head, ...(rm.steps || []).map((s, i) => (i + 1) + '. ' + stepDate(s.date) + ' - ' + (s.label || '') + (s.desc ? ': ' + s.desc : ''))].join('\n')
}

/* Xuất file timeline gửi khách: trang HTML in được (mở bằng trình duyệt, Ctrl+P ra PDF) */
function exportTimeline(lead, rm, head) {
  const rows = (rm.steps || []).map((s, i) => '<tr class="' + escHtml(s.state || 'open') + '"><td>' + (i + 1) + '</td><td>' + escHtml(stepDate(s.date)) +
    '</td><td><b>' + escHtml(s.label) + '</b>' + (s.desc ? '<div class="d">' + escHtml(s.desc) + '</div>' : '') + '</td><td>' + escHtml(STATE_LABEL[s.state] || '') + '</td></tr>').join('')
  const html = '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escHtml('Lộ trình - ' + (lead.name || '')) + '</title><style>body{font-family:Arial,sans-serif;color:#1D2939;margin:32px;max-width:860px}' +
    'h1{font-size:20px;margin:0 0 4px}p{color:#667085;margin:0 0 20px}table{width:100%;border-collapse:collapse;font-size:14px}' +
    'th,td{border-bottom:1px solid #E4E7EC;padding:10px 8px;text-align:left;vertical-align:top}th{background:#F7F8FA;font-size:12px;text-transform:uppercase;color:#667085}' +
    '.d{color:#667085;font-size:13px;margin-top:2px}tr.key td,tr.end td{background:#F2F5FA}tr.now td:nth-child(2){color:#D9661F;font-weight:600}' +
    '@media print{body{margin:12mm}}</style></head><body><h1>' + escHtml(head) + '</h1><p>Khách hàng: ' + escHtml(lead.name || '') +
    ' · Lập ngày ' + escHtml(dmy(isoOf(new Date()))) + '</p><table><thead><tr><th>#</th><th>Thời gian</th><th>Nội dung</th><th>Trạng thái</th></tr></thead><tbody>' +
    rows + '</tbody></table></body></html>'
  const slug = String(lead.name || 'khach-hang').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'khach-hang'
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'lo-trinh-' + slug + '.html')
}

const IcTask = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M12 10v7M8.5 13.5h7" /></svg>
)
const IcUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
)
const IcPen = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
)
const IcCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
)
const IcRefresh = ({ spin }) => (
  <svg className={spin ? 'cd-ai-spin' : ''} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
)

const UP_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.dwg,.dxf,.skp'

/* ---- Sửa tay từng phần AI đề xuất (Timeline / Phân tích chiến lược / Gợi ý / Đề xuất hành động) ----
   Lưu: updateInsight gửi đủ 4 phần (bản hiện tại thay phần vừa sửa) + generatedAt lúc bắt đầu sửa. */
const MAX = { steps: 12, risks: 5, ideas: 4, side: 3 }
const STATE_OPTS = [['done', 'Đã xong'], ['now', 'Đang làm'], ['open', 'Chưa làm'], ['key', 'Mốc ký HĐ'], ['end', 'Mốc cuối']]
const isState = s => STATE_OPTS.some(o => o[0] === s)
const tx = s => String(s == null ? '' : s)
const tt = s => tx(s).trim()
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
let seq = 0
const kid = () => 'r' + (++seq)
const strip = ({ _k, ...rest }) => rest   // eslint-disable-line no-unused-vars
/* Số 0-100: '' -> {v: null}; sai -> {err} */
function num100(s, name) {
  const t = tt(s)
  if (!t) return { v: null }
  const n = Number(t.replace(',', '.'))
  if (!isFinite(n) || n < 0 || n > 100) return { err: name + ' phải là số từ 0 đến 100' }
  return { v: Math.round(n) }
}

function useRows(init) {
  const [rows, setRows] = useState(() => (Array.isArray(init) ? init : []).filter(r => r && typeof r === 'object').map(r => ({ ...r, _k: kid() })))
  return {
    rows,
    set: (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))),
    move: (i, d) => setRows(rs => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const n = rs.slice(); [n[i], n[j]] = [n[j], n[i]]; return n }),
    del: i => setRows(rs => rs.filter((_, j) => j !== i)),
    add: r => setRows(rs => rs.concat([{ ...r, _k: kid() }])),
  }
}

/* textarea tự giãn theo nội dung */
function AutoTa({ value, onChange, className, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = (el.scrollHeight + 2) + 'px'
  }, [value])
  return <textarea ref={ref} rows={1} className={'cd-ai-in ta' + (className ? ' ' + className : '')} value={value} onChange={e => onChange(e.target.value)} {...rest} />
}

function RowTools({ i, n, onMove, onDel, what }) {
  return (
    <span className="cd-ai-rowtools">
      <button type="button" className="cd-ai-ix" title="Chuyển lên" aria-label={'Chuyển ' + what + ' ' + (i + 1) + ' lên'} disabled={i === 0} onClick={() => onMove(i, -1)}>↑</button>
      <button type="button" className="cd-ai-ix" title="Chuyển xuống" aria-label={'Chuyển ' + what + ' ' + (i + 1) + ' xuống'} disabled={i === n - 1} onClick={() => onMove(i, 1)}>↓</button>
      <button type="button" className="cd-ai-ix del" title={'Xoá ' + what} aria-label={'Xoá ' + what + ' ' + (i + 1)} onClick={() => onDel(i)}>×</button>
    </span>
  )
}

const AddRow = ({ n, max, label, onClick }) => (
  <button type="button" className="cd-ai-addrow" disabled={n >= max} onClick={onClick}>
    + {label} <span className="cd-ai-mut">({n}/{max})</span>
  </button>
)

/* Khung form sửa: Lưu / Huỷ, lỗi chữ đỏ tại chỗ, Esc huỷ, Ctrl+Enter lưu. data-cd-busy để Esc không thoát trang. */
function EditForm({ build, onSave, onCancel, onReload, children }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function submit() {
    if (busy) return
    const r = build()
    if (r.error) { setErr({ text: r.error }); return }
    setBusy(true); setErr(null)
    try { await onSave(r.value) } catch (e) {
      setErr({ text: (e && e.message) || String(e), reload: !!(e && e.status === 409) })
      setBusy(false)
    }
  }
  return (
    <div className="cd-ai-edit" data-cd-busy="1"
      onKeyDown={e => {
        if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel() }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
      }}>
      <fieldset className="cd-ai-edit-fs" disabled={busy}>{children}</fieldset>
      {err && (
        <div className="cd-ai-edit-err" role="alert">
          <span>{err.text}</span>
          {err.reload && <button type="button" className="cd-ai-link" onClick={onReload}>Tải lại</button>}
        </div>
      )}
      <div className="cd-ai-edit-foot">
        <span className="cd-ai-edit-hint">Ctrl+Enter lưu · Esc huỷ</span>
        <button type="button" className="cd-ai-btn sm" disabled={busy} onClick={onCancel}>Huỷ</button>
        <button type="button" className="cd-ai-btn sm primary" disabled={busy} onClick={submit}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
      </div>
    </div>
  )
}

function RoadmapForm({ rm, ...p }) {
  const L = useRows(rm.steps)
  const build = () => {
    const steps = []
    for (let i = 0; i < L.rows.length; i++) {
      const r = L.rows[i]
      const s = { ...strip(r), date: tt(r.date), label: tt(r.label), desc: tt(r.desc), state: isState(r.state) ? r.state : 'open' }
      if (!s.label && !s.desc && !s.date) continue
      if (!s.label) return { error: 'Mốc thứ ' + (i + 1) + ' chưa có nội dung (nhãn)' }
      steps.push(s)
    }
    if (steps.length > MAX.steps) return { error: 'Tối đa ' + MAX.steps + ' mốc' }
    return { value: { ...rm, steps } }
  }
  return (
    <EditForm build={build} {...p}>
      {L.rows.length === 0 && <span className="cd-ai-none">Chưa có mốc nào. Bấm "+ Thêm mốc".</span>}
      {L.rows.map((r, i) => {
        const iso = ISO_RE.test(tx(r.date))
        return (
          <div key={r._k} className="cd-ai-erow">
            <div className="cd-ai-erow-h">
              <span className="cd-ai-erow-n">{i + 1}</span>
              <DatePicker value={iso ? r.date : ''} onChange={v => L.set(i, { date: v || '' })} clearable ariaLabel={'Ngày mốc ' + (i + 1)} />
              {!iso && tt(r.date) && <span className="cd-ai-raw" title="Thời gian AI ghi (chọn ngày để thay)">{r.date}</span>}
              <select className="cd-ai-in sel" value={isState(r.state) ? r.state : 'open'} aria-label={'Trạng thái mốc ' + (i + 1)}
                onChange={e => L.set(i, { state: e.target.value })}>
                {STATE_OPTS.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
              </select>
              <RowTools i={i} n={L.rows.length} onMove={L.move} onDel={L.del} what="mốc" />
            </div>
            <input className="cd-ai-in" autoFocus={i === 0} value={tx(r.label)} placeholder="Nhãn mốc (VD: Gửi báo giá khái toán)" aria-label={'Nhãn mốc ' + (i + 1)}
              onChange={e => L.set(i, { label: e.target.value })} />
            <AutoTa value={tx(r.desc)} onChange={v => L.set(i, { desc: v })} placeholder="Mô tả (không bắt buộc)" aria-label={'Mô tả mốc ' + (i + 1)} />
          </div>
        )
      })}
      <AddRow n={L.rows.length} max={MAX.steps} label="Thêm mốc" onClick={() => L.add({ date: '', label: '', desc: '', state: 'open' })} />
    </EditForm>
  )
}

function StrategyForm({ st, ...p }) {
  const fit = st.fit || {}
  const pace = st.pace || {}
  const cc = st.closeChance || {}
  const [f, setF] = useState(() => ({
    headline: tx(st.headline), risks: (st.risks || []).map(tx).join('\n'), note: tx(st.note),
    fitLabel: tx(fit.label), fitScore: fit.score == null ? '' : tx(fit.score), paceScore: pace.score == null ? '' : tx(pace.score),
    ccPct: cc.pct == null ? '' : tx(cc.pct), ccHint: tx(cc.hint),
  }))
  const up = k => v => setF(x => ({ ...x, [k]: v }))
  const build = () => {
    const risks = f.risks.split('\n').map(s => s.trim()).filter(Boolean)
    if (risks.length > MAX.risks) return { error: 'Tối đa ' + MAX.risks + ' rủi ro (mỗi dòng 1 rủi ro)' }
    const fs = num100(f.fitScore, 'Điểm độ khớp'); if (fs.err) return { error: fs.err }
    const ps = num100(f.paceScore, 'Điểm nhịp deal'); if (ps.err) return { error: ps.err }
    const cp = num100(f.ccPct, 'Khả năng chốt'); if (cp.err) return { error: cp.err }
    const hint = tt(f.ccHint)
    if (hint && cp.v == null) return { error: 'Nhập khả năng chốt (0-100) hoặc xoá gợi ý khả năng chốt' }
    return {
      value: {
        ...st, headline: tt(f.headline), risks, note: tt(f.note),
        fit: { ...fit, score: fs.v == null ? 0 : fs.v, label: tt(f.fitLabel) },
        pace: { ...pace, score: ps.v == null ? 0 : ps.v },
        closeChance: cp.v == null ? null : { ...cc, pct: cp.v, hint },
      },
    }
  }
  return (
    <EditForm build={build} {...p}>
      <label className="cd-ai-ef"><span className="cd-ai-cap">Nhận định</span>
        <AutoTa autoFocus value={f.headline} onChange={up('headline')} placeholder="Nhận định chính về khách hàng / deal" />
      </label>
      <label className="cd-ai-ef"><span className="cd-ai-cap">Rủi ro <span className="cd-ai-mut cd-ai-lc">(mỗi dòng 1 rủi ro, tối đa {MAX.risks}; cụm trùng trong nhận định được tô đỏ)</span></span>
        <AutoTa value={f.risks} onChange={up('risks')} placeholder={'VD: chưa rõ người quyết định\nngân sách thấp hơn dự toán'} />
      </label>
      <label className="cd-ai-ef"><span className="cd-ai-cap">Ghi chú</span>
        <AutoTa value={f.note} onChange={up('note')} placeholder="Ghi chú thêm (không bắt buộc)" />
      </label>
      <div className="cd-ai-egrid">
        <label className="cd-ai-ef"><span className="cd-ai-cap">Độ khớp (0-100)</span>
          <input className="cd-ai-in num" type="number" min="0" max="100" value={f.fitScore} onChange={e => up('fitScore')(e.target.value)} />
        </label>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Nhãn độ khớp</span>
          <input className="cd-ai-in" value={f.fitLabel} placeholder="VD: Khớp tốt" onChange={e => up('fitLabel')(e.target.value)} />
        </label>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Nhịp deal (0-100)</span>
          <input className="cd-ai-in num" type="number" min="0" max="100" value={f.paceScore} onChange={e => up('paceScore')(e.target.value)} />
        </label>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Khả năng chốt % (0-100)</span>
          <input className="cd-ai-in num" type="number" min="0" max="100" value={f.ccPct} placeholder="Bỏ trống = ẩn" onChange={e => up('ccPct')(e.target.value)} />
        </label>
      </div>
      <label className="cd-ai-ef"><span className="cd-ai-cap">Gợi ý khả năng chốt</span>
        <input className="cd-ai-in" value={f.ccHint} placeholder="VD: nếu gửi báo giá trước 30/11" onChange={e => up('ccHint')(e.target.value)} />
      </label>
    </EditForm>
  )
}

function IdeasForm({ ideas, ...p }) {
  const L = useRows(ideas)
  const build = () => {
    const out = []
    for (let i = 0; i < L.rows.length; i++) {
      const r = L.rows[i]
      const w = { ...strip(r), title: tt(r.title), desc: tt(r.desc) }
      if (!w.title && !w.desc) continue
      if (!w.title) return { error: 'Gợi ý thứ ' + (i + 1) + ' chưa có tiêu đề' }
      if (!w.key) w.key = 'tay-' + Date.now().toString(36) + '-' + i
      out.push(w)
    }
    if (out.length > MAX.ideas) return { error: 'Tối đa ' + MAX.ideas + ' gợi ý' }
    return { value: out }
  }
  return (
    <EditForm build={build} {...p}>
      {L.rows.length === 0 && <span className="cd-ai-none">Chưa có gợi ý. Bấm "+ Thêm gợi ý".</span>}
      {L.rows.map((r, i) => (
        <div key={r._k} className="cd-ai-erow">
          <div className="cd-ai-erow-h">
            <span className="cd-ai-erow-n">{i + 1}</span>
            <input className="cd-ai-in grow" autoFocus={i === 0} value={tx(r.title)} placeholder="Tiêu đề gợi ý" aria-label={'Tiêu đề gợi ý ' + (i + 1)}
              onChange={e => L.set(i, { title: e.target.value })} />
            <RowTools i={i} n={L.rows.length} onMove={L.move} onDel={L.del} what="gợi ý" />
          </div>
          <AutoTa value={tx(r.desc)} onChange={v => L.set(i, { desc: v })} placeholder="Mô tả (không bắt buộc)" aria-label={'Mô tả gợi ý ' + (i + 1)} />
        </div>
      ))}
      <AddRow n={L.rows.length} max={MAX.ideas} label="Thêm gợi ý" onClick={() => L.add({ title: '', desc: '' })} />
    </EditForm>
  )
}

function ActionsForm({ act, ...p }) {
  const m0 = act.main || {}
  const [m, setM] = useState(() => ({ priority: tx(m0.priority), title: tx(m0.title), why: tx(m0.why), zalo: tx(m0.zalo) }))
  const L = useRows(act.side)
  const upM = k => v => setM(x => ({ ...x, [k]: v }))
  const build = () => {
    const title = tt(m.title)
    if (!title) return { error: 'Hành động chính không được để trống' }
    const side = []
    for (let i = 0; i < L.rows.length; i++) {
      const r = L.rows[i]
      const a = { ...strip(r), tag: tt(r.tag), when: tt(r.when), title: tt(r.title), why: tt(r.why) }
      if (!a.tag && !a.when && !a.title && !a.why) continue
      if (!a.title) return { error: 'Hành động phụ thứ ' + (i + 1) + ' chưa có tiêu đề' }
      side.push(a)
    }
    if (side.length > MAX.side) return { error: 'Tối đa ' + MAX.side + ' hành động phụ' }
    return { value: { ...act, main: { ...m0, priority: tt(m.priority), title, why: tt(m.why), zalo: tx(m.zalo).trim() }, side } }
  }
  return (
    <EditForm build={build} {...p}>
      <div className="cd-ai-erow main">
        <span className="cd-ai-cap">Hành động chính</span>
        <div className="cd-ai-egrid">
          <label className="cd-ai-ef"><span className="cd-ai-cap">Mức ưu tiên</span>
            <input className="cd-ai-in" value={m.priority} placeholder="VD: Ưu tiên cao · Hôm nay" onChange={e => upM('priority')(e.target.value)} />
          </label>
        </div>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Tiêu đề <span className="cd-ai-req">*</span></span>
          <AutoTa autoFocus value={m.title} onChange={upM('title')} placeholder="Việc cần làm ngay (bắt buộc)" />
        </label>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Vì sao</span>
          <AutoTa value={m.why} onChange={upM('why')} placeholder="Lý do nên làm việc này" />
        </label>
        <label className="cd-ai-ef"><span className="cd-ai-cap">Tin Zalo soạn sẵn</span>
          <AutoTa value={m.zalo} onChange={upM('zalo')} placeholder="Nội dung tin nhắn gửi khách (không bắt buộc)" />
        </label>
      </div>
      <span className="cd-ai-cap">Hành động phụ</span>
      {L.rows.map((r, i) => (
        <div key={r._k} className="cd-ai-erow">
          <div className="cd-ai-erow-h">
            <span className="cd-ai-erow-n">{i + 1}</span>
            <input className="cd-ai-in w-tag" value={tx(r.tag)} placeholder="Nhãn (VD: Trước 30/11)" aria-label={'Nhãn hành động phụ ' + (i + 1)}
              onChange={e => L.set(i, { tag: e.target.value })} />
            <input className="cd-ai-in w-tag" value={tx(r.when)} placeholder="Thời điểm" aria-label={'Thời điểm hành động phụ ' + (i + 1)}
              onChange={e => L.set(i, { when: e.target.value })} />
            <RowTools i={i} n={L.rows.length} onMove={L.move} onDel={L.del} what="hành động" />
          </div>
          <input className="cd-ai-in" value={tx(r.title)} placeholder="Tiêu đề hành động" aria-label={'Tiêu đề hành động phụ ' + (i + 1)}
            onChange={e => L.set(i, { title: e.target.value })} />
          <AutoTa value={tx(r.why)} onChange={v => L.set(i, { why: v })} placeholder="Vì sao (không bắt buộc)" aria-label={'Vì sao hành động phụ ' + (i + 1)} />
        </div>
      ))}
      <AddRow n={L.rows.length} max={MAX.side} label="Thêm hành động phụ" onClick={() => L.add({ tag: '', when: '', title: '', why: '' })} />
    </EditForm>
  )
}

export default function CdAi({ lead, interactions, live, onLive }) {
  const id = lead && lead.id
  const timeline = useKdMap('timeline')[String(id)] || {}
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(timeline.start || '')) ? timeline.start : ''
  /* Hình / tệp đính kèm của khách (kdOptions.attach, cùng dạng AttachBox): gửi kèm mỗi lần phân tích (AI chỉ đọc tên + đường dẫn) */
  const attachMap = useKdMap('attach')
  const attachRef = useRef(attachMap)
  attachRef.current = attachMap
  const [ins, setIns] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [running, setRunning] = useState(false)
  const [uploading, setUploading] = useState(0)
  const [stale, setStale] = useState(false)
  const [made, setMade] = useState({})     // khoá thẻ đã tạo task: true | 'busy'
  const [toast, setToast] = useState(null)
  const [editing, setEditing] = useState(null)   // null | 'roadmap' | 'strategy' | 'ideas' | 'actions'
  const editBase = useRef(null)                  // generatedAt của bản đang sửa (máy chủ báo 409 nếu đã có bản mới hơn)
  const fileRef = useRef(null)
  const selfEmit = useRef(false)
  const toastTimer = useRef(null)
  const baseCount = useRef(null)

  function say(text, bad) {
    setToast({ text, bad: !!bad })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  function load() {
    if (id == null) return
    setLoading(true); setLoadErr('')
    getInsights(id).then(r => { setIns((r && r.insight) || null); setStale(false); baseCount.current = null },
      e => setLoadErr((e && e.message) || 'Không tải được phân tích AI'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { setIns(null); setMade({}); setEditing(null); load() }, [id])  // eslint-disable-line react-hooks/exhaustive-deps

  useLeadChange(id, ['score', 'activities', 'insights'], part => {
    if (part === 'insights') { if (selfEmit.current) selfEmit.current = false; else load(); return }
    if (ins) setStale(true)
  })
  /* Tương tác mới thêm từ khối khác (prop interactions đổi số lượng) -> dữ liệu đã đổi */
  const nInter = (interactions || []).length
  useEffect(() => {
    if (!ins) { baseCount.current = nInter; return }
    if (baseCount.current == null) baseCount.current = nInter
    else if (nInter !== baseCount.current) setStale(true)
  }, [nInter, ins])

  /* Danh sách {name, url} gửi máy chủ: hình + tệp đính kèm, bỏ trùng đường dẫn, mới nhất trước (máy chủ nhận tối đa 10) */
  function attachedExtra(map) {
    const a = (map || {})[String(id)] || {}
    const seen = new Set(); const out = []
    for (const x of [...(a.file || []), ...(a.img || [])].reverse()) {
      const name = String((x && x.name) || '').trim(); const url = String((x && x.url) || '')
      if (!name || seen.has(url || name)) continue
      seen.add(url || name); out.push({ name, url })
    }
    return out
  }

  async function run(map) {
    if (running || editing || id == null) return
    setRunning(true)
    try {
      const body = {}
      const extra = attachedExtra(map || attachRef.current)
      if (extra.length) body.extra = extra
      if (start) body.start = start
      const r = await generateInsights(id, body)
      setIns((r && r.insight) || null); setStale(false); setMade({}); setLoadErr(''); baseCount.current = nInter
      selfEmit.current = true
      emitLeadChange(id, 'insights')
      say('Đã phân tích xong')
    } catch (e) {
      say('Không phân tích được: ' + ((e && e.message) || e), true)
    } finally { setRunning(false) }
  }

  async function onFiles(list) {
    const fs = Array.from(list || [])
    if (!fs.length) return
    setUploading(fs.length)
    const got = []; const bad = []
    for (const f of fs) {
      try { const r = await uploadRaw(f); if (r && r.url) got.push({ name: f.name, url: r.url }); else bad.push(f.name) } catch (e) { bad.push(f.name + ' (' + ((e && e.message) || e) + ')') }
      setUploading(n => n - 1)
    }
    if (fileRef.current) fileRef.current.value = ''
    if (bad.length) say('Không tải lên được: ' + bad.join(', '), true)
    if (!got.length) return
    /* Lưu vào Tệp đính kèm của khách (kdOptions.attach[mã].file) để lần phân tích sau và hồ sơ khách cùng thấy */
    const key = String(id)
    const cur = attachRef.current[key] || {}
    const next = { ...attachRef.current, [key]: { ...cur, img: cur.img || [], file: [...(cur.file || []), ...got] } }
    attachRef.current = next
    saveKdOptions('attach', next)
    await run(next)
  }

  function startEdit(part) {
    if (editing || running || uploading > 0 || !ins) return
    editBase.current = ins.generatedAt
    setEditing(part)
  }
  /* Lưu 1 phần: gửi đủ 4 phần (bản hiện tại thay phần vừa sửa). Lỗi ném ra để form hiện chữ đỏ tại chỗ. */
  async function saveSection(part, value) {
    const content = {
      actions: ins.actions || {}, strategy: ins.strategy || {}, ideas: ins.ideas || [], roadmap: ins.roadmap || { steps: [] },
      [part]: value,
    }
    const r = await updateInsight(id, content, editBase.current)
    const next = r && r.insight
    setIns(x => next || { ...x, [part]: value })
    setEditing(null)
    /* thẻ "Đã tạo task" theo vị trí: phần vừa sửa đổi thứ tự / nội dung -> bỏ đánh dấu của phần đó */
    const pre = part === 'actions' ? /^(main|side\d+)$/ : part === 'ideas' ? /^idea\d+$/ : null
    if (pre) setMade(mk => { const n = {}; Object.keys(mk).forEach(k => { if (!pre.test(k)) n[k] = mk[k] }); return n })
    selfEmit.current = true
    emitLeadChange(id, 'insights')
    say('Đã lưu chỉnh sửa')
  }
  const reloadAfterConflict = () => { setEditing(null); load() }
  const formProps = part => ({ onSave: v => saveSection(part, v), onCancel: () => setEditing(null), onReload: reloadAfterConflict })
  const editBtn = (part, label) => editing !== part && (
    <button type="button" className="cd-ai-btn sm cd-ai-editbtn" disabled={!!editing || running || uploading > 0}
      title={editing ? 'Đang sửa phần khác' : 'Sửa ' + label} aria-label={'Sửa ' + label} onClick={() => startEdit(part)}>
      <IcPen />Sửa
    </button>
  )

  async function makeTask(key, { title, when, note }) {
    if (!title || made[key]) return
    setMade(m => ({ ...m, [key]: 'busy' }))
    try {
      await addTask(id, { title, dueDate: parseDue(...when), note: note || '', source: 'ai' })
      setMade(m => ({ ...m, [key]: true }))
      emitLeadChange(id, 'tasks')
      say('Đã tạo task: ' + title)
    } catch (e) {
      setMade(m => { const n = { ...m }; delete n[key]; return n })
      say('Không tạo được task: ' + ((e && e.message) || e), true)
    }
  }
  const taskBtn = (k, task, small, icon) => (
    <button type="button" className={'cd-ai-btn' + (small ? ' sm' : '') + (made[k] === true ? ' done' : '')} disabled={!!made[k]}
      title={made[k] === true ? 'Đã tạo task' : 'Tạo task'} onClick={() => makeTask(k, task)}>
      {icon && <IcTask />}{made[k] === true ? 'Đã tạo task' : made[k] === 'busy' ? 'Đang tạo...' : 'Tạo task'}
    </button>
  )

  const busy = running || uploading > 0
  const meta = (
    <div className="cd-ai-meta">
      {onLive && (
        <button type="button" className={'cd-ai-live' + (live ? ' on' : '')} aria-pressed={!!live} onClick={onLive}
          title={live ? 'Đang ghi lại cuộc trò chuyện - bấm để tới khối Live' : 'Live: ghi lại cuộc trò chuyện với khách thành chữ'}>
          <i aria-hidden="true" />{live ? 'Đang Live' : 'Live'}
        </button>
      )}
      {ins && (
        <span className={'cd-ai-engine' + (ins.engine === 'gemini' ? ' gem' : '')} title={ins.warning || ''}>
          {ins.engine === 'gemini' ? 'Gemini' + (ins.model ? ' · ' + ins.model : '') : 'Tự tính theo quy tắc'}
          {ins.warning ? <span className="cd-ai-warn"> ⚠ {ins.warning}</span> : null}
        </span>
      )}
      {ins && ins.generatedAt && <span className="cd-ai-at">Phân tích lúc {atLabel(ins.generatedAt)}</span>}
      {ins && ins.editedAt && (
        <span className="cd-ai-edited" title="Nội dung AI đề xuất đã được người dùng chỉnh sửa">
          Đã chỉnh tay{ins.editedBy ? ' bởi ' + ins.editedBy : ''}{atLabel(ins.editedAt) ? ' · ' + atLabel(ins.editedAt) : ''}
        </span>
      )}
      {ins && !editing && (
        <button type="button" className="cd-ai-btn sm" disabled={busy} onClick={() => run()}>
          <IcRefresh spin={running} />{running ? 'Đang phân tích...' : 'Phân tích lại'}
        </button>
      )}
    </div>
  )
  const toastEl = toast && <div className={'cd-ai-toast' + (toast.bad ? ' bad' : '')} role="status">{toast.text}</div>
  const badge = (
    <span className="cd-ai-h">
      <span className="cd-ai-badge">AI</span><span className="cd-ai-title">1 · TIMELINE ĐỀ XUẤT</span>
    </span>
  )

  if (loading || loadErr || !ins) {
    return (
      <div className={'cd-card cd-ai is-empty'}>
        <div className="cd-ai-top">{badge}{meta}
          {!loading && !loadErr && !ins && (
            <button type="button" className="cd-ai-btn primary cd-ai-now" disabled={running} onClick={() => run()}>
              <IcRefresh spin={running} />{running ? 'Đang phân tích...' : 'Phân tích ngay'}
            </button>
          )}
        </div>
        {loading ? <div className="cd-ai-empty"><IcRefresh spin /> Đang tải phân tích AI...</div>
          : loadErr ? (
            <div className="cd-ai-empty">
              <span className="cd-ai-errtext">{loadErr}</span>
              <button type="button" className="cd-ai-btn" onClick={load}>Thử lại</button>
            </div>
          ) : (
            <div className="cd-ai-empty">
              <span className="cd-ai-empty-t">Chưa có phân tích AI cho khách hàng này</span>
              <span className="cd-ai-empty-d">AI đọc lịch sử chăm sóc, chỉ số và hồ sơ khách để đề xuất hành động, nhận định rủi ro và lộ trình chốt.</span>
            </div>
          )}
        {live && <LiveCoachCards leadId={id} />}
        {toastEl}
      </div>
    )
  }

  const act = ins.actions || {}
  const main = act.main || null
  const side = act.side || []
  const st = ins.strategy || {}
  const fit = st.fit || {}
  const pace = st.pace || {}
  const cc = st.closeChance || null
  const ideas = ins.ideas || []
  const rm = ins.roadmap || { steps: [] }
  const steps = rm.steps || []
  const rmHead = rm.anchor ? 'Lộ trình chốt, lùi từ khởi công ' + dmy(rm.anchor) : (rm.title || 'Lộ trình chăm sóc đề xuất')
  const sources = ins.sources || []
  const phone = phoneNorms(lead && lead.phone)[0] || String((lead && lead.phone) || '').replace(/\D/g, '')
  const fitS = Math.max(0, Math.min(100, Number(fit.score) || 0))
  const paceS = Math.max(0, Math.min(100, Number(pace.score) || 0))
  const delta = Number(pace.delta) || 0

  return (
    <div className="cd-card cd-ai">
      {stale && (
        <div className="cd-ai-stale">
          <span>Dữ liệu đã đổi - Phân tích lại?</span>
          <button type="button" className="cd-ai-link" disabled={busy || !!editing} title={editing ? 'Lưu hoặc huỷ phần đang sửa trước' : ''} onClick={() => run()}>Phân tích lại</button>
          <button type="button" className="cd-ai-x" title="Ẩn" onClick={() => setStale(false)}>×</button>
        </div>
      )}

      <section className="cd-ai-sec">
        <div className="cd-ai-top">{badge}{meta}</div>
        <div className="cd-ai-rm">
          <div className="cd-ai-rm-h">
            <span className="cd-ai-rm-t">{rmHead}</span>
            <span className="cd-ai-rm-act">
              {steps.length > 0 && editing !== 'roadmap' && <a href="#" className="cd-ai-export" onClick={e => { e.preventDefault(); exportTimeline(lead, rm, rmHead) }}>Xuất file timeline gửi khách</a>}
              {editBtn('roadmap', 'timeline đề xuất')}
            </span>
          </div>
          {editing === 'roadmap' ? <RoadmapForm rm={rm} {...formProps('roadmap')} /> : steps.length ? (
            <div className="cd-ai-steps">
              {steps.map((r, i) => {
                const s = r.state || 'open'
                return (
                  <div key={i} className={'cd-ai-step ' + s} title={r.desc || ''}>
                    {i < steps.length - 1 && <div className={'cd-ai-line ' + s + (r.dashed ? ' dashed' : '')} />}
                    <div className={'cd-ai-dot ' + s} />
                    <div className="cd-ai-step-b">
                      <span className="cd-ai-step-d">{stepDate(r.date)}</span>
                      <span className="cd-ai-step-l">{r.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <span className="cd-ai-none">Chưa có lộ trình. Nhập ngày khởi công ở hồ sơ khách rồi bấm Phân tích lại.</span>}
          {steps.length > 0 && editing !== 'roadmap' && (
            <button type="button" className="cd-ai-pen" title="Sao chép lộ trình dạng chữ (dán vào Zalo / ghi chú)" aria-label="Sao chép lộ trình"
              onClick={async () => say((await copyText(roadmapText(lead, rm, rmHead))) ? 'Đã sao chép lộ trình - dán vào Zalo / ghi chú để chỉnh sửa' : 'Không sao chép được', false)}>
              <IcCopy />
            </button>
          )}
        </div>
      </section>

      <section className="cd-ai-sec">
        <div className="cd-ai-top"><span className="cd-ai-title">2 · Phân tích chiến lược</span>{editBtn('strategy', 'phân tích chiến lược')}</div>
        {editing === 'strategy' ? <StrategyForm st={st} {...formProps('strategy')} /> : (
        <div className="cd-ai-strat">
          <div className="cd-ai-insight">
            <span className="cd-ai-cap">Nhận định</span>
            <span className="cd-ai-head"><Highlight text={st.headline || 'Chưa có nhận định.'} risks={st.risks} /></span>
            {st.note && <span className="cd-ai-note">{st.note}</span>}
          </div>
          <div className="cd-ai-bars">
            <div className="cd-ai-bar">
              <div className="cd-ai-bar-h">
                <span><b>Độ khớp</b> <span className="cd-ai-mut">(ngân sách, nhu cầu, quy mô)</span></span>
                <span className={'cd-ai-val ' + scoreTone(fitS)}>{fitS}{fit.label ? ' · ' + fit.label : ''}</span>
              </div>
              <div className="cd-ai-track"><div className={'cd-ai-fill ' + scoreTone(fitS)} style={{ width: fitS + '%' }} /></div>
            </div>
            <div className="cd-ai-bar">
              <div className="cd-ai-bar-h">
                <span><b>Nhịp deal</b> <span className="cd-ai-mut">(tương tác, giữ cam kết)</span></span>
                <span className={'cd-ai-val ' + scoreTone(paceS)}>{paceS}{delta ? ' · ' + (delta < 0 ? '▼' : '▲') + Math.abs(delta) : ''}</span>
              </div>
              <div className="cd-ai-track"><div className={'cd-ai-fill ' + scoreTone(paceS)} style={{ width: paceS + '%' }} /></div>
            </div>
            {cc && cc.pct != null && (
              <span className="cd-ai-chance">Khả năng chốt HĐ thiết kế: <b>~{Math.round(Number(cc.pct) || 0)}%</b>{cc.hint ? ', ' + cc.hint : ''}</span>
            )}
          </div>
        </div>
        )}
        <div className="cd-ai-ideas-w">
          <div className="cd-ai-ideas-h"><span className="cd-ai-cap">Gợi ý</span>{editBtn('ideas', 'gợi ý')}</div>
          {editing === 'ideas' ? <IdeasForm ideas={ideas} {...formProps('ideas')} /> : !ideas.length ? <span className="cd-ai-none">Chưa có gợi ý.</span> : (
            <div className="cd-ai-ideas">
              {ideas.map((w, i) => (
                <div key={w.key || i} className="cd-ai-idea">
                  <span className="cd-ai-idea-t">{w.title}</span>
                  {w.desc && <span className="cd-ai-idea-d">{w.desc}</span>}
                  <div className="cd-ai-grow" />
                  <span className="cd-ai-idea-b">{taskBtn('idea' + i, { title: w.title, when: [w.when, w.tag, w.priority], note: w.desc }, true, true)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {live && <LiveCoachCards leadId={id} />}
      </section>

      <section className="cd-ai-sec">
        <div className="cd-ai-top"><span className="cd-ai-title">3 · Đề xuất hành động</span>{editBtn('actions', 'đề xuất hành động')}</div>
        {editing === 'actions' ? <ActionsForm act={act} {...formProps('actions')} /> : (
        <div className="cd-ai-acts">
          {main && (
            <div className="cd-ai-main">
              {main.priority && <span className="cd-ai-prio">{main.priority}</span>}
              {main.why && <span className="cd-ai-why">{why_(main.why)}</span>}
              <span className="cd-ai-main-t">{main.title}</span>
              {main.zalo && (
                <div className="cd-ai-zalo">
                  <div className="cd-ai-zalo-h">
                    <span className="cd-ai-cap">Tin Zalo soạn sẵn</span>
                    <span className="cd-ai-zalo-act">
                      <button type="button" className="cd-ai-btn sm" onClick={async () => say((await copyText(main.zalo)) ? 'Đã sao chép tin Zalo' : 'Không sao chép được', false)}><IcCopy />Sao chép</button>
                      {phone && <a className="cd-ai-btn sm zalo" href={'https://zalo.me/' + phone} target="_blank" rel="noopener noreferrer" title={'Mở Zalo ' + lead.phone}>Mở Zalo</a>}
                    </span>
                  </div>
                  <span className="cd-ai-zalo-t">{main.zalo}</span>
                </div>
              )}
              <div className="cd-ai-row">
                {taskBtn('main', { title: main.title, when: [main.priority], note: main.why })}
              </div>
            </div>
          )}
          {side.length > 0 && (
            <div className="cd-ai-side">
              {side.map((a, i) => (
                <div key={i} className="cd-ai-sidecard">
                  <div className="cd-ai-sidehead">
                    {a.tag && <span className={'cd-ai-tag ' + tagTone(a.tag)}>{a.tag}</span>}
                    {a.when && <span className="cd-ai-when">{a.when}</span>}
                  </div>
                  <span className="cd-ai-side-t">{a.title}</span>
                  {a.why && <span className="cd-ai-side-why">{why_(a.why)}</span>}
                  {taskBtn('side' + i, { title: a.title, when: [a.tag, a.when], note: a.why }, true)}
                </div>
              ))}
            </div>
          )}
          {!main && !side.length && <span className="cd-ai-none">Chưa có đề xuất hành động.</span>}
        </div>
        )}
      </section>

      <section className="cd-ai-src">
        <div className="cd-ai-src-h">
          <span className="cd-ai-cap">Nguồn dữ liệu AI đã phân tích ({sources.length})</span>
          <button type="button" className="cd-ai-up" disabled={busy || !!editing} onClick={() => fileRef.current && fileRef.current.click()}
            title="Tải tệp (báo giá, bản vẽ, ghi chú...) lên kho tệp, lưu vào Tệp đính kèm của khách rồi phân tích lại">
            {uploading > 0 ? <IcRefresh spin /> : <IcUp />}{uploading > 0 ? 'Đang tải lên ' + uploading + ' tệp...' : 'Tải thêm dữ liệu nguồn'}
          </button>
          <input ref={fileRef} type="file" multiple accept={UP_ACCEPT} hidden onChange={e => onFiles(e.target.files)} />
        </div>
        <span className="cd-ai-src-note">AI chỉ đọc tên và đường dẫn tệp</span>
        {sources.length ? (
          <div className="cd-ai-src-l">
            {sources.map((s, i) => <span key={i}>{sourceLine(s, i)}</span>)}
          </div>
        ) : <span className="cd-ai-none">Chưa có nguồn dữ liệu.</span>}
      </section>
      {toastEl}
    </div>
  )
}
