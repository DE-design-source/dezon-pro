import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_CONTENT, runeLength } from '../state/chatLogic'
import { checkFile, formatBytes, kindOf, voiceSupported } from '../state/chatMedia'
import { FileIcon, colorFor, errText, initials } from './shared'
import { finalizeMentions, mentionCandidates, mentionQuery, shiftMentions } from './mentionUtil'
import './Mention.css'
import './MessageActions.css'
import ReplyPreview from './ReplyPreview'
import VoiceRecorder from './VoiceRecorder'

const MAX_FILES = 20

/* Kiểm tra sớm theo cấu hình máy chủ (máy chủ vẫn kiểm lại). Ảnh được nén trước khi gửi nên không chặn theo cỡ gốc. */
function precheck(file, kind, cfg) {
  if (kind === 'image') return file.size > 0 ? '' : 'Tệp rỗng'
  return checkFile(file, kind, cfg)
}

let seq = 0

/* Khung soạn tin — Enter gửi, Shift+Enter xuống dòng, tối đa 4.000 ký tự.
   Nội dung đang soạn giữ theo từng hội thoại (initialText / onDraft); onTyping báo "đang soạn tin".
   Có onSendFiles + mediaCfg.enabled: nút đính kèm (chọn / dán / kéo thả qua incomingFiles), "Gửi ảnh gốc";
   ô trống thì nút micro thay nút gửi (onSendVoice).
   Có mentionMembers (nhóm; thành viên đang hoạt động trừ mình): gõ '@' mở gợi ý tên (lên / xuống / Enter / Tab / Esc, chuột),
   canMentionAll thêm dòng @Tất cả; onSend(text đã trim, mentions?) nhận vị trí UTF-16 tính trên chuỗi đã trim.
   reply (ReplyPreviewDTO) + onCancelReply: thanh "Đang trả lời" trên ô nhập (Esc huỷ); tin gửi kèm reply do chatStore tự gắn.
   editing (Message) + onSubmitEdit(text, mentions) -> Promise + onCancelEdit: chế độ "Chỉnh sửa tin nhắn" - ô nhập lấy nội dung tin,
   Enter lưu, Esc huỷ; bản nháp đang gõ được cất lại và trả về khi thoát chế độ sửa. */
function mentionsOfMessage(m) {
  const content = String((m && m.content) || '')
  return ((m && m.mentions) || []).map(x => ({ user_id: x.user_id, offset: x.offset, length: x.length, name: content.slice(x.offset + 1, x.offset + x.length) }))
}

const sameMentions = (a, b) => a.length === b.length && a.every((x, i) => x.user_id === b[i].user_id && x.offset === b[i].offset && x.length === b[i].length)

export default function Composer({ initialText = '', onSend, onDraft, onTyping, onBlur, disabled, placeholder, onSendFiles, onSendVoice, mediaCfg, incomingFiles, mentionMembers, canMentionAll, reply, onCancelReply, editing, onSubmitEdit, onCancelEdit }) {
  const [text, setText] = useState(initialText)
  /* Đoạn @nhắc tên đã chèn: {user_id, offset, length, name} theo vị trí trong chuỗi chưa trim */
  const [mentions, setMentions] = useState([])
  const [caret, setCaret] = useState(null)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(null)
  const caretAfter = useRef(null)
  const [files, setFiles] = useState([])
  const [original, setOriginal] = useState(false)
  const [recording, setRecording] = useState(false)
  const [note, setNote] = useState('')
  const taRef = useRef(null)
  const inputRef = useRef(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const [saving, setSaving] = useState(false)
  /* Bản nháp cất lại khi vào chế độ sửa */
  const saved = useRef(null)
  const editId = editing ? editing.id : null
  const replyId = reply ? reply.message_id : null

  const mediaOn = !!(onSendFiles && mediaCfg && mediaCfg.enabled)
  /* Trang mở bằng http qua IP LAN: không có crypto.subtle -> không gửi được tệp */
  const insecure = !!onSendFiles && !mediaOn && !!(mediaCfg && mediaCfg.insecure)
  const canVoice = mediaOn && !!onSendVoice && voiceSupported() && mediaCfg.voice !== false

  /* Ô nhập tự giãn theo nội dung, tối đa 120px */
  function fit(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  useEffect(() => { fit(taRef.current) }, [])

  /* Vào / đổi / thoát chế độ sửa: nạp nội dung tin (kèm @nhắc tên) hoặc trả lại bản nháp đã cất */
  useEffect(() => {
    if (editId != null) {
      if (!saved.current) saved.current = { text, mentions }
      const v = String(editing.content || '')
      setText(v)
      setMentions(mentionsOfMessage(editing))
      caretAfter.current = v.length
    } else if (saved.current) {
      const d = saved.current
      saved.current = null
      setText(d.text)
      setMentions(d.mentions)
      caretAfter.current = d.text.length
    }
    setDismissed(null)
    setNote('')
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  /* Chọn "Trả lời" -> đưa con trỏ vào ô nhập */
  useEffect(() => {
    if (replyId != null && taRef.current) taRef.current.focus()
  }, [replyId])

  /* Thu hồi URL xem trước khi rời khung soạn */
  useEffect(() => () => { for (const f of filesRef.current) if (f.url) URL.revokeObjectURL(f.url) }, [])

  function addFiles(list) {
    if (!mediaOn) return
    const arr = Array.from(list || [])
    if (!arr.length) return
    const room = MAX_FILES - filesRef.current.length
    setNote(arr.length > room ? 'Mỗi lần gửi tối đa ' + MAX_FILES + ' tệp' : '')
    const add = arr.slice(0, Math.max(0, room)).map(file => {
      const kind = kindOf(file, mediaCfg) || 'file'
      return { id: ++seq, file, kind, err: precheck(file, kind, mediaCfg), url: kind === 'image' ? URL.createObjectURL(file) : '' }
    })
    filesRef.current = filesRef.current.concat(add)
    setFiles(filesRef.current)
  }

  /* Tệp kéo thả vào khung thread (Thread.jsx đổi object mỗi lần thả) */
  useEffect(() => {
    if (incomingFiles && incomingFiles.files) addFiles(incomingFiles.files)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles])

  function removeFile(id) {
    setFiles(cur => cur.filter(f => {
      if (f.id !== id) return true
      if (f.url) URL.revokeObjectURL(f.url)
      return false
    }))
  }

  function clearFiles() {
    for (const f of files) if (f.url) URL.revokeObjectURL(f.url)
    setFiles([])
    setOriginal(false)
  }

  const mentionOn = !!mentionMembers
  const trig = mentionOn && !disabled && (!files.length || editing) ? mentionQuery(text, caret, mentions) : null
  const cands = trig && trig.start !== dismissed ? mentionCandidates(mentionMembers, trig.query, !!canMentionAll) : []
  const popOpen = cands.length > 0
  const activeIdx = Math.min(active, Math.max(0, cands.length - 1))

  /* Đặt lại con trỏ sau khi chèn tên */
  useLayoutEffect(() => {
    const pos = caretAfter.current
    const el = taRef.current
    if (pos == null || !el) return
    caretAfter.current = null
    el.focus()
    el.setSelectionRange(pos, pos)
    fit(el)
  })

  function change(v, pos) {
    if (mentions.length) setMentions(shiftMentions(mentions, text, v))
    if (dismissed != null && v[dismissed] !== '@') setDismissed(null)
    if (pos !== undefined) setCaret(pos)
    setActive(0)
    setText(v)
    if (editing) return
    if (onDraft) onDraft(v)
    if (onTyping) onTyping(v)
  }

  function pickMention(c) {
    if (!trig) return
    const ins = '@' + c.display_name + ' '
    const next = text.slice(0, trig.start) + ins + text.slice(caret)
    const kept = shiftMentions(mentions, text, next)
    const pos = trig.start + ins.length
    caretAfter.current = pos
    setMentions(kept.concat({ user_id: c.user_id, offset: trig.start, length: ins.length - 1, name: c.display_name }))
    setCaret(pos)
    setActive(0)
    setText(next)
    if (editing) return
    if (onDraft) onDraft(next)
    if (onTyping) onTyping(next)
  }

  function onKey(e) {
    if (popOpen && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = cands.length
        setActive((activeIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pickMention(cands[activeIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(trig.start); return }
    }
    if (e.key === 'Escape' && editing && onCancelEdit) { e.preventDefault(); e.stopPropagation(); onCancelEdit(); return }
    if (e.key === 'Escape' && reply && onCancelReply) { e.preventDefault(); e.stopPropagation(); onCancelReply(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  /* Lưu tin đang sửa: nội dung + @nhắc tên không đổi -> chỉ thoát chế độ sửa */
  function saveEdit() {
    if (saving) return
    const t = text.trim()
    if (!t) { setNote('Nội dung tin nhắn không được để trống'); return }
    if (runeLength(t) > MAX_CONTENT) return
    const ms = mentionOn ? finalizeMentions(text, mentions) : []
    if (t === String(editing.content || '') && sameMentions(ms, editing.mentions || [])) { if (onCancelEdit) onCancelEdit(); return }
    setSaving(true)
    setNote('')
    Promise.resolve(onSubmitEdit(t, ms)).catch(e => { setNote(errText(e)); setSaving(false) })
  }

  function resetText() {
    setText('')
    setMentions([])
    setDismissed(null)
    if (onDraft) onDraft('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const valid = files.filter(f => !f.err)

  function send() {
    if (disabled) return
    if (editing) { saveEdit(); return }
    const t = text.trim()
    if (runeLength(t) > MAX_CONTENT) return
    if (files.length) {
      if (!valid.length) return
      const r = onSendFiles(valid.map(f => f.file), { caption: t, original })
      const errs = (r && r.errors) || []
      /* không tệp nào vào hàng chờ (tắt tệp, chú thích quá dài, mọi tệp bị từ chối): giữ nguyên tệp + chú thích, báo lý do */
      if (!r || r.ok === false) { setNote(errs.join('; ') || 'Không gửi được tệp'); return }
      setNote(errs.length ? 'Không gửi: ' + errs.join('; ') : '')
      clearFiles()
      resetText()
      return
    }
    if (!t) return
    const ms = mentionOn ? finalizeMentions(text, mentions) : []
    if ((ms.length ? onSend(t, ms) : onSend(t)) === false) return
    resetText()
  }

  function onPaste(e) {
    if (!mediaOn || editing) return
    const list = Array.from((e.clipboardData && e.clipboardData.files) || [])
    if (!list.length) return
    e.preventDefault()
    addFiles(list)
  }

  const len = runeLength(text)
  const over = len > MAX_CONTENT
  const hasImage = files.some(f => f.kind === 'image' && !f.err)
  const showMic = canVoice && !editing && !text.trim() && !files.length

  if (recording) {
    return (
      <div className="ch-composer">
        <VoiceRecorder
          maxMs={mediaCfg && mediaCfg.max_voice_ms}
          onCancel={reason => { setRecording(false); setNote(reason || '') }}
          onSend={(blob, meta) => {
            setRecording(false)
            const r = onSendVoice(blob, meta)
            if (!r || r.ok === false) setNote(((r && r.errors) || []).join('; ') || 'Không gửi được tin thoại')
          }}
        />
      </div>
    )
  }

  return (
    <div className={'ch-composer' + (editing ? ' editing' : '')}>
      {editing ? (
        <div className="ch-reply-bar ch-edit-bar">
          <span className="ch-reply-bar-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </span>
          <div className="ch-reply-bar-main">
            <span className="ch-reply-bar-title"><b>Chỉnh sửa tin nhắn</b></span>
            <span className="ch-reply-bar-text">{String(editing.content || '').replace(/\s+/g, ' ')}</span>
          </div>
          <button type="button" className="ch-reply-bar-x" title="Huỷ chỉnh sửa (Esc)" aria-label="Huỷ chỉnh sửa" disabled={saving} onClick={onCancelEdit}>×</button>
        </div>
      ) : reply && onCancelReply ? <ReplyPreview reply={reply} onCancel={onCancelReply} /> : null}
      {files.length > 0 && !editing && (
        <div className="ch-attach-preview show">
          {files.map(f => (
            <div key={f.id} className={'ch-attach-preview-item' + (f.err ? ' bad' : '')} title={f.err || f.file.name}>
              {f.url ? <img src={f.url} alt="" /> : <span className="ch-ap-icon"><FileIcon size={15} /></span>}
              <span className="ch-ap-text">
                <span className="ch-ap-name">{f.file.name || 'Ảnh dán'}</span>
                <span className="ch-ap-size">{f.err || formatBytes(f.file.size)}</span>
              </span>
              <button type="button" className="ch-ap-remove" title="Bỏ tệp này" onClick={() => removeFile(f.id)}>×</button>
            </div>
          ))}
          {hasImage && (
            <label className="ch-ap-original" title="Không nén ảnh trước khi gửi">
              <input type="checkbox" checked={original} onChange={e => setOriginal(e.target.checked)} /> Gửi ảnh gốc
            </label>
          )}
        </div>
      )}
      {note && <div className="ch-composer-note">{note}</div>}
      {popOpen && (
        <div className="ch-mention-pop" role="listbox" aria-label="Nhắc tên thành viên">
          {cands.map((c, i) => (
            <button
              key={c.all ? 'all' : c.user_id}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              className={'ch-mention-opt' + (i === activeIdx ? ' active' : '')}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pickMention(c)}
            >
              <span className="ch-mo-av" style={{ background: c.all ? 'var(--primary)' : colorFor(c.user_id) }}>{c.all ? '@' : initials(c.display_name)}</span>
              <span className="ch-mo-name">{c.display_name}</span>
              {c.all && <span className="ch-mo-sub">Nhắc cả nhóm</span>}
            </button>
          ))}
        </div>
      )}
      <div className="ch-composer-row">
        {mediaOn && !editing && (
          <>
            <button type="button" className="ch-attach-btn" title="Đính kèm ảnh, video, tệp" disabled={disabled} onClick={() => inputRef.current && inputRef.current.click()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
            </button>
            <input ref={inputRef} type="file" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          </>
        )}
        {insecure && (
          <button type="button" className="ch-attach-btn" title="Cần HTTPS để gửi tệp" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
          </button>
        )}
        <textarea
          ref={taRef}
          rows={1}
          placeholder={editing ? 'Sửa tin nhắn... (Enter để lưu, Esc để huỷ)' : files.length ? 'Thêm chú thích...' : placeholder || 'Nhập tin nhắn... (Enter để gửi)'}
          title="Enter để gửi, Shift+Enter để xuống dòng"
          value={text}
          disabled={disabled}
          onChange={e => { change(e.target.value, e.target.selectionStart); fit(e.target) }}
          onSelect={e => setCaret(e.target.selectionStart === e.target.selectionEnd ? e.target.selectionStart : null)}
          onBlur={() => { setCaret(null); if (onBlur) onBlur() }}
          onPaste={onPaste}
          onKeyDown={onKey}
        />
        {showMic ? (
          <button className="ch-send-btn" title="Ghi tin nhắn thoại" disabled={disabled} onClick={() => { setNote(''); setRecording(true) }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></svg>
          </button>
        ) : (
          <button className="ch-send-btn" title={editing ? 'Lưu' : 'Gửi'} disabled={disabled || over || saving || (editing ? !text.trim() : !text.trim() && !valid.length)} onClick={send}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        )}
      </div>
      {len > MAX_CONTENT - 500 && (
        <div className={'ch-composer-count' + (over ? ' over' : '')}>{len.toLocaleString('vi-VN')} / {MAX_CONTENT.toLocaleString('vi-VN')} ký tự{over ? ' — quá dài, hãy rút gọn' : ''}</div>
      )}
    </div>
  )
}
