import { useEffect, useState, useSyncExternalStore } from 'react'
import Icon from '../../../../components/ui/Icon'
import { MrootPortal } from '../common/Mroot'
import { useQsStore, isAdminRole_, toast, getState, setState, subscribe as subscribeStore } from '../../state/store'
import { useQsCan } from '../../state/qsAccess'
import { resetStats } from './projectStats'
import { safeUrl_ } from '../../lib/format.js'
import * as api from '../../api/qsApi'
import './dezonImport.css'

/* Nút "Nhập từ Dezon.vn" (chỉ admin / super có quyền QS > Dự án > Thêm) + hộp nhập toàn bộ dự án của dezon.vn vào Danh sách dự án.
   Job chạy trên server (POST /projects/import-dezonvn), hộp hỏi trạng thái 2 giây / lần (GET cùng đường dẫn).
   Đóng hộp không dừng job: bộ hỏi trạng thái nằm ngoài component, vẫn chạy tới khi job xong rồi nạp lại danh sách dự án. */

const POLL_MS = 2000, POLL_MAX = 30000
const n_ = v => Number(v) || 0
/* Trạng thái job theo phiên + công ty (S.key = token|xem như): đổi công ty / đăng xuất -> gen tăng, bỏ mọi kết quả đang chờ.
   run = lượt đang theo dõi {startedAt, dryRun}: chỉ coi là xong khi chính lượt đó báo xong (cùng startedAt + có finishedAt). */
const job = { st: null, timer: 0, fails: 0, gen: 0, run: null, subs: new Set() }
const emit = () => job.subs.forEach(f => f())
// chỉ nạp lại danh sách dự án (giữ cur nếu còn), không đụng dòng bóc tách / tab đang mở
function refreshAfterImport() {
  const g = job.gen
  api.getProjects().then(ps => {
    if (!Array.isArray(ps) || g !== job.gen) return
    setState(s => ({ projects: ps, cur: s.cur ? (ps.find(p => p.maDA === s.cur.maDA) || s.cur) : s.cur }))
    // dự án đã có được bổ sung ảnh: bỏ số đã đếm (ảnh bìa trong statCache) của các dự án có link Dezon để thẻ đọc lại
    resetStats(ps.filter(p => p.linkDezon).map(p => p.maDA))
  }).catch(() => { /* danh sách giữ như cũ */ })
  toast('Đã nhập xong dự án từ Dezon.vn')
}
const setJob = st => {
  job.st = st || null
  const run = !!(st && st.running)
  const w = job.run
  if (w && run && !w.startedAt) w.startedAt = st.startedAt || ''
  if (w && !(run && st.startedAt === w.startedAt)) {
    job.run = null
    const same = !!(st && st.startedAt === w.startedAt && st.finishedAt)
    const replaced = run && !!st.startedAt && !!w.startedAt   // lượt khác đã chạy sau lượt đang theo dõi -> lượt đó đã xong
    if ((same && !st.dryRun) || (replaced && !w.dryRun)) refreshAfterImport()
  }
  if (run && !job.run) job.run = { startedAt: st.startedAt || '', dryRun: !!st.dryRun }
  emit()
}
const authErr = e => !!(e && (e.forbidden || e.status === 401 || e.name === 'QsAuthError'))
function poll(ms = POLL_MS) {
  clearTimeout(job.timer)
  const g = job.gen
  job.timer = setTimeout(async () => {
    try {
      const st = await api.getImportDezonvn()
      if (g !== job.gen) return
      job.fails = 0; setJob(st)
    } catch (e) {
      if (g !== job.gen || authErr(e)) return
      job.fails++
    }
    if (job.st && job.st.running) poll(job.fails ? Math.min(POLL_MAX, POLL_MS * 2 ** job.fails) : POLL_MS)
  }, ms)
}
async function loadJob() {
  const g = job.gen
  const st = await api.getImportDezonvn()
  if (g !== job.gen) return job.st
  setJob(st)
  if (st && st.running) poll()
  return st
}
async function startJob(opts) {
  const g = job.gen
  let st
  try { st = await api.importDezonvn(opts) } catch (e) {
    // đã có lượt đang chạy (admin khác / tab khác): đọc trạng thái lượt đó và theo dõi tiếp
    if (e && e.status === 409 && g === job.gen) loadJob().catch(() => { /* bỏ qua */ })
    throw e
  }
  if (g !== job.gen) return
  job.run = null
  setJob(st && typeof st === 'object' ? { running: true, ...st } : { running: true })
  poll()
}
let jobKey = getState().key
subscribeStore(() => {
  const k = getState().key
  if (k === jobKey) return
  jobKey = k
  const had = !!job.st
  clearTimeout(job.timer)
  job.gen++
  job.st = null; job.run = null; job.fails = 0
  emit()
  if (k && had && isAdminRole_(getState().me)) loadJob().catch(() => { /* mở hộp sẽ đọc lại */ })
})
const subscribe = f => { job.subs.add(f); return () => job.subs.delete(f) }
const useJob = () => useSyncExternalStore(subscribe, () => job.st, () => job.st)

const fmtTime = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('vi-VN') }
const curText = c => (!c ? '' : typeof c === 'string' ? c : String(c.title || c.ten || c.link || ''))
const errRow = e => (typeof e === 'string' ? { title: e } : { title: e.title || e.ten || '', link: e.link || e.url || '', error: e.error || e.loi || '' })

export function DezonImportModal({ onClose }) {
  const st = useJob()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [limit, setLimit] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    loadJob().catch(e => { if (alive) setErr('Lỗi đọc trạng thái nhập: ' + e.message) }).finally(() => { if (alive) setLoading(false) })
    const key = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => { alive = false; document.removeEventListener('keydown', key) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const running = !!(st && st.running)
  async function start() {
    const lim = Math.floor(Number(String(limit).trim()) || 0)
    setErr(''); setBusy(true)
    try { await startJob({ ...(lim > 0 ? { limit: lim } : {}), dryRun: !!dryRun }) } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  const total = n_(st && st.total), done = n_(st && st.done)
  const pct = total ? Math.min(100, Math.round(done * 100 / total)) : 0
  const errors = ((st && st.errors) || []).map(errRow)
  const stats = st ? [
    ['Tạo mới', n_(st.created), 'ok'],
    ['Bổ sung', n_(st.updated), 'ok'],
    ['Bỏ qua', n_(st.skipped), ''],
    ['Lỗi', n_(st.failed != null ? st.failed : errors.length), errors.length ? 'bad' : ''],
    ['Ảnh', n_(st.images), ''],
  ] : []
  const hasRun = !!(st && (running || total || st.startedAt || st.finishedAt))

  return (
    <MrootPortal>
      <div className="qs-dzi-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qs-dzi" role="dialog" aria-modal="true" aria-label="Nhập dự án từ Dezon.vn">
          <div className="qs-dzi-head">
            <h3><Icon name="download" size={16} /> Nhập dự án từ Dezon.vn</h3>
            <button type="button" className="qs-dzi-x" title="Đóng (job vẫn chạy tiếp)" onClick={onClose}><Icon name="x" size={15} /></button>
          </div>
          <div className="qs-dzi-note">
            <p>Nhập <b>toàn bộ dự án</b> đang đăng trên dezon.vn vào Danh sách dự án của công ty: tên, phân khúc, khu vực, diện tích, kiến trúc sư,
              nhà thầu, studio, năm hoàn thiện, giới thiệu và link bài Dezon.</p>
            <p>Mỗi dự án lưu <b>ảnh bìa + 6 ảnh đầu</b> (đã nén) trên máy chủ, các ảnh còn lại giữ dạng link tới dezon.vn.</p>
            <p>Dự án đã có cùng link Dezon chỉ được <b>bổ sung ô còn trống</b>, không ghi đè dữ liệu đã nhập. Có thể chạy lại nhiều lần, không tạo trùng.</p>
          </div>

          {!running && (
            <div className="qs-dzi-form">
              <label>Chỉ thử N dự án đầu
                <input type="number" min="1" step="1" placeholder="Tất cả" value={limit} onChange={e => setLimit(e.target.value)} disabled={busy} />
              </label>
              <label className="ck"><input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} disabled={busy} /> Chạy thử (không ghi)</label>
              <button type="button" className="qs-dzi-btn pri" disabled={busy || loading} onClick={start}>
                <Icon name="download" size={15} />{busy ? 'Đang bắt đầu…' : 'Bắt đầu nhập'}
              </button>
            </div>
          )}

          {err && <div className="qs-dzi-err">{err}</div>}
          {loading && !st && <div className="qs-dzi-muted">Đang đọc trạng thái…</div>}

          {hasRun && (
            <div className="qs-dzi-run">
              <div className="qs-dzi-sum">
                <b>{running ? 'Đang nhập' : 'Lần chạy gần nhất'}{st.dryRun ? ' (chạy thử, không ghi)' : ''}</b>
                <span>{done}{total ? ' / ' + total : ''} dự án{total ? ' · ' + pct + '%' : ''}</span>
              </div>
              <div className={'qs-dzi-bar' + (running ? ' on' : '')}><i style={{ width: (running && !total ? 100 : pct) + '%' }} /></div>
              <div className="qs-dzi-stats">
                {stats.map(s => <div key={s[0]} className={'qs-dzi-stat ' + s[2]}><b>{s[1]}</b><span>{s[0]}</span></div>)}
              </div>
              {running && curText(st.current) && <div className="qs-dzi-cur">Đang xử lý: <b>{curText(st.current)}</b></div>}
              {(st.startedAt || st.finishedAt) && (
                <div className="qs-dzi-muted">
                  {st.startedAt ? 'Bắt đầu ' + fmtTime(st.startedAt) : ''}{st.finishedAt && !running ? ' · Xong ' + fmtTime(st.finishedAt) : ''}
                </div>
              )}
              {!running && st.error && <div className="qs-dzi-err">{String(st.error)}</div>}
              {errors.length > 0 && (
                <div className="qs-dzi-errs">
                  <div className="lb">Dự án lỗi ({errors.length})</div>
                  <ul>
                    {errors.map((e, i) => (
                      <li key={i}>
                        <b>{e.title || '(không tên)'}</b>
                        {e.link && <a href={safeUrl_(e.link)} target="_blank" rel="noopener noreferrer">{e.link}</a>}
                        {e.error && <span>{e.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="qs-dzi-foot">
            {running && <span className="qs-dzi-muted">Đóng hộp này không dừng việc nhập; mở lại để xem tiến độ.</span>}
            <button type="button" className="qs-dzi-btn" onClick={onClose}>Đóng</button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}

/* Nút đặt cạnh "Nhập dự án" ở trang Danh sách dự án; chỉ admin / super có quyền QS > Dự án > Thêm (N21, như tạo dự án) mới thấy */
export default function DezonImportButton() {
  const me = useQsStore(s => s.me)
  const canCreate = useQsCan()('duan', 'create')
  const [open, setOpen] = useState(false)
  const st = useJob()
  if (!isAdminRole_(me) || !canCreate) return null
  return (
    <>
      <button type="button" className="qs-pg-new qs-dzi-open" title="Nhập toàn bộ dự án đăng trên dezon.vn vào danh sách" onClick={() => setOpen(true)}>
        <Icon name="download" size={15} stroke={2.6} />Nhập từ Dezon.vn{st && st.running ? <small>{n_(st.done)}/{n_(st.total) || '…'}</small> : null}
      </button>
      {open && <DezonImportModal onClose={() => setOpen(false)} />}
    </>
  )
}
