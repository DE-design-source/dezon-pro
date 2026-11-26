import { useEffect, useRef, useState } from 'react'
import { createRecording, emitLeadChange } from '../../customerApi'
import useDictation from './useDictation'
import useAudioRecorder from './useAudioRecorder'
import CdLiveCoach from './CdLiveCoach'
import './live.css'

/* Khối "Live" (cột phụ trang khách hàng, mở bằng nút Live ở đầu phần AI): ghi lại cuộc trò chuyện nhân viên - khách thành chữ.
   Giọng nói -> chữ bằng Web Speech API của trình duyệt (useDictation, Chrome / Edge, vi-VN); máy không tách được ai nói nên
   nhân viên bấm "Nhân viên" / "Khách" để đổi người đang nói (bấm lúc câu đang nhận dạng thì câu đó thuộc người mới),
   câu sai người thì bấm nhãn trên câu để đổi, bấm chữ để sửa. Gõ tay thêm câu được (khi nhận giọng sai / không có micro).
   Câu liền nhau của cùng người (cách nhau dưới 20 giây, không tạm dừng / đổi người / đang sửa) gộp thành 1 dòng.
   Bản ghi dở lưu tạm ở localStorage theo khách + người ghi (kd-live:<id>:<người ghi>; người khác mở thì không thấy, không xoá mất):
   tải lại trang / lỡ rời trang vẫn còn, mở lại thì tạm dừng. Đang tải bản ghi lên thì không lưu tạm / không mở lại bản ghi dở đó.
   Song song trình duyệt ghi âm (useAudioRecorder, chạy / tạm dừng theo micro nhận giọng). Bản ghi dở mở lại sau khi tải trang
   không còn âm thanh cũ nên không ghi âm nữa (audioComplete=false, máy chủ tách người nói từ chữ).
   "Kết thúc & lưu" gửi âm thanh + các câu lên máy chủ (createRecording): máy chủ tạo 1 mục Cập nhật chăm sóc (Gặp mặt / Gọi điện)
   rồi nhờ AI nghe lại, tách lời Nhân viên / Khách (khối "Hội thoại đã ghi"). Gửi lỗi: báo ngay trong khối, giữ bản ghi để thử lại. */

const KEY = (id, me) => 'kd-live:' + id + ':' + String(me || '').trim()
const MERGE_GAP = 20      // giây
const MERGE_MAX = 1500    // ký tự tối đa của 1 dòng gộp (máy chủ cắt ở 2000)
const uploading = new Set()   // khoá bản ghi đang tải lên (còn khi rời trang khách rồi quay lại)
export function readLiveDraft(id, me) {
  if (uploading.has(KEY(id, me))) return null
  try {
    const d = JSON.parse(localStorage.getItem(KEY(id, me)) || 'null')
    if (!d || !Array.isArray(d.lines) || !d.lines.length) return null
    return d
  } catch { return null }
}
const writeDraft = (id, me, d) => { try { localStorage.setItem(KEY(id, me), JSON.stringify(d)) } catch { /* bỏ qua */ } }
const dropDraft = (id, me) => { try { localStorage.removeItem(KEY(id, me)) } catch { /* bỏ qua */ } }

const pad = n => String(n).padStart(2, '0')
const clock = s => { s = Math.max(0, Math.floor(s)); return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }
const now = () => Date.now()
let seq = 0
const newKey = () => 'l' + now() + '-' + (++seq)
const enterOk = e => e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)

const IcMic = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
  </svg>
)

const fmtSize = b => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')
const MAX_AUDIO = 20000000   // byte, giới hạn máy chủ nhận

export default function CdLive({ lead, me, onClose }) {
  const id = lead && lead.id
  const meName = String(me || '').trim()
  const draft = useRef(readLiveDraft(id, meName)).current
  const [lines, setLines] = useState(draft ? draft.lines : [])       // [{k, who: 'nv' | 'kh', t, at, end (giây)}]
  const [who, setWho] = useState(draft && draft.who === 'kh' ? 'kh' : 'nv')
  const [acc, setAcc] = useState(draft ? Number(draft.acc) || 0 : 0)  // số giây đã ghi xong (không tính lúc tạm dừng)
  const [runAt, setRunAt] = useState(0)                               // mốc bắt đầu đoạn đang nghe (0 = đang dừng)
  const [, tick] = useState(0)
  const [kind, setKind] = useState(draft && draft.kind === 'call' ? 'call' : 'meeting')
  const [typed, setTyped] = useState('')
  const [edit, setEdit] = useState(null)                              // {k, t}: câu đang sửa
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [restored, setRestored] = useState(!!draft)
  const whoRef = useRef(who)
  whoRef.current = who
  const editRef = useRef(null)
  editRef.current = edit ? edit.k : null
  const segWho = useRef(null)          // người nói của câu đang nhận dạng (chốt lúc câu bắt đầu, hoặc lúc bấm đổi người giữa câu)
  const brk = useRef(!!draft)          // câu kế tiếp luôn sang dòng mới (sau khi đổi người / tạm dừng / mở lại bản ghi dở)
  const listRef = useRef(null)
  const stick = useRef(true)           // đang ở cuối danh sách -> câu mới tự cuộn xuống
  const secRef = useRef(0)
  const rootRef = useRef(null)

  const elapsed = acc + (runAt ? (now() - runAt) / 1000 : 0)
  secRef.current = elapsed

  const add = (w, text) => {
    const t = String(text || '').trim()
    if (!t) return
    const sec = Math.floor(secRef.current)
    const cut = brk.current
    brk.current = false
    const editing = editRef.current
    setLines(ls => {
      const last = ls[ls.length - 1]
      if (last && !cut && last.who === w && last.k !== editing && last.t.length + 1 + t.length <= MERGE_MAX && sec - (last.end != null ? last.end : last.at) <= MERGE_GAP) {
        return [...ls.slice(0, -1), { ...last, t: last.t + ' ' + t, end: sec }]
      }
      return [...ls, { k: newKey(), who: w, t, at: sec, end: sec }]
    })
  }
  const dict = useDictation(text => {
    const w = segWho.current || whoRef.current
    segWho.current = null
    add(w, text)
  })
  useEffect(() => { if (dict.interim && !segWho.current) segWho.current = whoRef.current }, [dict.interim])

  // ghi âm chạy theo micro nhận giọng (bấm Tạm dừng / Tiếp tục, micro Hỏi AI giành micro, lỗi nhận giọng đều kéo theo)
  const audio = useAudioRecorder()
  const recOn = !draft && audio.supported
  const blobRef = useRef(null)          // âm thanh đã chốt ở lần lưu trước (gửi lỗi -> thử lại vẫn gửi lại)
  const gap = useRef(false)             // có lúc đang nghe mà không ghi âm được -> âm thanh không đủ cả cuộc trò chuyện
  const closed = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!recOn || closed.current) return
    if (dict.listening) { if (!audio.ended) audio.start() } else audio.pause()
  }, [dict.listening]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (recOn && dict.listening && (audio.error || audio.ended)) gap.current = true
  }, [recOn, dict.listening, audio.error, audio.ended])

  // đồng hồ: chỉ chạy khi micro đang nghe (trình duyệt tự dừng do lỗi cũng dừng đồng hồ)
  const runRef = useRef(0)
  useEffect(() => {
    if (dict.listening) { if (!runRef.current) runRef.current = now() } else if (runRef.current) {
      const r = runRef.current
      runRef.current = 0
      setAcc(a => a + (now() - r) / 1000)
    }
    setRunAt(runRef.current)
  }, [dict.listening])
  useEffect(() => {
    if (!runAt) return undefined
    const t = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [runAt])

  // bấm Live -> bắt đầu nghe ngay và cuộn tới khối Live; có bản ghi dở thì để tạm dừng cho người dùng xem lại
  // (chờ 1 nhịp: React StrictMode gắn khối 2 lần thì lần đầu bị huỷ trước khi bật micro, micro chỉ bật 1 lần)
  useEffect(() => {
    if (draft) return undefined
    const t = setTimeout(() => {
      if (dict.supported) dict.start()
      const el = rootRef.current
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 0)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // lưu tạm bản ghi dở: khi đổi nội dung + mỗi 5 giây lúc đang ghi (giữ cả thời gian đang chạy), khi rời / đóng trang
  const snap = useRef(null)
  snap.current = { lines, who, kind, owner: meName }
  const persist = () => {
    const s = snap.current
    if (closed.current || id == null || uploading.has(KEY(id, meName))) return
    if (s.lines.length) writeDraft(id, meName, { ...s, acc: Math.floor(secRef.current), at: now() })
    else dropDraft(id, meName)
  }
  const bucket = Math.floor(elapsed / 5)
  useEffect(() => { if (!saving) persist() }, [id, lines, who, kind, saving, bucket, acc]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('pagehide', persist)
    return () => { window.removeEventListener('pagehide', persist); persist() }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, dict.interim])

  if (!lead) return null
  const listening = dict.listening
  /* trạng thái micro khi đang nghe mà chưa ra chữ: giúp biết lỗi ở micro hay ở nhận dạng */
  const h = dict.heard
  const t = now()
  const micHint = !listening || h.text ? null
    : !h.audio ? (t - h.since > 5000 ? ['warn', 'Chưa mở được micro. Kiểm tra biểu tượng micro trên thanh địa chỉ Chrome (cho phép, chọn đúng micro) rồi bấm Tạm dừng, Tiếp tục.'] : ['', 'Đang bật micro…'])
    : !h.sound ? (t - h.since > 6000 ? ['warn', 'Micro đã bật nhưng chưa nghe thấy tiếng. Kiểm tra micro đang chọn (biểu tượng micro trên thanh địa chỉ Chrome, hoặc Windows: Cài đặt > Âm thanh > Đầu vào) và micro không bị tắt tiếng.'] : ['', 'Micro đã bật, hãy nói…'])
    : t - h.soundAt > 10000 ? ['warn', 'Có tiếng nhưng chưa nhận ra chữ. Nói gần micro, rõ hơn; kiểm tra mạng (nhận giọng nói cần Internet).'] : ['', 'Đang nghe…']
  const khName = String(lead.name || '').trim()
  const label = w => (w === 'nv' ? 'Nhân viên' + (meName ? ' · ' + meName : '') : 'Khách' + (khName ? ' · ' + khName : ''))
  const hasAudio = recOn && (audio.bytes > 0 || !!blobRef.current)   // có âm thanh chưa lưu (kể cả khi chưa nhận ra chữ nào)
  const busy = listening || !!edit || saving || (recOn && audio.bytes > 0)

  const pick = w => {
    if (w !== who) {
      brk.current = true
      if (dict.interim) segWho.current = w     // bấm đổi người khi câu đang nhận dạng: câu đó của người mới
    }
    setWho(w); setRestored(false)
  }
  const saveEdit = () => {
    if (!edit) return
    const t = edit.t.replace(/\s+/g, ' ').trim()
    setLines(ls => (t ? ls.map(x => (x.k === edit.k ? { ...x, t } : x)) : ls.filter(x => x.k !== edit.k)))
    setEdit(null)
  }
  // đang sửa 1 câu mà bấm nút ở câu khác: giữ focus ở ô sửa (không để blur làm danh sách co lại trước khi click), lưu câu đang sửa rồi mới làm
  const keep = e => { if (edit) e.preventDefault() }
  const act = fn => () => { if (edit) saveEdit(); fn() }
  const flip = k => setLines(ls => ls.map(x => (x.k === k ? { ...x, who: x.who === 'nv' ? 'kh' : 'nv' } : x)))
  const drop = k => setLines(ls => ls.filter(x => x.k !== k))
  // gõ câu lúc micro tắt: câu đó không có trong ghi âm -> âm thanh không đủ cả cuộc trò chuyện (AI dùng bản chữ, không bỏ câu gõ)
  const addTyped = () => { if (recOn && !listening && typed.trim()) gap.current = true; add(who, typed); setTyped(''); stick.current = true }
  const toggle = () => {
    if (!listening) { segWho.current = null; brk.current = true }
    setRestored(false)
    dict.toggle()
  }

  const cancel = () => {
    if ((lines.length || hasAudio) && !window.confirm('Bỏ bản ghi này? Nội dung chưa lưu sẽ mất.')) return
    dict.abort()
    audio.discard()
    blobRef.current = null
    closed.current = true
    dropDraft(id, meName)
    onClose()
  }
  const finish = async () => {
    if (saving) return
    // câu đang nhận dạng dở lúc bấm: lấy luôn phần đang hiện rồi bỏ phiên nhận giọng (không chờ trình duyệt trả câu muộn);
    // vừa Tạm dừng mà trình duyệt chưa trả câu cuối: lấy phần đang chờ của phiên đã dừng (phiên đó không trả câu nữa)
    const tail = listening ? String(dict.interim || '').trim() : dict.takePending()
    const tw = segWho.current || who
    const sec = Math.floor(secRef.current)
    let all = lines
    if (tail) {
      const last = all[all.length - 1]
      all = last && !brk.current && last.who === tw && last.k !== editRef.current && last.t.length + 1 + tail.length <= MERGE_MAX
        ? [...all.slice(0, -1), { ...last, t: last.t + ' ' + tail, end: sec }]
        : [...all, { k: newKey(), who: tw, t: tail, at: sec, end: sec }]
    }
    if (!all.length && !hasAudio) return
    segWho.current = null
    brk.current = true
    dict.abort()
    if (all !== lines) setLines(all)
    setSaving(true)
    setSaveErr('')
    let blob = blobRef.current
    if (!blob && recOn) {
      try { blob = await audio.stop() } catch { blob = null }
      blobRef.current = blob
    }
    if (blob && blob.size > MAX_AUDIO) blob = null
    const meta = {
      kind, durationSec: sec, staffName: meName, customerName: khName,
      liveLines: all.map(x => ({ who: x.who, t: x.t, at: x.at })),
      audioComplete: !!blob && !gap.current && !audio.capped,
    }
    const upKey = KEY(id, meName)
    uploading.add(upKey)
    try {
      await createRecording(id, { audio: blob || null, meta })
    } catch (e) {
      setSaving(false)
      setSaveErr((e && e.message) || 'Không tải được bản ghi lên máy chủ, thử lại.')
      return
    } finally {
      uploading.delete(upKey)
    }
    setSaving(false)
    closed.current = true
    blobRef.current = null
    dropDraft(id, meName)
    emitLeadChange(id, 'recordings')
    emitLeadChange(id, 'activities')
    if (alive.current) onClose()      // đã rời khối lúc đang tải: không đóng khối Live mới mở lại của khách này
  }

  return (
    <section ref={rootRef} className={'cd-card cd-live' + (listening ? ' rec' : '')} aria-label="Ghi lại cuộc trò chuyện (Live)" data-cd-busy={busy ? '' : undefined}>
      <div className="cd-card-h">
        <span className="cd-live-t"><i className="cd-live-dot" aria-hidden="true" />LIVE<em>Ghi lại cuộc trò chuyện</em></span>
        <span className="cd-live-clock" title="Thời gian đã ghi">{clock(elapsed)}</span>
      </div>

      {!dict.supported && <p className="cd-live-warn">Trình duyệt này chưa hỗ trợ đổi giọng nói thành chữ (dùng Chrome hoặc Edge). Vẫn gõ tay từng câu được ở ô bên dưới.</p>}
      {dict.supported && dict.error && <p className="cd-live-warn" role="alert">{dict.error}</p>}
      {micHint && micHint[0] === 'warn' && <p className="cd-live-warn" role="status">{micHint[1]}</p>}
      {restored && <p className="cd-live-note">Đã mở lại bản ghi dở chưa lưu. Bấm Tiếp tục để ghi tiếp, hoặc Kết thúc & lưu.</p>}

      <div className="cd-live-who" role="radiogroup" aria-label="Người đang nói">
        {['nv', 'kh'].map(w => (
          <button key={w} type="button" role="radio" aria-checked={who === w} className={'cd-live-who-b ' + w + (who === w ? ' on' : '')} onClick={() => pick(w)}
            title={'Bấm khi ' + (w === 'nv' ? 'nhân viên' : 'khách') + ' bắt đầu nói'}>
            <span>{w === 'nv' ? 'Nhân viên' : 'Khách'}</span>
            <small>{(w === 'nv' ? meName : khName) || (w === 'nv' ? 'đang nói' : 'khách hàng')}</small>
          </button>
        ))}
      </div>
      <p className="cd-live-hint">{recOn
        ? 'Kết thúc xong, AI nghe lại bản ghi âm và tự tách lời Nhân viên / Khách. Bấm nút trên để gợi ý người đang nói (không bắt buộc).'
        : 'Lần này không có ghi âm, AI tách lời Nhân viên / Khách từ bản chữ: nên bấm nút trên mỗi khi đổi người nói.'}</p>
      {recOn && (
        <div className="cd-live-audio">
          <span className="cd-live-consent">Nhớ báo khách biết cuộc trò chuyện đang được ghi âm.</span>
          {audio.recording && !audio.paused
            ? <span className="cd-live-recon"><i aria-hidden="true" />Đang ghi âm{audio.bytes ? ' · ' + fmtSize(audio.bytes) : ''}</span>
            : audio.bytes > 0 && <span className="cd-live-recsz">{audio.recording ? 'Tạm dừng ghi âm' : 'Đã ghi âm'} · {fmtSize(audio.bytes)}</span>}
        </div>
      )}
      {recOn && audio.error && <p className="cd-live-warn" role="status">{audio.error} Chữ vẫn ghi bình thường, AI sẽ tách người nói từ chữ.</p>}
      {recOn && audio.notice && <p className="cd-live-note" role="status">{audio.notice}</p>}

      <CdLiveCoach leadId={id} lines={lines} elapsed={elapsed} />

      <div className="cd-live-list" ref={listRef}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!lines.length && !dict.interim && (
          <div className="cd-live-empty">{listening ? (micHint && !micHint[0] ? micHint[1] : 'Đang nghe…') + ' Nói gì sẽ hiện thành chữ ở đây.' : 'Chưa có câu nào. Bấm ' + (dict.supported ? 'Bắt đầu để ghi, hoặc ' : '') + 'gõ tay bên dưới.'}</div>
        )}
        {lines.map(x => (
          <div key={x.k} className={'cd-live-row ' + x.who}>
            <div className="cd-live-meta">
              <button type="button" className="cd-live-tag" title="Sai người nói? Bấm để đổi" onMouseDown={keep} onClick={act(() => flip(x.k))}>{label(x.who)}</button>
              <span>{clock(x.at)}</span>
              <button type="button" className="cd-live-x" aria-label="Xoá câu này" title="Xoá câu này" onMouseDown={keep} onClick={act(() => drop(x.k))}>×</button>
            </div>
            {edit && edit.k === x.k ? (
              <textarea className="cd-live-edit" autoFocus rows={3} aria-label="Sửa câu" value={edit.t} onChange={e => setEdit({ ...edit, t: e.target.value })} onBlur={saveEdit}
                onKeyDown={e => {
                  if (e.nativeEvent && e.nativeEvent.isComposing) return
                  if (enterOk(e)) { e.preventDefault(); saveEdit() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(null) }
                }} />
            ) : (
              <button type="button" className="cd-live-bub" title="Bấm để sửa" onMouseDown={keep} onClick={act(() => setEdit({ k: x.k, t: x.t }))}>{x.t}</button>
            )}
          </div>
        ))}
        {listening && dict.interim && (
          <div className={'cd-live-row interim ' + (segWho.current || who)}>
            <div className="cd-live-meta"><span className="cd-live-tag">{label(segWho.current || who)}</span><span>đang nghe…</span></div>
            <div className="cd-live-bub">{dict.interim}</div>
          </div>
        )}
      </div>

      <div className="cd-live-type">
        <input value={typed} placeholder={'Gõ thêm câu của ' + (who === 'nv' ? 'nhân viên' : 'khách') + '…'} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (enterOk(e)) { e.preventDefault(); addTyped() } }} aria-label="Gõ thêm câu" />
        <button type="button" className="cd-cbtn" disabled={!typed.trim()} onClick={addTyped}>Thêm</button>
      </div>

      <div className="cd-live-ctl">
        <button type="button" className={'cd-live-mic' + (listening ? ' on' : '')} disabled={!dict.supported || saving} onClick={toggle}>
          <IcMic />{listening ? 'Tạm dừng' : lines.length || acc ? 'Tiếp tục' : 'Bắt đầu'}
        </button>
        <label className="cd-live-kind">Lưu là
          <select value={kind} onChange={e => setKind(e.target.value)} disabled={saving}>
            <option value="meeting">Gặp mặt</option>
            <option value="call">Gọi điện</option>
          </select>
        </label>
      </div>
      {saveErr && <p className="cd-live-warn" role="alert">Chưa lưu được: {saveErr.replace(/[.\s]+$/, '')}. Bản ghi vẫn còn, bấm Kết thúc & lưu để thử lại.</p>}
      <div className="cd-live-foot">
        <button type="button" className="cd-cbtn" disabled={saving} onClick={cancel}>Huỷ</button>
        <button type="button" className="cd-live-save" disabled={(!lines.length && !(listening && dict.interim) && !hasAudio) || saving} onClick={finish}
          title={!lines.length && !hasAudio ? 'Chưa có câu nào để lưu'
            : recOn ? 'Lưu vào Cập nhật chăm sóc, AI nghe lại và tách lời Nhân viên / Khách'
              : 'Lưu vào Cập nhật chăm sóc, AI tách lời Nhân viên / Khách từ bản chữ'}>
          {saving ? 'Đang tải bản ghi…' : 'Kết thúc & lưu'}
        </button>
      </div>
    </section>
  )
}
