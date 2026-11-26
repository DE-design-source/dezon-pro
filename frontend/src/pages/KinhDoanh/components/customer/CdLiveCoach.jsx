import { useEffect, useRef, useState } from 'react'
import { liveSuggest } from '../../customerApi'
import { setCoach, clearCoach, useLiveCoach } from './liveCoachStore'

/* "AI gợi ý trực tiếp" khi Live: trong lúc nói chuyện, gửi đoạn hội thoại gần nhất cho máy chủ
   (POST /sales/leads/:id/live-suggest; Gemini chế độ suy nghĩ ít, ~3-4 giây; đọc kèm dữ liệu khách + kiến thức bán hàng)
   để gợi ý cho nhân viên: trả lời câu khách vừa hỏi, câu nên hỏi tiếp, thông tin còn thiếu. Không lưu gì.
   - CdLiveCoach (trong khối Live, cột phụ): gọi máy chủ + nút Tự gợi ý / Gợi ý ngay, gọn 1 dòng trạng thái.
   - LiveCoachCards (trong phần Gợi ý của khối AI, cột chính): các ô gợi ý to để nhân viên đọc và nói theo.
   Hai phần nói chuyện qua liveCoachStore. Tự gợi ý: có câu mới thì chờ người nói ngừng ~1 giây rồi gợi ý, mỗi lần cách nhau
   ít nhất 5 giây; câu mới tới lúc đang chờ AI thì gợi ý tiếp ngay khi xong. Kết quả cũ bị bỏ nếu đã có yêu cầu mới hơn. */

const AUTO_KEY = 'kd-live-coach-auto'
const QUIET_MS = 1000
const GAP_MS = 5000
const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== '0' } catch { return true } }
const hms = iso => { const d = new Date(iso); return isNaN(d) ? '' : [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':') }
const sigOf = ls => ls.length + ':' + (ls.length ? ls[ls.length - 1].t.length + ':' + ls[ls.length - 1].who : '')

export default function CdLiveCoach({ leadId, lines, elapsed }) {
  const [auto, setAuto] = useState(readAuto)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const seq = useRef(0)
  const ctl = useRef(null)
  const lastAt = useRef(0)          // lúc gửi yêu cầu gần nhất
  const sentSig = useRef('')        // hội thoại đã gửi (không gửi lại khi chưa có gì mới)
  const again = useRef(false)       // có câu mới trong lúc đang chờ AI
  const elapsedRef = useRef(elapsed)
  elapsedRef.current = elapsed
  const linesRef = useRef(lines)
  linesRef.current = lines
  const autoRef = useRef(auto)
  autoRef.current = auto

  const ask = () => {
    const ls = linesRef.current
    if (!ls.length) return
    if (ctl.current) ctl.current.abort()
    const c = new AbortController()
    ctl.current = c
    const n = ++seq.current
    lastAt.current = Date.now()
    sentSig.current = sigOf(ls)
    again.current = false
    setBusy(true); setErr('')
    liveSuggest(leadId, ls.slice(-60).map(({ who, t, at }) => ({ who, t, at })), elapsedRef.current, c.signal)
      .then(r => { if (n === seq.current) setRes(r) })
      .catch(e => {
        if (n !== seq.current || (e && e.name === 'QsAbortError')) return
        if (e && e.status === 429) { again.current = true; return }
        setErr((e && e.message) || 'Không lấy được gợi ý')
      })
      .finally(() => {
        if (n !== seq.current) return
        setBusy(false); ctl.current = null
        // câu mới tới trong lúc chờ: gợi ý tiếp (giữ khoảng cách tối thiểu)
        if (autoRef.current && (again.current || sigOf(linesRef.current) !== sentSig.current)) {
          const wait = Math.max(300, lastAt.current + GAP_MS - Date.now())
          setTimeout(() => { if (n === seq.current && !ctl.current) ask() }, wait)
        }
      })
  }
  const askRef = useRef(ask)
  askRef.current = ask

  // tự gợi ý: có câu mới -> chờ ngừng nói QUIET_MS, cách lần trước ít nhất GAP_MS; đang chờ AI thì đánh dấu gợi ý tiếp
  const s = sigOf(lines)
  useEffect(() => {
    if (!auto || !lines.length || s === sentSig.current) return undefined
    if (ctl.current) { again.current = true; return undefined }
    const wait = Math.max(QUIET_MS, lastAt.current + GAP_MS - Date.now())
    const t = setTimeout(() => { if (!ctl.current) askRef.current() }, wait)
    return () => clearTimeout(t)
  }, [auto, s]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAuto = () => setAuto(v => { const n = !v; try { localStorage.setItem(AUTO_KEY, n ? '1' : '0') } catch { /* bỏ qua */ } return n })
  // đưa trạng thái lên store cho phần Gợi ý của khối AI
  useEffect(() => {
    setCoach(leadId, { res, busy, err, auto, canAsk: lines.length > 0, ask: () => askRef.current(), toggleAuto })
  }, [leadId, res, busy, err, auto, lines.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { seq.current++; if (ctl.current) ctl.current.abort(); clearCoach(leadId) }, [leadId])

  return (
    <div className="cd-live-coach mini" aria-label="AI gợi ý cho nhân viên">
      <div className="cd-live-coach-h">
        <span className="cd-live-coach-t"><span className="cd-live-coach-badge">AI</span>Gợi ý cho nhân viên{res && res.stage ? <em>{res.stage}</em> : null}</span>
        <label className="cd-live-coach-auto" title="Tự gợi ý khi có câu mới">
          <input type="checkbox" checked={auto} onChange={toggleAuto} />Tự gợi ý
        </label>
        <button type="button" className="cd-live-coach-now" disabled={busy || !lines.length} onClick={ask}>{busy ? 'Đang nghĩ…' : 'Gợi ý ngay'}</button>
      </div>
      <div className="cd-live-coach-st">
        {err ? <span className="cd-live-coach-err">{err}</span>
          : busy ? 'AI đang đọc đoạn hội thoại…'
            : res ? 'Đã gợi ý lúc ' + hms(res.at) + ' - xem các ô gợi ý ở phần GỢI Ý (khối AI bên trái).'
              : 'Khi có câu nói, AI gợi ý câu trả lời / câu hỏi ở phần GỢI Ý (khối AI bên trái).'}
      </div>
    </div>
  )
}

/* Các ô gợi ý to trong phần Gợi ý của khối AI (chỉ hiện khi đang Live): tối đa 3 ô (trả lời khách trước, rồi câu nên hỏi),
   nhận định + thông tin còn thiếu bên dưới. */
export function LiveCoachCards({ leadId }) {
  const c = useLiveCoach(leadId)
  if (!c) return null
  const r = c.res
  const cards = []
  if (r) {
    for (const x of r.answers || []) cards.push({ kind: 'ans', title: x.q ? 'Khách hỏi: ' + x.q : 'Trả lời khách', body: x.a })
    for (const q of r.ask || []) cards.push({ kind: 'ask', title: 'Nên hỏi tiếp', body: q })
  }
  return (
    <div className="cd-ai-live-w" aria-live="polite">
      <div className="cd-ai-ideas-h">
        <span className="cd-ai-cap cd-ai-live-cap"><i aria-hidden="true" />Gợi ý trực tiếp khi Live{r && r.stage ? ' · ' + r.stage : ''}</span>
        <span className="cd-ai-live-act">
          <span className="cd-ai-live-at">{c.busy ? 'AI đang đọc…' : r ? 'Cập nhật ' + hms(r.at) : ''}</span>
          <label className="cd-live-coach-auto"><input type="checkbox" checked={!!c.auto} onChange={() => c.toggleAuto && c.toggleAuto()} />Tự gợi ý</label>
          <button type="button" className="cd-ai-btn sm" disabled={c.busy || !c.canAsk} onClick={() => c.ask && c.ask()}>{c.busy ? 'Đang nghĩ…' : 'Gợi ý ngay'}</button>
        </span>
      </div>
      {c.err && <span className="cd-ai-errtext">{c.err}</span>}
      {r && r.insight && <div className="cd-ai-live-ins">{r.insight}</div>}
      {cards.length ? (
        <div className={'cd-ai-ideas cd-ai-live-cards' + (c.busy ? ' busy' : '')}>
          {cards.slice(0, 3).map((x, i) => (
            <div key={i} className={'cd-ai-idea cd-ai-live-card ' + x.kind}>
              <span className="cd-ai-live-k">{x.kind === 'ans' ? 'Trả lời khách' : 'Câu nên hỏi'}</span>
              <span className="cd-ai-idea-d">{x.title}</span>
              <span className="cd-ai-idea-t">{x.body}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="cd-ai-none">{c.busy ? 'AI đang đọc đoạn hội thoại để gợi ý…' : 'Khi khách nói, AI sẽ gợi ý câu trả lời và câu hỏi tiếp theo ở đây (khoảng 3-5 giây).'}</span>
      )}
      {r && r.missing && r.missing.length > 0 && (
        <div className="cd-live-coach-miss"><b>Còn thiếu:</b>{r.missing.map((x, i) => <span key={i}>{x}</span>)}</div>
      )}
    </div>
  )
}
