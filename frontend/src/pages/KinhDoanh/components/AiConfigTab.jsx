import { useEffect, useMemo, useRef, useState } from 'react'
import { getAiConfig, saveAiConfig, previewAiPrompt, testAiPrompt } from '../customerApi'
import './AiConfigTab.css'

/* Tab "Cấu hình AI" (admin / super): soạn hướng dẫn + chọn model Gemini cho khối "Đề xuất hành động" ở trang khách hàng,
   xem prompt đầy đủ, chạy thử với 1 khách (không lưu), lịch sử phiên bản. API: customerApi getAiConfig / saveAiConfig /
   previewAiPrompt / testAiPrompt (/api/v1/sales/ai-config). canEdit=false -> chỉ xem. */

const pad = n => String(n).padStart(2, '0')
function atLabel(ts) {
  const d = ts ? new Date(ts) : null
  if (!d || isNaN(d)) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
}
const runeLen = s => Array.from(String(s || '')).length
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
const errMsg = (e, def) => (e && e.message) || def

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch (e) { /* thử cách cũ */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch (e) { return false }
}

const TIPS = [
  ['Ưu tiên kinh doanh', 'Nêu rõ mục tiêu giai đoạn này, vd "ưu tiên chốt hợp đồng thiết kế trước, thi công sau".'],
  ['Sản phẩm / dịch vụ chủ lực', 'Liệt kê gói dịch vụ, phong cách, mức giá muốn AI nhắc tới khi gợi ý.'],
  ['Giọng điệu', 'Thân thiện, xưng hô "anh/chị - em", câu ngắn; tin Zalo không quá 3-4 câu.'],
  ['Điều cần tránh', 'Không hứa giảm giá, không nhắc đối thủ bằng tên, không hối thúc khi khách đang cân nhắc.'],
  ['Cách ra quyết định', 'Khi nào đề xuất gặp trực tiếp, khi nào khảo sát công trình, khi nào gửi báo giá.'],
]

function Section({ title, open, onToggle, children, hint }) {
  return (
    <div className={'kd-aic-fold' + (open ? ' open' : '')}>
      <button type="button" className="kd-aic-fold-h" onClick={onToggle} aria-expanded={open}>
        <span className="kd-aic-caret">{open ? '▾' : '▸'}</span>
        <span className="kd-aic-fold-t">{title}</span>
        {hint && <span className="kd-aic-fold-hint">{hint}</span>}
      </button>
      {open && <div className="kd-aic-fold-b">{children}</div>}
    </div>
  )
}

function TestResult({ r, stale, showRaw, onToggleRaw, onCopyRaw }) {
  const c = (r && r.content) || {}
  const act = c.actions || {}
  const main = act.main || null
  const side = act.side || []
  const st = c.strategy || {}
  const ideas = c.ideas || []
  const steps = (c.roadmap && c.roadmap.steps) || []
  return (
    <div className="kd-aic-result">
      <div className="kd-aic-result-meta">
        <span className={'kd-aic-chip' + (r.engine === 'gemini' ? ' gem' : '')}>
          {r.engine === 'gemini' ? 'Gemini' + (r.model ? ' · ' + r.model : '') : 'Tự tính theo quy tắc'}
        </span>
        {r.ms != null && <span className="kd-aic-mut">{Math.round(Number(r.ms) || 0)} ms</span>}
        <span className="kd-aic-nosave">Kết quả chạy thử không lưu vào khách hàng</span>
        {stale}
      </div>
      {r.warning && <div className="kd-aic-warn">⚠ {r.warning}</div>}

      <div className="kd-aic-rgrid">
        <div className="kd-aic-rblock">
          <span className="kd-aic-cap">Hành động chính</span>
          {main ? (
            <div className="kd-aic-main">
              {main.priority && <span className="kd-aic-prio">{main.priority}</span>}
              <span className="kd-aic-main-t">{main.title}</span>
              {main.why && <span className="kd-aic-mut">Vì sao: {main.why}</span>}
              {main.zalo && <div className="kd-aic-zalo"><span className="kd-aic-cap">Tin Zalo</span><span>{main.zalo}</span></div>}
            </div>
          ) : <span className="kd-aic-mut">Không có.</span>}
        </div>
        <div className="kd-aic-rblock">
          <span className="kd-aic-cap">Hành động phụ ({side.length})</span>
          {side.length ? side.map((a, i) => (
            <div key={i} className="kd-aic-side">
              <span className="kd-aic-side-h">{[a.tag, a.when].filter(Boolean).join(' · ')}</span>
              <span className="kd-aic-side-t">{a.title}</span>
              {a.why && <span className="kd-aic-mut">{a.why}</span>}
            </div>
          )) : <span className="kd-aic-mut">Không có.</span>}
        </div>
        <div className="kd-aic-rblock">
          <span className="kd-aic-cap">Nhận định</span>
          <span>{st.headline || 'Không có.'}</span>
          {(st.risks || []).length > 0 && (
            <div className="kd-aic-risks">{st.risks.map((x, i) => <span key={i} className="kd-aic-risk">{x}</span>)}</div>
          )}
          {st.note && <span className="kd-aic-mut">{st.note}</span>}
          <span className="kd-aic-mut">
            {st.fit && st.fit.score != null ? 'Độ khớp ' + st.fit.score + (st.fit.label ? ' (' + st.fit.label + ')' : '') : ''}
            {st.pace && st.pace.score != null ? ' · Nhịp deal ' + st.pace.score : ''}
            {st.closeChance && st.closeChance.pct != null ? ' · Khả năng chốt ~' + Math.round(Number(st.closeChance.pct) || 0) + '%' : ''}
          </span>
        </div>
        <div className="kd-aic-rblock">
          <span className="kd-aic-cap">Gợi ý ({ideas.length})</span>
          {ideas.length ? ideas.map((w, i) => (
            <div key={w.key || i} className="kd-aic-side">
              <span className="kd-aic-side-t">{w.title}</span>
              {w.desc && <span className="kd-aic-mut">{w.desc}</span>}
            </div>
          )) : <span className="kd-aic-mut">Không có.</span>}
        </div>
      </div>

      <div className="kd-aic-rblock">
        <span className="kd-aic-cap">Lộ trình ({steps.length} mốc)</span>
        {steps.length ? (
          <ol className="kd-aic-steps">
            {steps.map((s, i) => (
              <li key={i} className={s.state || 'open'}>
                <b>{s.date}</b> {s.label}{s.desc ? <span className="kd-aic-mut"> - {s.desc}</span> : null}
              </li>
            ))}
          </ol>
        ) : <span className="kd-aic-mut">Không có lộ trình.</span>}
      </div>

      <div className="kd-aic-row">
        <button type="button" className="kd-aic-btn sm" onClick={onToggleRaw}>{showRaw ? 'Ẩn JSON thô' : 'Xem JSON thô'}</button>
        {showRaw && <button type="button" className="kd-aic-btn sm" onClick={onCopyRaw}>Chép</button>}
      </div>
      {showRaw && (
        <pre className="kd-aic-pre">{r.raw ? r.raw : JSON.stringify(c, null, 2)}</pre>
      )}
    </div>
  )
}

export default function AiConfigTab({ leads }) {
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [text, setText] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [opened, setOpened] = useState({ fixed: false, shape: false })
  const [q, setQ] = useState('')
  const [leadId, setLeadId] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [result, setResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [runErr, setRunErr] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const timer = useRef(null)
  const leadSeq = useRef(0)

  function say(t, bad) {
    setToast({ t, bad: !!bad })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  function adopt(r) {
    setCfg(r || null)
    setText((r && r.instructions) || '')
    setModel((r && typeof r.modelChoice === 'string') ? r.modelChoice : '')
  }
  function load() {
    setLoading(true); setLoadErr('')
    getAiConfig().then(adopt, e => setLoadErr(errMsg(e, 'Không tải được cấu hình AI'))).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const saved = (cfg && cfg.instructions) || ''
  const savedModel = (cfg && typeof cfg.modelChoice === 'string') ? cfg.modelChoice : ''
  const textDirty = !!cfg && text !== saved
  const modelDirty = !!cfg && model !== savedModel
  const dirty = textDirty || modelDirty
  const aiOn = !!(cfg && cfg.aiEnabled)
  const defaultModel = (cfg && cfg.defaultModel) || ''
  const models = useMemo(() => (cfg && Array.isArray(cfg.models) ? cfg.models.filter(m => m && m.id) : []), [cfg])
  /* Model đang lưu / đang nháp không có trong danh sách (lỗi lấy danh sách, model đã bị gỡ) vẫn phải chọn được */
  const extraModels = [savedModel, model].filter((id, i, a) => id && a.indexOf(id) === i && !models.some(m => m.id === id))
  const modelInfo = models.find(m => m.id === model) || null
  const modelName = id => (id ? id : 'mặc định máy chủ' + (defaultModel ? ' (' + defaultModel + ')' : ''))
  const maxLen = (cfg && Number(cfg.maxLength)) || 8000
  const len = runeLen(text)
  const over = len > maxLen
  const canEdit = !!(cfg && cfg.canEdit)
  const isDefaultDraft = !!cfg && text.trim() === String(cfg.defaultInstructions || '').trim()
  const modelLocked = !canEdit || saving || !aiOn
  /* Không có danh sách (lỗi hoặc Gemini trả rỗng): máy chủ kiểm theo mẫu tên, model ngoài danh sách vẫn có thể dùng */
  const noList = !!cfg?.modelsError || models.length === 0
  /* Model nháp (vd nạp từ lịch sử) đã bị gỡ khỏi danh sách: máy chủ sẽ từ chối khi Lưu / Chạy thử */
  const draftBad = aiOn && !!model && model !== savedModel && !noList && !models.some(m => m.id === model)

  useEffect(() => {
    if (!dirty) return
    const h = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const list = useMemo(() => {
    const all = Array.isArray(leads) ? leads : []
    const k = fold(q.trim())
    const out = k ? all.filter(l => fold([l.name, l.phone, l.email].filter(Boolean).join(' ')).indexOf(k) >= 0) : all
    return out.slice(0, 200)
  }, [leads, q])
  const lead = (Array.isArray(leads) ? leads : []).find(l => String(l.id) === String(leadId)) || null

  async function save() {
    if (!canEdit || saving || over || draftBad) return
    setSaving(true)
    try {
      /* Chỉ gửi model khi đổi: model đã lưu có thể không còn trong danh sách, gửi lại sẽ bị từ chối */
      const r = await saveAiConfig(text, modelDirty ? model : null)
      adopt(r)
      say((r && r.custom ? 'Đã lưu hướng dẫn tuỳ chỉnh' : 'Đã lưu: dùng hướng dẫn mặc định') +
        (modelDirty ? ' · model: ' + ((r && r.model) || modelName(model)) : ''))
    } catch (e) {
      say('Không lưu được: ' + errMsg(e, 'lỗi không rõ'), true)
    } finally { setSaving(false) }
  }
  function draftArg() { return textDirty ? text : null }
  function draftModelArg() { return modelDirty ? model : null }
  /* Đổi khách -> tăng leadSeq; kết quả về muộn của khách cũ thì bỏ, không hiện dưới khách mới */
  function pickLead(id) {
    leadSeq.current++
    setLeadId(id); setPreview(null); setResult(null); setRunErr('')
  }
  async function doPreview() {
    if (!lead || previewing) return
    const my = leadSeq.current, forText = text
    setPreviewing(true); setRunErr('')
    try {
      const r = await previewAiPrompt(lead.id, draftArg())
      if (my === leadSeq.current) setPreview({ ...r, forText })
    } catch (e) {
      if (my === leadSeq.current) { setPreview(null); setRunErr('Không xem được prompt: ' + errMsg(e, 'lỗi không rõ')) }
    } finally { setPreviewing(false) }
  }
  async function doTest() {
    if (!lead || testing || over || draftBad) return
    const my = leadSeq.current, forText = text, forModel = model
    setTesting(true); setRunErr(''); setShowRaw(false)
    try {
      const r = await testAiPrompt(lead.id, draftArg(), draftModelArg())
      if (my === leadSeq.current) setResult({ ...r, forText, forModel })
    } catch (e) {
      if (my === leadSeq.current) setRunErr('Không chạy thử được: ' + errMsg(e, 'lỗi không rõ'))
    } finally { setTesting(false) }
  }
  /* forModel chỉ có ở kết quả chạy thử (prompt xem trước không phụ thuộc model) */
  function staleChip(r) {
    if (!r) return null
    const t = r.forText !== text, m = 'forModel' in r && r.forModel !== model
    if (!t && !m) return null
    const what = t && m ? 'hướng dẫn và model đã đổi' : (t ? 'hướng dẫn đã đổi' : 'model đã đổi')
    return <span className="kd-aic-chip dirty">Đã cũ: {what}, bấm chạy lại</span>
  }
  async function copy(t, label) { say((await copyText(t)) ? 'Đã chép ' + label : 'Không chép được', false) }

  const toastEl = toast && <div className={'kd-aic-toast' + (toast.bad ? ' bad' : '')} role="status">{toast.t}</div>

  if (loading || loadErr || !cfg) {
    return (
      <div className="kd-aic">
        <div className="kd-aic-card kd-aic-empty">
          {loading ? 'Đang tải cấu hình AI...' : (
            <>
              <span className="kd-aic-err">{loadErr || 'Chưa có dữ liệu cấu hình AI'}</span>
              <button type="button" className="kd-aic-btn" onClick={load}>Thử lại</button>
            </>
          )}
        </div>
      </div>
    )
  }

  const history = cfg.history || []

  return (
    <div className="kd-aic">
      <div className="kd-aic-head">
        <div>
          <div className="kd-aic-title">Cấu hình AI · Đề xuất hành động</div>
          <div className="kd-aic-sub">Soạn hướng dẫn cho AI phân tích khách hàng (khối "Đề xuất hành động" ở trang khách hàng). Áp dụng cho cả công ty ở lần phân tích tiếp theo.</div>
        </div>
        <div className={'kd-aic-status' + (cfg.aiEnabled ? ' on' : '')}
          title={cfg.aiEnabled ? 'Model đang dùng thật' + ((!savedModel || cfg.model !== savedModel) ? ' (mặc định máy chủ)' : '') : undefined}>
          <span className="kd-aic-dot" />
          {cfg.aiEnabled ? 'AI đang bật' + (cfg.model ? ' · ' + cfg.model : '') : 'Chưa cấu hình khoá AI: đang dùng gợi ý theo quy tắc'}
        </div>
      </div>

      {!canEdit && <div className="kd-aic-note">Bạn chỉ có quyền xem. Chỉ quản trị công ty mới sửa và chạy thử được hướng dẫn cho AI.</div>}

      <div className="kd-aic-grid">
        <div className="kd-aic-col">
          <div className="kd-aic-card">
            <div className="kd-aic-card-h">
              <span className="kd-aic-card-t">Hướng dẫn cho AI</span>
              <span className={'kd-aic-chip' + (cfg.custom ? ' custom' : '')}>Đang dùng: {cfg.custom ? 'Tuỳ chỉnh' : 'Mặc định'}</span>
              {dirty && <span className="kd-aic-chip dirty">Chưa lưu</span>}
            </div>
            {cfg.updatedAt && <div className="kd-aic-mut">Cập nhật lúc {atLabel(cfg.updatedAt)}{cfg.updatedBy ? ' bởi ' + cfg.updatedBy : ''}</div>}
            <div className="kd-aic-model">
              <label className="kd-aic-model-l" htmlFor="kd-aic-model-sel">Model AI</label>
              <select id="kd-aic-model-sel" className="kd-aic-in kd-aic-model-sel" value={model} disabled={modelLocked}
                onChange={e => setModel(e.target.value)}>
                <option value="">Mặc định máy chủ{defaultModel ? ' (' + defaultModel + ')' : ''}</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.label && m.label !== m.id ? m.label + ' · ' + m.id : m.id}</option>)}
                {extraModels.map(id => (
                  <option key={'x-' + id} value={id}>{id}{id === savedModel ? ' (đang lưu' : ' (bản cũ'}{noList ? ')' : ', không có trong danh sách)'}</option>
                ))}
              </select>
              {modelDirty && <span className="kd-aic-chip dirty">Đổi từ: {modelName(savedModel)}</span>}
            </div>
            {!aiOn ? (
              <div className="kd-aic-mut">Máy chủ chưa cấu hình khoá AI nên không chọn được model.</div>
            ) : (
              <>
                {cfg.modelsError && <div className="kd-aic-warn">⚠ Không lấy được danh sách model: {cfg.modelsError}. Vẫn chọn được model đang lưu hoặc mặc định máy chủ.</div>}
                {!cfg.modelsError && models.length === 0 && (
                  <div className="kd-aic-warn">⚠ Gemini không trả model nào, chỉ chọn được model đang lưu hoặc mặc định máy chủ.</div>
                )}
                {draftBad && (
                  <div className="kd-aic-warn">⚠ Model {model} không còn dùng được, chọn model khác hoặc mặc định máy chủ.</div>
                )}
                {!modelDirty && savedModel && cfg.model && cfg.model !== savedModel && (
                  <div className="kd-aic-warn">⚠ Model đã lưu ({savedModel}) không dùng được: đang dùng {cfg.model}.</div>
                )}
                {modelInfo && modelInfo.desc && <div className="kd-aic-mut kd-aic-model-d">{modelInfo.desc}</div>}
              </>
            )}
            <textarea className="kd-aic-ta" value={text} readOnly={!canEdit || saving} spellCheck={false}
              placeholder="Để trống = dùng hướng dẫn mặc định"
              onChange={e => setText(e.target.value)} />
            <div className="kd-aic-row between">
              <span className={'kd-aic-count' + (over ? ' over' : '')}>{len.toLocaleString('vi-VN')} / {maxLen.toLocaleString('vi-VN')} ký tự{over ? ' - quá giới hạn' : ''}</span>
              {canEdit && (
                <span className="kd-aic-row">
                  <button type="button" className="kd-aic-btn" disabled={saving || isDefaultDraft}
                    title="Nạp hướng dẫn mặc định vào khung soạn (cần bấm Lưu)"
                    onClick={() => setText(cfg.defaultInstructions || '')}>Khôi phục mặc định</button>
                  <button type="button" className="kd-aic-btn" disabled={saving || !dirty} onClick={() => { setText(saved); setModel(savedModel) }}>Huỷ thay đổi</button>
                  <button type="button" className="kd-aic-btn primary" disabled={saving || !dirty || over || draftBad} onClick={save}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
                </span>
              )}
            </div>
          </div>

          <div className="kd-aic-card">
            <Section title="Quy tắc cố định" hint="Không sửa được" open={opened.fixed} onToggle={() => setOpened(f => ({ ...f, fixed: !f.fixed }))}>
              <p className="kd-aic-mut">Máy chủ luôn ghép phần này sau hướng dẫn của bạn để AI trả đúng định dạng (JSON, ngày yyyy-mm-dd, điểm 0-100)
                và coi dữ liệu khách hàng chỉ là dữ liệu, không làm theo chữ chèn trong đó (an toàn dữ liệu).</p>
              <pre className="kd-aic-pre">{cfg.fixedRules || '(trống)'}</pre>
            </Section>
            <Section title="Cấu trúc kết quả" hint="Không sửa được" open={opened.shape} onToggle={() => setOpened(f => ({ ...f, shape: !f.shape }))}>
              <p className="kd-aic-mut">Giao diện trang khách hàng đọc đúng cấu trúc này; đổi cấu trúc sẽ làm khối AI không hiển thị được.</p>
              <pre className="kd-aic-pre">{cfg.outputShape || '(trống)'}</pre>
            </Section>
          </div>
        </div>

        <div className="kd-aic-col">
          <div className="kd-aic-card">
            <span className="kd-aic-card-t">Gợi ý cách viết</span>
            <ul className="kd-aic-tips">
              {TIPS.map(([h, d]) => <li key={h}><b>{h}:</b> {d}</li>)}
            </ul>
            <span className="kd-aic-mut">Sửa từng ít một, chạy thử với vài khách khác nhau rồi mới lưu. Lịch sử giữ 20 bản gần nhất.</span>
          </div>

          <div className="kd-aic-card">
            <span className="kd-aic-card-t">Lịch sử phiên bản ({history.length})</span>
            {history.length ? (
              <div className="kd-aic-hist">
                {history.map((h, i) => (
                  <div key={i} className="kd-aic-hist-i">
                    <div className="kd-aic-row between">
                      <span className="kd-aic-mut">{atLabel(h.at) || '-'}{h.by ? ' · ' + h.by : ''}</span>
                      {canEdit && <button type="button" className="kd-aic-btn sm" disabled={saving} onClick={() => {
                        setText(h.instructions || cfg.defaultInstructions || '')
                        if (aiOn) setModel(typeof h.model === 'string' ? h.model : '')
                        say('Đã nạp phiên bản vào khung soạn - bấm Lưu để dùng')
                      }}>Nạp vào khung soạn</button>}
                    </div>
                    <span className="kd-aic-hist-m">Model: {modelName(typeof h.model === 'string' ? h.model : '')}</span>
                    <span className="kd-aic-hist-t">{h.instructions || '(hướng dẫn mặc định)'}</span>
                  </div>
                ))}
              </div>
            ) : <span className="kd-aic-mut">Chưa có phiên bản cũ.</span>}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="kd-aic-card">
          <div className="kd-aic-card-h">
            <span className="kd-aic-card-t">Chạy thử</span>
            <span className="kd-aic-mut">
              {dirty ? 'Dùng bản nháp đang soạn' : 'Dùng bản đang lưu'}
              {aiOn ? ' · model: ' + (modelDirty ? modelName(model) : (cfg.model || modelName(savedModel))) : ''}
            </span>
          </div>
          <div className="kd-aic-pick">
            <input className="kd-aic-in" type="search" placeholder="Tìm khách hàng (tên, số điện thoại)" value={q} onChange={e => setQ(e.target.value)} />
            <select className="kd-aic-in" value={leadId} onChange={e => pickLead(e.target.value)}>
              <option value="">- Chọn khách hàng ({list.length}) -</option>
              {list.map(l => <option key={l.id} value={String(l.id)}>{l.name || 'Khách #' + l.id}{l.phone ? ' · ' + l.phone : ''}</option>)}
              {lead && !list.some(l => String(l.id) === String(lead.id)) && <option value={String(lead.id)}>{lead.name}</option>}
            </select>
          </div>
          <div className="kd-aic-row">
            <button type="button" className="kd-aic-btn" disabled={!lead || previewing} onClick={doPreview}>{previewing ? 'Đang tạo prompt...' : 'Xem prompt đầy đủ'}</button>
            <button type="button" className="kd-aic-btn primary" disabled={!lead || testing || over || draftBad} onClick={doTest}>{testing ? 'Đang chạy thử...' : 'Chạy thử với bản nháp'}</button>
          </div>
          {runErr && <div className="kd-aic-err">{runErr}</div>}

          {preview && (
            <div className="kd-aic-prev">
              <div className="kd-aic-row between">
                <span className="kd-aic-cap">System (hướng dẫn + quy tắc cố định) {staleChip(preview)}</span>
                <button type="button" className="kd-aic-btn sm" onClick={() => copy(preview.system || '', 'system')}>Chép</button>
              </div>
              <pre className="kd-aic-pre">{preview.system || ''}</pre>
              <div className="kd-aic-row between">
                <span className="kd-aic-cap">Prompt (dữ liệu khách hàng)</span>
                <button type="button" className="kd-aic-btn sm" onClick={() => copy(preview.prompt || '', 'prompt')}>Chép</button>
              </div>
              <pre className="kd-aic-pre">{preview.prompt || ''}</pre>
            </div>
          )}

          {result && (
            <TestResult r={result} stale={staleChip(result)} showRaw={showRaw} onToggleRaw={() => setShowRaw(v => !v)}
              onCopyRaw={() => copy(result.raw || JSON.stringify(result.content || {}, null, 2), 'JSON')} />
          )}
        </div>
      )}
      {toastEl}
    </div>
  )
}
