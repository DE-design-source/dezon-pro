import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getInsights, updateInsight, chatInsight, getScore, emitLeadChange, useLeadChange } from '../../customerApi'
import { isSystemEntry, daysBetween, todayIso } from './CdCare'
import useDictation from './useDictation'
import './aichat.css'

/* Khối "Hỏi AI" (cột phụ trang khách hàng): hỏi về khách hoặc nhờ AI sửa 1 phần của bản Phân tích AI.
   Máy chủ: chatInsight -> {reply, proposal: null | {section, summary, content: đủ 4 phần, generatedAt, editedAt}, engine, model}; không lưu hội thoại.
   Áp dụng đề xuất: tải bản mới nhất (getInsights), generatedAt + editedAt phải trùng bản mà đề xuất dựa vào (máy chủ
   trả kèm proposal; sửa tay hoặc áp dụng đề xuất khác đổi editedAt -> báo đã đổi), chỉ thay phần proposal.section
   rồi updateInsight (409 / đã đổi -> báo hỏi lại), sau đó emitLeadChange 'insights' để khối CdAi tải lại.
   Hội thoại chỉ giữ trong sessionStorage 'kd-aichat-<leadId>' (tối đa 40 tin), gửi máy chủ tối đa 20 tin gần nhất. */

const MAX_KEEP = 40
const MAX_SEND = 20
const MAX_TEXT = 2000
const SECTION = { actions: 'Đề xuất hành động', strategy: 'Phân tích chiến lược', ideas: 'Gợi ý', roadmap: 'Timeline' }
/* Chip gợi ý theo ngữ cảnh hiện tại của khách (tối đa 4, ưu tiên từ trên xuống):
   tin AI vừa trả lời -> câu hỏi nối tiếp; chưa có phân tích; lâu chưa liên hệ; điểm liệt; giai đoạn; nội dung bản phân tích; mặc định */
const STAGE_CHIPS = {
  'tiep-can': ['Gợi ý câu hỏi khai thác nhu cầu cho lần gọi đầu'],
  'giao-ns': ['Nhân sự mới nhận khách nên bắt đầu từ đâu?'],
  'tu-van': ['Gợi ý concept phù hợp với khách này'],
  'bao-gia': ['Cách thuyết phục khách chấp nhận báo giá'],
  'dam-phan': ['Khách lăn tăn về giá, nên đàm phán thế nào?'],
  'chot-hd': ['Checklist cần chuẩn bị trước khi ký hợp đồng'],
  'bao-gia-thi-cong': ['Cách trình bày báo giá thi công cho khách'],
  'thiet-ke': ['Việc cần làm để chuyển khách sang thi công'],
  'thi-cong': ['Cách giữ khách hài lòng trong lúc thi công'],
}
function contextChips({ lead, ins, score, interactions, msgs }) {
  const out = []
  const add = s => { if (s && out.indexOf(s) < 0 && out.length < 4) out.push(s) }
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null
  if (last && last.role === 'ai') {
    if (last.proposal && !last.status) add('Giải thích vì sao nên sửa như vậy')
    add('Viết ngắn gọn hơn')
  }
  if (!ins) add('Nên làm gì tiếp với khách này?')
  const real = (interactions || []).filter(x => x && !isSystemEntry(x) && x.date)
  const lastDate = real.reduce((m, x) => (String(x.date) > m ? String(x.date).slice(0, 10) : m), '')
  const gap = lastDate ? daysBetween(lastDate, todayIso()) : null
  if (gap === null) add('Soạn tin Zalo làm quen với khách')
  else if (gap >= 7) add('Soạn tin Zalo hỏi thăm sau ' + gap + ' ngày chưa liên hệ')
  const locked = score && Array.isArray(score.criteria) ? score.criteria.filter(c => c && c.lock) : []
  if (locked.length) add('Làm sao gỡ điểm liệt "' + locked[0].label + '"?')
  ;(STAGE_CHIPS[lead && lead.stage] || []).forEach(add)
  if (ins) {
    const steps = ins.roadmap && Array.isArray(ins.roadmap.steps) ? ins.roadmap.steps : []
    if (!ins.roadmap || !ins.roadmap.anchor) add('Cần hỏi khách gì để chốt mốc khởi công?')
    else if (!steps.some(s => /khảo sát/i.test(String((s && s.label) || '')))) add('Thêm mốc khảo sát công trình vào timeline')
    if (ins.actions && ins.actions.main && ins.actions.main.zalo) add('Viết lại tin Zalo thân thiện hơn')
    if (ins.strategy && Array.isArray(ins.strategy.risks) && ins.strategy.risks.length) add('Rủi ro lớn nhất là gì?')
  }
  ;['Tóm tắt khách này', 'Rủi ro lớn nhất là gì?'].forEach(add)
  return out
}

const skey = id => 'kd-aichat-' + id
let seq = 0
const newKey = () => Date.now().toString(36) + '-' + (++seq) + '-' + Math.random().toString(36).slice(2, 7)
function loadMsgs(id) {
  try {
    const v = JSON.parse(sessionStorage.getItem(skey(id)) || '[]')
    return Array.isArray(v)
      ? v.filter(m => m && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string').slice(-MAX_KEEP)
        .map(m => (typeof m.key === 'string' && m.key ? m : { ...m, key: newKey() }))
      : []
  } catch { return [] }
}
function saveMsgs(id, msgs) {
  try {
    if (msgs.length) sessionStorage.setItem(skey(id), JSON.stringify(msgs.slice(-MAX_KEEP)))
    else sessionStorage.removeItem(skey(id))
  } catch { /* bỏ qua */ }
}

const tx = v => (v == null ? '' : String(v)).trim()
const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tx(s)); return m ? m[3] + '/' + m[2] : tx(s) }

const NONE = '(xoá hết)'

/* Xem trước gọn phần AI đề xuất */
function Preview({ section, content }) {
  const v = content && content[section]
  if (section === 'actions') {
    const main = (v && v.main) || {}
    const side = (v && Array.isArray(v.side) ? v.side : []).filter(x => x && tx(x.title))
    return (
      <div className="cd-aic2-pv">
        {tx(main.title) && <div className="cd-aic2-pv-main"><span className="cd-aic2-pv-cap">Hành động chính</span><b>{tx(main.title)}</b>
          {tx(main.zalo) && <div className="cd-aic2-pv-zalo">{tx(main.zalo)}</div>}</div>}
        {side.length > 0 && <ul>{side.map((x, i) => <li key={i}>{tx(x.tag) ? <em>{tx(x.tag)}</em> : null}{tx(x.title)}</li>)}</ul>}
      </div>
    )
  }
  if (section === 'strategy') {
    const risks = (v && Array.isArray(v.risks) ? v.risks : []).map(tx).filter(Boolean)
    return (
      <div className="cd-aic2-pv">
        {tx(v && v.headline) && <div className="cd-aic2-pv-main"><span className="cd-aic2-pv-cap">Nhận định</span>{tx(v.headline)}</div>}
        <span className="cd-aic2-pv-cap">Rủi ro</span>
        {risks.length > 0 ? <ul>{risks.map((r, i) => <li key={i}>{r}</li>)}</ul> : <div className="cd-aic2-pv-none">{NONE}</div>}
      </div>
    )
  }
  if (section === 'ideas') {
    const list = (Array.isArray(v) ? v : []).filter(x => x && tx(x.title))
    return <div className="cd-aic2-pv">{list.length > 0
      ? <ul>{list.map((x, i) => <li key={i}><b>{tx(x.title)}</b>{tx(x.desc) ? ' - ' + tx(x.desc) : ''}</li>)}</ul>
      : <div className="cd-aic2-pv-none">{NONE}</div>}</div>
  }
  if (section === 'roadmap') {
    const steps = (v && Array.isArray(v.steps) ? v.steps : []).filter(x => x && (tx(x.label) || tx(x.date)))
    return <div className="cd-aic2-pv">{steps.length > 0
      ? <ul>{steps.map((x, i) => <li key={i}>{tx(x.date) ? <em>{dmy(x.date)}</em> : null}{tx(x.label)}</li>)}</ul>
      : <div className="cd-aic2-pv-none">{NONE}</div>}</div>
  }
  return null
}

export default function CdAiChat({ lead, interactions }) {
  const id = lead ? lead.id : null
  const [msgs, setMsgs] = useState(() => (id == null ? [] : loadMsgs(id)))
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [gen, setGen] = useState(undefined)       // generatedAt bản phân tích mới nhất (null = chưa có, undefined = chưa tải)
  const [ins, setIns] = useState(null)            // bản phân tích mới nhất (cho chip gợi ý theo ngữ cảnh)
  const [score, setScore] = useState(null)        // chỉ số đánh giá (điểm liệt -> chip gợi ý)
  const [applying, setApplying] = useState(null)   // key của tin đang áp dụng
  const [owner, setOwner] = useState(id)        // khách sở hữu msgs hiện tại (đổi khách: không ghi tin khách cũ sang khách mới)
  const listRef = useRef(null)
  const taRef = useRef(null)
  const idRef = useRef(id)
  idRef.current = id

  const dict = useDictation(t => setInput(s => (s && s.trim() ? s.replace(/\s+$/, '') + ' ' + t : t)))

  function loadGen() {
    if (id == null) return
    const at = id
    getInsights(id).then(r => { if (idRef.current === at) { setGen((r && r.insight && r.insight.generatedAt) || null); setIns((r && r.insight) || null) } }, () => {})
  }
  function loadScore() {
    if (id == null) return
    const at = id
    getScore(id).then(r => { if (idRef.current === at) setScore(r || null) }, () => {})
  }
  useEffect(() => {
    setMsgs(id == null ? [] : loadMsgs(id)); setOwner(id); setInput(''); setErr(''); setGen(undefined); setIns(null); setScore(null); setApplying(null); setSending(false); dict.stop()
    loadGen(); loadScore()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useLeadChange(id, ['insights'], () => loadGen())
  useLeadChange(id, ['score'], () => loadScore())

  useEffect(() => { if (id != null && owner === id) saveMsgs(id, msgs) }, [id, owner, msgs])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, sending, err])

  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  async function send(raw) {
    const text = tx(raw).slice(0, MAX_TEXT)
    if (!text || sending || id == null) return
    dict.stop()
    const at = id
    const base = gen == null ? null : gen
    const next = [...msgs, { key: newKey(), role: 'user', text }].slice(-MAX_KEEP)
    setMsgs(next); setInput(''); setErr(''); setSending(true)
    try {
      const body = next.slice(-MAX_SEND).map(m => ({ role: m.role, text: String(m.text || '').slice(0, MAX_TEXT) }))
      const r = await chatInsight(id, body, base)
      if (idRef.current !== at) return
      const p = r && r.proposal
      const ok = p && SECTION[p.section] && p.content && typeof p.content === 'object'
      const ai = { key: newKey(), role: 'ai', text: tx(r && r.reply) || '(AI không trả lời)', engine: (r && r.engine) || '', model: (r && r.model) || '' }
      if (ok) {
        ai.proposal = { section: p.section, summary: tx(p.summary), content: p.content }
        // bản mà đề xuất dựa vào: theo máy chủ (bản mới nhất lúc hỏi), không theo gen của giao diện (có thể chưa tải / cũ)
        ai.base = p.generatedAt != null ? p.generatedAt : base
        ai.baseEdit = p.editedAt || null
      }
      setMsgs(m => [...m, ai].slice(-MAX_KEEP))
    } catch (e) {
      if (idRef.current === at) setErr((e && e.message) || 'Không hỏi được AI')
    } finally {
      if (idRef.current === at) setSending(false)
    }
  }

  const mark = (key, patch) => setMsgs(m => m.map(x => (x.key === key ? { ...x, ...patch } : x)))

  async function apply(key) {
    const m = msgs.find(x => x.key === key)
    if (!m || !m.proposal || applying != null || id == null) return
    const at = id
    setApplying(key); setErr('')
    const changed = () => mark(key, { status: 'stale' })
    try {
      const r = await getInsights(id)
      const cur = r && r.insight
      // generatedAt: lập lại bản mới; editedAt: sửa tay / áp dụng đề xuất khác sau khi AI đề xuất (PATCH không đổi generatedAt)
      if (!cur || (m.base || null) !== (cur.generatedAt || null) || (m.baseEdit || null) !== (cur.editedAt || null)) {
        if (idRef.current === at) changed()
        return
      }
      const sec = m.proposal.section
      const content = {
        actions: cur.actions || {}, strategy: cur.strategy || {}, ideas: cur.ideas || [], roadmap: cur.roadmap || { steps: [] },
        [sec]: m.proposal.content[sec],
      }
      await updateInsight(id, content, cur.generatedAt)
      if (idRef.current !== at) return
      mark(key, { status: 'applied' })
      emitLeadChange(id, 'insights')
    } catch (e) {
      if (idRef.current !== at) return
      if (e && e.status === 409) changed()
      else setErr('Không áp dụng được: ' + ((e && e.message) || e))
    } finally {
      if (idRef.current === at) setApplying(null)
    }
  }

  function clearAll() {
    if (sending) return
    setMsgs([]); setErr('')
  }

  const lastAi = [...msgs].reverse().find(m => m.role === 'ai' && (m.engine || m.model))
  const engineLabel = lastAi ? (lastAi.engine === 'gemini' ? 'Gemini' : lastAi.engine) + (lastAi.model ? ' · ' + lastAi.model : '') : ''

  return (
    <section className="cd-card cd-aic2" aria-label="Hỏi AI">
      <div className="cd-card-h">
        <span className="cd-card-t cd-aic2-t">Hỏi AI</span>
        <span className="cd-aic2-hr">
          {engineLabel && <span className="cd-aic2-engine">{engineLabel}</span>}
          {msgs.length > 0 && <button type="button" className="cd-link-btn" disabled={sending} onClick={clearAll}>Xoá hội thoại</button>}
        </span>
      </div>
      <p className="cd-aic2-intro">Hỏi về khách này hoặc nhờ AI sửa phần phân tích (timeline, chiến lược, đề xuất hành động, gợi ý)</p>
      {gen === null && <p className="cd-aic2-note">Khách chưa có bản phân tích: AI vẫn trả lời câu hỏi; muốn nhờ sửa, bấm "Phân tích ngay" trước.</p>}

      {(msgs.length > 0 || sending || err) && (
        <div className="cd-aic2-list" ref={listRef} aria-live="polite">
          {msgs.map(m => (
            <div key={m.key} className={'cd-aic2-row ' + (m.role === 'user' ? 'me' : 'ai') + (m.role === 'ai' && m.proposal ? ' has-prop' : '')}>
              <div className="cd-aic2-bub">{m.text}</div>
              {m.role === 'ai' && m.proposal && (
                <div className={'cd-aic2-prop' + (m.status ? ' ' + m.status : '')}>
                  <div className="cd-aic2-prop-h">Đề xuất sửa: {SECTION[m.proposal.section]}</div>
                  {m.proposal.summary && <div className="cd-aic2-prop-s">{m.proposal.summary}</div>}
                  <Preview section={m.proposal.section} content={m.proposal.content} />
                  {m.status === 'applied' ? <div className="cd-aic2-prop-ok">Đã áp dụng</div>
                    : m.status === 'dismissed' ? <div className="cd-aic2-prop-off">Đã bỏ qua</div>
                    : m.status === 'stale' ? <div className="cd-aic2-prop-bad">Bản phân tích đã đổi, hỏi lại để có đề xuất mới</div>
                    : (
                      <div className="cd-aic2-prop-b">
                        <button type="button" className="cd-btn sm cd-btn-pri" disabled={applying != null} onClick={() => apply(m.key)}>{applying === m.key ? 'Đang áp dụng…' : 'Áp dụng'}</button>
                        <button type="button" className="cd-btn sm" disabled={applying === m.key} onClick={() => mark(m.key, { status: 'dismissed' })}>Bỏ qua</button>
                      </div>
                    )}
                </div>
              )}
            </div>
          ))}
          {sending && <div className="cd-aic2-row ai"><div className="cd-aic2-bub cd-aic2-wait">AI đang trả lời…</div></div>}
          {err && <div className="cd-aic2-err" role="alert">{err}</div>}
        </div>
      )}

      <div className="cd-aic2-chips">
        {contextChips({ lead, ins, score, interactions, msgs }).map(c => <button key={c} type="button" className="cd-aic2-chip" disabled={sending} onClick={() => send(c)}>{c}</button>)}
      </div>

      <div className="cd-aic2-box">
        <textarea ref={taRef} rows={1} value={input} placeholder="Hỏi hoặc nhờ AI sửa…" aria-label="Câu hỏi cho AI" maxLength={MAX_TEXT}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) }
          }} />
        <button type="button" className={'cd-aic2-mic' + (dict.listening ? ' on' : '')} disabled={!dict.supported} aria-pressed={dict.listening}
          title={dict.supported ? (dict.listening ? 'Đang nghe: bấm để dừng' : 'Ghi âm: bấm rồi nói, lời nói thêm vào ô câu hỏi') : 'Trình duyệt này chưa hỗ trợ ghi âm thành chữ (dùng Chrome / Edge)'}
          aria-label="Ghi âm thành chữ" onClick={dict.toggle}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></svg>
        </button>
        <button type="button" className="cd-btn cd-btn-pri cd-aic2-send" disabled={sending || !tx(input)} onClick={() => send(input)}>Gửi</button>
      </div>
      {dict.listening && dict.interim && <div className="cd-aic2-interim">{dict.interim}</div>}
      {dict.error && <div className="cd-aic2-err">{dict.error}</div>}
    </section>
  )
}
