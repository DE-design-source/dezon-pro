import { useEffect, useRef, useState } from 'react'
import { listRecordings, updateRecording, reprocessRecording, deleteRecording, emitLeadChange, useLeadChange } from '../../customerApi'
import { mediaUrl } from '../../../QS/api/files'
import './recordings.css'

/* Khối "Hội thoại đã ghi" (cột phụ trang khách hàng, ngay dưới Hỏi AI / Live): các cuộc trò chuyện đã ghi bằng Live.
   Máy chủ lưu ghi âm + bản chữ trực tiếp rồi nhờ Gemini tách giọng Nhân viên / Khách ở nền (status 'processing' -> 'done' | 'failed');
   khối tự hỏi lại mỗi 4 giây khi còn bản đang xử lý, xong thì báo 'activities' để Cập nhật chăm sóc tải lại.
   Bấm nhãn người nói trên 1 câu để đổi Nhân viên <-> Khách (lưu ngay, máy chủ ghi lại cả mục chăm sóc).
   Khách chưa có hội thoại nào thì ẩn cả khối. Tải lại khi có 'recordings' (Live vừa lưu) hoặc 'activities'. */

const SHOW = 3
const POLL_MS = 4000
const KIND = { meeting: 'Gặp mặt', call: 'Gọi điện' }
const pad = n => String(n).padStart(2, '0')
const clock = s => { s = Math.max(0, Math.floor(Number(s) || 0)); return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) }
const when = iso => {
  const d = new Date(iso)
  if (!iso || isNaN(d.getTime())) return ''
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
const linesOf = r => (Array.isArray(r.lines) && r.lines.length ? r.lines : Array.isArray(r.liveLines) ? r.liveLines : [])
/* Như recStale phía máy chủ: 'processing' quá 10 phút (máy chủ khởi động lại giữa chừng...) coi như hỏng, cho Thử lại / sửa */
const REC_STALE_MS = 10 * 60 * 1000
const isStale = r => r.status === 'processing' && Date.now() - Date.parse(r.updatedAt) > REC_STALE_MS
const isBusy = r => r.status === 'processing' && !isStale(r)

export default function CdRecordings({ lead }) {
  const leadId = lead ? String(lead.id) : ''
  const [recs, setRecs] = useState([])
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState({})      // {id: true|false}: mở / thu gọn hội thoại (mặc định chỉ mở bản mới nhất)
  const [errs, setErrs] = useState({})      // {id: lỗi thao tác gần nhất}
  const [busy, setBusy] = useState({})      // {id: 'reprocess'|'delete'|'flip'}
  const seq = useRef(0)
  const prev = useRef({})                   // {id: status} lần tải trước, để biết bản nào vừa xử lý xong
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = () => {
    if (!leadId) return
    const n = ++seq.current
    const lid = leadId
    listRecordings(lid).then(list => {
      if (!alive.current || n !== seq.current) return
      const was = prev.current
      const now = {}
      let finished = false
      list.forEach(r => { now[r.id] = r.status; if (was[r.id] === 'processing' && r.status !== 'processing') finished = true })
      prev.current = now
      setRecs(list)
      if (finished) emitLeadChange(lid, 'activities')
    }, () => { /* lỗi tải: giữ danh sách đang có, lần hỏi sau thử lại */ })
  }
  useEffect(() => {
    seq.current++
    prev.current = {}
    setRecs([]); setAll(false); setOpen({}); setErrs({}); setBusy({})
    load()
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps
  useLeadChange(leadId, ['recordings', 'activities'], () => load())

  const processing = recs.some(isBusy)
  useEffect(() => {
    if (!processing) return undefined
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [processing, leadId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lead || !recs.length) return null

  const put = r => {
    if (!r || r.id == null) return
    prev.current = { ...prev.current, [r.id]: r.status }
    setRecs(ls => ls.map(x => (x.id === r.id ? r : x)))
  }
  const setErr = (id, msg) => setErrs(m => ({ ...m, [id]: msg || '' }))
  const setB = (id, v) => setBusy(m => ({ ...m, [id]: v || '' }))

  /* Mỗi bản chỉ 1 lần đổi người nói đang gửi (các lần gửi chồng nhau có thể mất 1 lần đổi);
     lỗi thì tải lại từ máy chủ thay vì trả về bản chụp cũ */
  const flip = (r, i) => {
    if (busy[r.id]) return
    const lines = linesOf(r).map((x, j) => (j === i ? { ...x, who: x.who === 'kh' ? 'nv' : 'kh' } : x))
    setErr(r.id, ''); setB(r.id, 'flip')
    setRecs(ls => ls.map(x => (x.id === r.id ? { ...x, lines } : x)))
    seq.current++ // bỏ kết quả hỏi lại đang dở (có thể còn bản cũ)
    updateRecording(r.id, { lines }).then(saved => {
      if (!alive.current) return
      put(saved)
      emitLeadChange(leadId, 'activities')
    }, e => {
      if (!alive.current) return
      setErr(r.id, 'Không đổi được người nói: ' + ((e && e.message) || 'lỗi'))
      load()
    }).finally(() => { if (alive.current) setB(r.id, '') })
  }
  const redo = r => {
    if (busy[r.id]) return
    setB(r.id, 'reprocess'); setErr(r.id, '')
    reprocessRecording(r.id).then(saved => { if (alive.current) put(saved) }, e => {
      if (alive.current) setErr(r.id, 'Không phân tích lại được: ' + ((e && e.message) || 'lỗi'))
    }).finally(() => { if (alive.current) setB(r.id, '') })
  }
  const remove = r => {
    if (busy[r.id]) return
    if (!window.confirm('Xoá hội thoại đã ghi này? File ghi âm sẽ bị xoá; mục trong Cập nhật chăm sóc vẫn được giữ.')) return
    setB(r.id, 'delete'); setErr(r.id, '')
    deleteRecording(r.id).then(() => {
      if (!alive.current) return
      seq.current++
      setRecs(ls => ls.filter(x => x.id !== r.id))
    }, e => {
      if (alive.current) setErr(r.id, 'Không xoá được: ' + ((e && e.message) || 'lỗi'))
    }).finally(() => { if (alive.current) setB(r.id, '') })
  }

  const shown = all ? recs : recs.slice(0, SHOW)
  const more = recs.length - SHOW
  return (
    <section className="cd-card cd-rec" aria-label="Hội thoại đã ghi">
      <div className="cd-card-h">
        <span className="cd-card-t">Hội thoại đã ghi <span className="cd-rec-n">{recs.length}</span></span>
      </div>
      <div className="cd-rec-items">
        {shown.map((r, idx) => {
          const isOpen = Object.prototype.hasOwnProperty.call(open, r.id) ? open[r.id] : idx === 0
          const lines = linesOf(r)
          const proc = isBusy(r)
          const stale = isStale(r)
          const b = busy[r.id]
          const staff = String(r.staffName || '').trim()
          const cust = String(r.customerName || '').trim()
          const label = w => (w === 'kh' ? 'Khách' + (cust ? ' · ' + cust : '') : 'Nhân viên' + (staff ? ' · ' + staff : ''))
          const dur = Number(r.durationSec) || 0
          return (
            <article key={r.id} className={'cd-rec-item' + (isOpen ? ' open' : '')}>
              <button type="button" className="cd-rec-top" aria-expanded={isOpen} onClick={() => setOpen(m => ({ ...m, [r.id]: !isOpen }))}>
                <span className="cd-rec-when">{when(r.createdAt)}</span>
                <span className="cd-rec-kind">{KIND[r.kind] || 'Trò chuyện'}</span>
                {dur > 0 && <span className="cd-rec-dur">{clock(dur)}</span>}
                <span className="cd-rec-caret" aria-hidden="true" />
              </button>

              {proc ? (
                <span className="cd-rec-st proc" role="status"><i className="cd-rec-spin" aria-hidden="true" />AI đang tách giọng Nhân viên / Khách…</span>
              ) : r.status === 'failed' || stale ? (
                <span className="cd-rec-st fail">
                  <span>Chưa tách được giọng{r.error ? ': ' + r.error : stale ? ': Xử lý quá lâu (máy chủ có thể đã khởi động lại)' : ''}</span>
                  <button type="button" className="cd-link-btn acc" disabled={!!b} onClick={() => redo(r)}>{b === 'reprocess' ? 'Đang gửi…' : 'Thử lại'}</button>
                </span>
              ) : r.engine === 'gemini' ? (
                <span className="cd-rec-st ok" title={r.model ? 'Mô hình: ' + r.model : undefined}>AI đã tách giọng</span>
              ) : (
                <span className="cd-rec-st live">Theo bản ghi trực tiếp</span>
              )}

              {r.summary && <p className="cd-rec-sum">{r.summary}</p>}

              {isOpen && (
                <>
                  {r.audioUrl && <audio className="cd-rec-audio" controls preload="none" src={mediaUrl(r.audioUrl)} />}
                  {lines.length ? (
                    <div className="cd-rec-list">
                      {lines.map((x, i) => {
                        const w = x.who === 'kh' ? 'kh' : 'nv'
                        return (
                          <div key={i} className={'cd-rec-row ' + w}>
                            <div className="cd-rec-meta">
                              <button type="button" className="cd-rec-tag" disabled={proc || !!b}
                                title={proc ? 'Đợi AI xử lý xong rồi sửa' : b === 'flip' ? 'Đang lưu lần đổi trước…' : 'Sai người nói? Bấm để đổi'} onClick={() => flip(r, i)}>{label(w)}</button>
                              <span>[{clock(x.at)}]</span>
                            </div>
                            <div className="cd-rec-bub">{x.t}</div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="cd-none">{proc ? 'Bản chữ sẽ hiện khi AI xử lý xong.' : 'Chưa có câu nào.'}</p>
                  )}
                  <div className="cd-rec-act">
                    <button type="button" className="cd-btn sm" disabled={proc || !!b} onClick={() => redo(r)}>{b === 'reprocess' ? 'Đang gửi…' : 'Phân tích lại'}</button>
                    <button type="button" className="cd-btn sm cd-rec-del" disabled={!!b} onClick={() => remove(r)}>{b === 'delete' ? 'Đang xoá…' : 'Xoá'}</button>
                  </div>
                </>
              )}
              {errs[r.id] && <p className="cd-rec-err" role="alert">{errs[r.id]}</p>}
            </article>
          )
        })}
      </div>
      {more > 0 && (
        <button type="button" className="cd-link-btn acc cd-rec-more" onClick={() => setAll(v => !v)}>{all ? 'Thu gọn' : 'Xem thêm (+' + more + ')'}</button>
      )}
    </section>
  )
}
