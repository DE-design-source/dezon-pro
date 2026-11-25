import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getScore, saveScore, emitLeadChange, useLeadChange } from '../../customerApi'
import { isSystemEntry } from './CdCare'
import './score.css'
import './scoreai2.css'

/* Khối "Chỉ số chính": điểm deal, điểm tiêu chí, liên hệ gần nhất, so với tuần trước + 6 tiêu chí × 4 câu.
   Bấm câu -> đổi ngay trên giao diện (tính lại cùng công thức với máy chủ), lưu sau ~400ms; lỗi thì trả lại như cũ. */
const SAVE_DELAY = 400

const pad = n => String(n).padStart(2, '0')
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const fmtDay = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

/* Cùng công thức với máy chủ: điểm tiêu chí = round(số câu có / số câu × 100); thiếu câu bắt buộc = điểm liệt, tính 0 điểm;
   điểm tiêu chí tổng = round(Σ điểm × trọng số / 100); điểm deal = tổng */
function computeScore(criteria, checks) {
  let weighted = 0, locks = 0
  const list = (criteria || []).map(c => {
    const items = c.items || []
    const on = items.map((it, i) => !!((checks && checks[c.key]) || [])[i])
    const n = items.length || 4
    const lock = items.some((it, i) => it.required && !on[i])
    const score = lock ? 0 : Math.round(on.filter(Boolean).length / n * 100)
    if (lock) locks++
    weighted += score * (Number(c.weight) || 0) / 100
    return { ...c, score, lock, status: lock ? 'lock' : score >= 75 ? 'ok' : 'watch', on }
  })
  const critScore = Math.round(weighted)
  return { list, locks, critScore, dealScore: critScore }
}

const STATUS = {
  lock: { label: 'Điểm liệt', cls: 'is-lock' },
  ok: { label: 'Đạt', cls: 'is-ok' },
  watch: { label: 'Cần theo dõi', cls: 'is-watch' },
}

const LockIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.watch
  return (
    <span className={'cd-sc-pill ' + s.cls}>
      {status === 'lock' ? <LockIcon size={9} /> : <span aria-hidden="true">{status === 'ok' ? '✓' : '◷'}</span>}
      {s.label}
    </span>
  )
}

const copyChecks = c => Object.fromEntries(Object.entries(c || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : []]))

export default function CdScore({ lead, interactions }) {
  const leadId = lead && lead.id
  const [data, setData] = useState(null)
  const [checks, setChecks] = useState({})
  const [loadErr, setLoadErr] = useState('')
  const [toast, setToast] = useState('')

  const savedRef = useRef({}) // bản đã lưu được trên máy chủ (để trả lại khi lỗi)
  const checksRef = useRef({})
  const timerRef = useRef(null)
  const verRef = useRef(0) // tăng mỗi lần bấm: phản hồi cũ không ghi đè thay đổi mới hơn
  const selfEmit = useRef(false)
  const toastTimer = useRef(null)
  const leadRef = useRef(leadId)
  leadRef.current = leadId
  const pendIdRef = useRef(null) // khách hàng của thay đổi đang chờ gửi
  const same = id => String(id) === String(leadRef.current)

  const showToast = useCallback(msg => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4000)
  }, [])

  const apply = useCallback(r => {
    const c = copyChecks(r && r.checks)
    for (const cr of (r && r.criteria) || []) if (!c[cr.key]) c[cr.key] = (cr.items || []).map(it => !!it.on)
    setData(r || null)
    setChecks(c)
    checksRef.current = c
    savedRef.current = copyChecks(c)
  }, [])

  const load = useCallback(() => {
    if (!leadId) return
    const id = leadId
    getScore(id).then(r => {
      if (!same(id) || timerRef.current) return
      setLoadErr('')
      apply(r)
    }, e => { if (same(id)) setLoadErr((e && e.message) || String(e)) })
  }, [leadId, apply])

  useEffect(() => {
    setData(null); setChecks({}); setLoadErr('')
    checksRef.current = {}; savedRef.current = {}
    load()
  }, [load])

  useLeadChange(leadId, ['score', 'lead'], () => { if (!selfEmit.current) load() })

  const flush = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    const id = pendIdRef.current
    if (id == null) return
    pendIdRef.current = null
    const sent = copyChecks(checksRef.current)
    const ver = verRef.current
    saveScore(id, sent).then(r => {
      if (!same(id)) { emitLeadChange(id, 'score'); return }
      savedRef.current = sent
      if (ver === verRef.current && r && r.criteria) apply(r)
      else if (r && r.updatedAt) setData(d => (d ? { ...d, updatedAt: r.updatedAt, updatedBy: r.updatedBy, prevWeek: 'prevWeek' in r ? r.prevWeek : d.prevWeek } : d))
      selfEmit.current = true
      try { emitLeadChange(id, 'score') } finally { selfEmit.current = false }
    }, e => {
      if (same(id) && ver === verRef.current) {
        const back = copyChecks(savedRef.current)
        checksRef.current = back
        setChecks(back)
      }
      showToast('Không lưu được chỉ số: ' + ((e && e.message) || e))
    })
  }, [showToast, apply]) // eslint-disable-line react-hooks/exhaustive-deps

  // rời trang khi còn thay đổi chưa gửi -> gửi ngay
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => { if (timerRef.current) flushRef.current() }, [leadId])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const toggle = (key, i) => {
    const cur = checksRef.current[key] || []
    const n = Math.max(cur.length, 4)
    const arr = Array.from({ length: n }, (_, j) => !!cur[j])
    arr[i] = !arr[i]
    const next = { ...checksRef.current, [key]: arr }
    checksRef.current = next
    setChecks(next)
    verRef.current++
    pendIdRef.current = leadId
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, SAVE_DELAY)
  }

  const sc = useMemo(() => computeScore(data && data.criteria, checks), [data, checks])

  const lastContact = useMemo(() => {
    let max = ''
    for (const x of interactions || []) {
      if (!x || isSystemEntry(x)) continue // log hệ thống (phân công, chuyển giai đoạn) không phải liên hệ
      const d = String(x.date || '').slice(0, 10); if (d > max) max = d
    }
    if (!max) return 'Chưa có'
    const n = Math.max(0, dayDiff(max, isoDay(new Date())))
    const [, m, d] = max.split('-')
    return d + '/' + m + ' · ' + (n === 0 ? 'hôm nay' : n + ' ngày')
  }, [interactions])

  const asOf = useMemo(() => {
    const d = data && data.updatedAt ? new Date(data.updatedAt) : null
    return fmtDay(d && !isNaN(d) ? d : new Date())
  }, [data])

  const prev = data && data.prevWeek != null && data.prevWeek !== '' ? Number(data.prevWeek) : null
  const delta = prev == null || isNaN(prev) ? null : sc.dealScore - prev
  const deltaView = delta == null ? { text: '—', cls: 'is-none' }
    : delta < 0 ? { text: '▼ ' + -delta + ' điểm', cls: 'is-down' }
      : delta > 0 ? { text: '▲ ' + delta + ' điểm', cls: 'is-up' }
        : { text: 'Không đổi', cls: 'is-none' }

  const loading = !data && !loadErr

  return (
    <section className="cd-card cd-score" aria-label="Chỉ số chính">
      <div className="cd-sc-head">
        <span className="cd-sc-title">Chỉ số chính</span>
        <div className="cd-sc-grow" />
        <span className="cd-sc-asof" title={data && data.updatedBy ? 'Cập nhật bởi ' + data.updatedBy : undefined}>Tính đến {asOf}</span>
      </div>

      {loadErr ? (
        <div className="cd-sc-err">
          <span>Không tải được chỉ số: {loadErr}</span>
          <button type="button" className="cd-sc-btn" onClick={load}>Thử lại</button>
        </div>
      ) : null}

      <div className="cd-sc-kpi">
        <div className="cd-sc-kpi-in">
          <div className="cd-sc-deal">
            <div className="cd-sc-deal-num"><b>{loading ? '--' : sc.dealScore}</b><span>/100</span></div>
            {sc.locks > 0 ? <span className="cd-sc-lock"><LockIcon />{'Còn ' + sc.locks + ' điểm liệt, không được tính điểm'}</span> : null}
          </div>
          <div className="cd-sc-stat"><span>Điểm tiêu chí</span><b>{loading ? '--' : sc.critScore}/100</b></div>
          <div className="cd-sc-stat"><span>Liên hệ gần nhất</span><b>{lastContact}</b></div>
          <div className="cd-sc-stat"><span>So với tuần trước</span><b className={'cd-sc-delta ' + deltaView.cls}>{loading ? '--' : deltaView.text}</b></div>
          <div className="cd-sc-crit">
            <span className="cd-sc-box-title">{(sc.list.length || 6) + ' tiêu chí đánh giá'}</span>
            <span className="cd-sc-hint">Bấm từng câu để đánh dấu có hoặc chưa · <span className="cd-sc-req">*</span> câu bắt buộc, chưa có thì thành điểm liệt sẽ không được tính điểm</span>
          </div>
        </div>
      </div>

      <div className="cd-sc-box">
        {loading ? (
          <div className="cd-sc-row is-skel" aria-hidden="true">
            <div className="cd-sc-name"><i className="cd-sc-skel w70" /><i className="cd-sc-skel w40" /></div>
            <div className="cd-sc-qs">{[0, 1, 2, 3].map(i => <i key={i} className="cd-sc-skel" />)}</div>
          </div>
        ) : sc.list.map(c => (
          <div key={c.key} className="cd-sc-row">
            <div className="cd-sc-name">
              <div className="cd-sc-name-l1"><span className="cd-sc-cname">{c.label}</span><span className="cd-sc-cscore">{c.score}</span></div>
              <div className="cd-sc-name-l2"><span className="cd-sc-w">Trọng số {c.weight}%</span><StatusPill status={c.status} /></div>
            </div>
            <div className="cd-sc-qs">
              {(c.items || []).map((it, i) => (
                <button key={i} type="button" role="checkbox" aria-checked={!!c.on[i]} className={'cd-sc-q' + (c.on[i] ? ' is-on' : '')} onClick={() => toggle(c.key, i)}>
                  <span className="cd-sc-box-ic" aria-hidden="true">{c.on[i] ? '✓' : ''}</span>
                  <span>{it.text}{it.required ? <span className="cd-sc-req"> *</span> : null}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {toast ? <div className="cd-sc-toast" role="alert">{toast}</div> : null}
    </section>
  )
}
