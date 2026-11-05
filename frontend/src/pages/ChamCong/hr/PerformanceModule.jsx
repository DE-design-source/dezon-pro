import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { deptOf } from '../../../data/hrData'
import { PERIODS, REVIEW_PERIOD, REVIEW_SKILLS, REVIEW_STATES, COURSES, LEARNING_PATHS } from '../../../data/hrData2'
import { Avatar, Pill, Seg, Modal, Field, Empty } from './shared'
import { useAccess, NoAccess } from './access'

/* Tiến độ 1 KR (0–1); KR "ngược" (càng thấp càng tốt) đạt 100% khi current ≤ target */
export function krProgress(kr) {
  if (kr.inverse) return kr.current <= kr.target ? 1 : Math.max(0, 1 - (kr.current - kr.target) / Math.max(kr.target, 1))
  return kr.target ? Math.min(1, kr.current / kr.target) : 0
}
const okrProgress = o => (o.krs.length ? o.krs.reduce((s, k) => s + krProgress(k), 0) / o.krs.length : 0)
const weighted = sc => (sc ? REVIEW_SKILLS.reduce((s, k) => s + (sc[k.key] || 0) * k.weight, 0) / 100 : null)
const grade = v => (v == null ? '—' : v >= 4.5 ? 'A' : v >= 3.75 ? 'B' : v >= 3 ? 'C' : 'D')
const GRADE_TONE = { A: 'success', B: 'primary', C: 'finance', D: 'danger', '—': 'muted' }
const progTone = p => (p >= 0.8 ? 'success' : p >= 0.5 ? 'finance' : 'danger')

/* Phân hệ "Hiệu suất & đào tạo" */
export default function PerformanceModule({ employees, perf, setPerf, toast }) {
  const { can, user, role, log, inScope } = useAccess()
  const [tab, setTab] = useState('okr')
  const [period, setPeriod] = useState(PERIODS[0])
  const [okrForm, setOkrForm] = useState(null)
  const [reviewOf, setReviewOf] = useState(null)
  const [draft, setDraft] = useState(null)
  const [enrollFor, setEnrollFor] = useState(null)
  const { okrs, reviews, enroll } = perf

  if (!can('performance', 'view')) return <NoAccess />

  const empOf = id => employees.find(e => e.id === id)
  const staff = employees.filter(e => e.status !== 'left' && inScope(e))
  const list = okrs.filter(o => o.period === period && (role !== 'employee' || o.krs.some(k => k.owner === user.id)) && (role !== 'manager' || o.dept === user.dept || o.krs.some(k => empOf(k.owner)?.dept === user.dept)))
  const setKr = (oid, kid, current) => setPerf(p => ({ ...p, okrs: p.okrs.map(o => (o.id === oid ? { ...o, krs: o.krs.map(k => (k.id === kid ? { ...k, current } : k)) } : o)) }))
  const canEditKr = kr => can('performance', 'edit') && (role !== 'employee' || kr.owner === user.id)

  function saveOkr() {
    const f = okrForm
    if (!f.title.trim() || !f.krs.some(k => k.title.trim())) return
    const id = Math.max(0, ...okrs.map(o => o.id)) + 1
    const rec = { id, period, title: f.title.trim(), owner: Number(f.owner), dept: empOf(Number(f.owner)).dept, krs: f.krs.filter(k => k.title.trim()).map((k, i) => ({ ...k, id: id * 10 + i, target: Number(k.target), current: 0, owner: Number(k.owner) })) }
    setPerf(p => ({ ...p, okrs: [...p.okrs, rec] }))
    log('performance', 'create', `Mục tiêu ${period}: ${rec.title}`)
    toast('Đã tạo mục tiêu mới')
    setOkrForm(null)
  }

  /* Đánh giá: nhân viên tự đánh giá (self) → quản lý đánh giá (mgr) */
  const rv = id => reviews[id] || { state: 'todo' }
  const isManagerOf = e => role === 'hradmin' || role === 'sysadmin' || (role === 'manager' && e.managerId === user.id) || (role === 'manager' && e.dept === user.dept && e.id !== user.id)
  function openReview(e) {
    const r = rv(e.id)
    const mode = e.id === user.id && ['todo', 'self'].includes(r.state) ? 'self' : r.state === 'manager' && isManagerOf(e) ? 'mgr' : 'view'
    setReviewOf({ emp: e, mode })
    setDraft({ scores: { ...(mode === 'self' ? r.self : r.mgr) || Object.fromEntries(REVIEW_SKILLS.map(s => [s.key, 3])) }, note: (mode === 'self' ? r.selfNote : r.mgrNote) || '' })
  }
  function submitReview() {
    const { emp, mode } = reviewOf
    setPerf(p => {
      const r = p.reviews[emp.id] || { state: 'todo' }
      const next = mode === 'self' ? { ...r, state: 'manager', self: draft.scores, selfNote: draft.note } : { ...r, state: 'done', mgr: draft.scores, mgrNote: draft.note }
      return { ...p, reviews: { ...p.reviews, [emp.id]: next } }
    })
    log('performance', mode === 'self' ? 'edit' : 'approve', `${mode === 'self' ? 'Tự đánh giá' : 'Quản lý đánh giá'} ${REVIEW_PERIOD} — ${emp.name}`)
    toast(mode === 'self' ? 'Đã gửi tự đánh giá cho quản lý' : `Đã hoàn tất đánh giá ${emp.name}`)
    setReviewOf(null)
  }
  function launchCycle() {
    setPerf(p => {
      const r = { ...p.reviews }
      staff.forEach(e => { if (!r[e.id]) r[e.id] = { state: 'self' } })
      return { ...p, reviews: r }
    })
    log('performance', 'create', `Mở đợt đánh giá ${REVIEW_PERIOD} cho toàn bộ nhân sự`)
    toast('Đã gửi yêu cầu tự đánh giá tới nhân sự')
  }

  /* Đào tạo */
  const enrolled = id => enroll[id] || {}
  const setProgress = (eid, cid, v) => setPerf(p => ({ ...p, enroll: { ...p.enroll, [eid]: { ...(p.enroll[eid] || {}), [cid]: v } } }))
  const enrollPath = (eid, path) => {
    setPerf(p => ({ ...p, enroll: { ...p.enroll, [eid]: { ...Object.fromEntries(path.courses.map(c => [c, 0])), ...(p.enroll[eid] || {}) } } }))
    log('performance', 'create', `Ghi danh lộ trình "${path.title}" — ${empOf(eid).name}`)
    toast(`Đã ghi danh ${empOf(eid).name} vào lộ trình "${path.title}"`)
  }
  const mandatory = COURSES.filter(c => c.mandatory)
  const compliance = staff.length ? staff.filter(e => mandatory.every(c => enrolled(e.id)[c.id] === 100)).length / staff.length : 0
  const reviewStaff = staff
  const doneReviews = reviewStaff.filter(e => rv(e.id).state === 'done')
  const avgScore = doneReviews.length ? doneReviews.reduce((s, e) => s + weighted(rv(e.id).mgr), 0) / doneReviews.length : null

  return (
    <div className="cc-stack">
      <div className="cc-kpis">
        <div className="cc-card cc-kpi2 cc-tone-primary"><span className="cc-ico"><Icon name="target" size={15} /></span><div><span>Tiến độ OKR {period}</span><b>{list.length ? Math.round(list.reduce((s, o) => s + okrProgress(o), 0) / list.length * 100) : 0}%</b><em>{list.length} mục tiêu</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-attendance"><span className="cc-ico"><Icon name="award" size={15} /></span><div><span>Đánh giá {REVIEW_PERIOD.split('/')[0]} hoàn tất</span><b>{doneReviews.length}<small>/{reviewStaff.length}</small></b><em>{reviewStaff.filter(e => rv(e.id).state === 'manager').length} chờ quản lý chấm</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-success"><span className="cc-ico"><Icon name="trending" size={15} /></span><div><span>Điểm trung bình</span><b>{avgScore ? avgScore.toFixed(2) : '—'}</b><em>xếp loại {grade(avgScore)}</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-danger"><span className="cc-ico"><Icon name="graduation" size={15} /></span><div><span>Hoàn thành đào tạo bắt buộc</span><b>{Math.round(compliance * 100)}%</b><em>{mandatory.map(c => c.title).join(' · ')}</em></div></div>
      </div>

      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={tab} onChange={setTab} options={[{ value: 'okr', label: 'Mục tiêu KPI / OKR', icon: 'target' }, { value: 'review', label: 'Đánh giá định kỳ', icon: 'award' }, { value: 'training', label: 'Đào tạo', icon: 'graduation' }]} />
        <span className="cc-grow" />
        {tab === 'okr' && <Seg value={period} onChange={setPeriod} options={PERIODS.map(p => ({ value: p, label: p }))} />}
        {tab === 'okr' && can('performance', 'create') && <button className="cc-btn" onClick={() => setOkrForm({ title: '', owner: user.id, krs: [{ title: '', target: '', unit: '%', owner: user.id }] })}><Icon name="plus" size={14} stroke={2.4} />Thêm mục tiêu</button>}
        {tab === 'review' && (role === 'hradmin' || role === 'sysadmin') && <button className="cc-btn" onClick={launchCycle}><Icon name="send" size={14} />Mở đợt đánh giá</button>}
      </div>

      {tab === 'okr' && (
        <div className="cc-stack">
          {list.length === 0 && <div className="cc-card"><Empty icon="target" text={`Chưa có mục tiêu cho ${period}`} /></div>}
          {list.map(o => {
            const p = okrProgress(o)
            const owner = empOf(o.owner)
            return (
              <div key={o.id} className="cc-card cc-pad cc-okr">
                <div className="cc-okr-head">
                  <div className={`cc-ring cc-tone-${progTone(p)}`} style={{ '--p': p }}><span>{Math.round(p * 100)}%</span></div>
                  <div className="cc-grow"><div className="cc-kicker" style={{ color: `var(--${deptOf(o.dept).tone === 'muted' ? 'text-muted' : deptOf(o.dept).tone})` }}>OBJECTIVE · {deptOf(o.dept).name}</div><b className="cc-okr-title">{o.title}</b></div>
                  {owner && <span className="cc-owner"><Avatar emp={owner} size={24} />{owner.name}</span>}
                </div>
                <div className="cc-krs">
                  {o.krs.map(k => {
                    const kp = krProgress(k)
                    const ko = empOf(k.owner)
                    return (
                      <div key={k.id} className="cc-kr">
                        <span className="cc-kr-tag">KR</span>
                        <div className="cc-grow"><span>{k.title}</span><em>{ko?.name}{k.inverse ? ' · càng thấp càng tốt' : ''}</em></div>
                        <div className="cc-kr-val mono">
                          {canEditKr(k) ? <input type="number" step="any" value={k.current} onChange={e => setKr(o.id, k.id, Number(e.target.value))} aria-label="Giá trị hiện tại" /> : <b>{k.current}</b>}
                          <span>/ {k.target} {k.unit}</span>
                        </div>
                        <div className={`cc-bar cc-tone-${progTone(kp)}`}><span style={{ width: kp * 100 + '%', background: 'var(--c)' }} /></div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'review' && (
        <div className="cc-card cc-pad">
          <div className="cc-toolbar"><div><h3 className="cc-h3" style={{ margin: 0 }}>Đợt đánh giá {REVIEW_PERIOD}</h3><span className="cc-sub">Quy trình: nhân viên tự đánh giá → quản lý trực tiếp đánh giá → chốt xếp loại (A ≥ 4,5 · B ≥ 3,75 · C ≥ 3 · D)</span></div></div>
          {reviewStaff.length === 0 && <Empty text="Không có nhân sự" />}
          <div className="cc-table-wrap">
            <table className="cc-table2 hover">
              <thead><tr><th>Nhân viên</th><th>Trạng thái</th><th className="r">Tự đánh giá</th><th className="r">Quản lý</th><th className="c">Xếp loại</th><th /></tr></thead>
              <tbody>
                {reviewStaff.map(e => {
                  const r = rv(e.id)
                  const s = weighted(r.self), m = weighted(r.mgr)
                  const action = e.id === user.id && ['todo', 'self'].includes(r.state) ? 'Tự đánh giá' : r.state === 'manager' && isManagerOf(e) && can('performance', 'approve') ? 'Chấm điểm' : 'Xem'
                  return (
                    <tr key={e.id} onClick={() => openReview(e)}>
                      <td><div className="cc-person2"><Avatar emp={e} size={28} /><div><b>{e.name}</b><span>{e.position}</span></div></div></td>
                      <td><Pill tone={REVIEW_STATES[r.state].tone} dot>{REVIEW_STATES[r.state].label}</Pill></td>
                      <td className="r mono">{s ? s.toFixed(2) : '·'}</td><td className="r mono">{m ? m.toFixed(2) : '·'}</td>
                      <td className="c"><span className={`cc-grade cc-tone-${GRADE_TONE[grade(m)]}`}>{grade(m)}</span></td>
                      <td className="r"><button className={`cc-link-btn${action !== 'Xem' ? ' strong' : ''}`}>{action}</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'training' && (
        <div className="cc-stack">
          <div className="cc-course-grid">
            {COURSES.map(c => {
              const learners = staff.filter(e => enrolled(e.id)[c.id] != null)
              const done = learners.filter(e => enrolled(e.id)[c.id] === 100).length
              return (
                <div key={c.id} className={`cc-card cc-course cc-tone-${c.tone}`}>
                  <div className="cc-course-top"><span className="cc-ico"><Icon name="graduation" size={15} /></span>{c.mandatory && <Pill tone="danger">Bắt buộc</Pill>}<span className="cc-grow" /><span className="cc-sub">{c.hours} giờ · {c.format}</span></div>
                  <b>{c.title}</b><span className="cc-sub">{c.category}</span>
                  <div className="cc-course-foot"><div className="cc-bar"><span style={{ width: (learners.length ? done / learners.length : 0) * 100 + '%', background: 'var(--c)' }} /></div><span className="cc-sub">{done}/{learners.length} hoàn thành</span></div>
                </div>
              )
            })}
          </div>
          <div className="cc-grid2">
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Lộ trình học tập</h3>
              {LEARNING_PATHS.map(p => (
                <div key={p.id} className="cc-path">
                  <div className="cc-path-head"><b>{p.title}</b><span className="cc-sub">{p.for}</span></div>
                  <ol className="cc-path-steps">{p.courses.map((cid, i) => <li key={cid}><span>{i + 1}</span>{COURSES.find(c => c.id === cid).title}</li>)}</ol>
                </div>
              ))}
            </div>
            <div className="cc-card cc-pad">
              <h3 className="cc-h3">Tiến độ học của nhân sự</h3>
              {staff.length === 0 && <Empty text="Không có nhân sự" />}
              {staff.map(e => {
                const en = enrolled(e.id)
                const ids = Object.keys(en)
                const avgP = ids.length ? ids.reduce((s, k) => s + en[k], 0) / ids.length : 0
                const missing = mandatory.filter(c => en[c.id] !== 100)
                return (
                  <div key={e.id} className="cc-learner">
                    <Avatar emp={e} size={28} />
                    <div className="cc-grow"><b>{e.name}</b><span className="cc-sub">{ids.length} khoá{missing.length ? ` · thiếu: ${missing.map(c => c.title).join(', ')}` : ' · đủ khoá bắt buộc'}</span></div>
                    <div className="cc-bar" style={{ maxWidth: 90 }}><span style={{ width: avgP + '%' }} /></div>
                    <span className="mono cc-sub" style={{ width: 36, textAlign: 'right' }}>{Math.round(avgP)}%</span>
                    {(can('performance', 'edit') && role !== 'employee') || e.id === user.id ? <button className="cc-link-btn" onClick={() => setEnrollFor(e)}>Chi tiết</button> : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <Modal open={!!okrForm} onClose={() => setOkrForm(null)} width={680} icon="target" title={`Thêm mục tiêu — ${period}`} sub="Objective + các Key Result đo lường được"
        footer={<><button className="cc-btn ghost" onClick={() => setOkrForm(null)}>Hủy</button><button className="cc-btn" onClick={saveOkr}>Tạo mục tiêu</button></>}>
        {okrForm && <div className="cc-stack">
          <div className="cc-form" style={{ marginTop: 0 }}>
            <Field label="Mục tiêu (Objective)" full><input value={okrForm.title} placeholder="VD: Rút ngắn thời gian nghiệm thu" onChange={e => setOkrForm({ ...okrForm, title: e.target.value })} /></Field>
            <Field label="Người phụ trách"><select value={okrForm.owner} onChange={e => setOkrForm({ ...okrForm, owner: e.target.value })}>{staff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          </div>
          <div className="cc-rows">
            <div className="cc-rows-head"><span className="cc-f-label">Key results</span><button className="cc-link-btn" onClick={() => setOkrForm({ ...okrForm, krs: [...okrForm.krs, { title: '', target: '', unit: '%', owner: user.id }] })}><Icon name="plus" size={13} stroke={2.4} />Thêm KR</button></div>
            {okrForm.krs.map((k, i) => {
              const upd = patch => setOkrForm({ ...okrForm, krs: okrForm.krs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              return (
                <div key={i} className="cc-rows-item" style={{ gridTemplateColumns: '1.8fr 80px 70px 1fr 30px' }}>
                  <input placeholder="Kết quả then chốt" value={k.title} onChange={e => upd({ title: e.target.value })} />
                  <input type="number" placeholder="Mục tiêu" value={k.target} onChange={e => upd({ target: e.target.value })} />
                  <input placeholder="Đơn vị" value={k.unit} onChange={e => upd({ unit: e.target.value })} />
                  <select className="cc-select" value={k.owner} onChange={e => upd({ owner: e.target.value })}>{staff.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
                  <button className="cc-icon-btn sm danger" onClick={() => setOkrForm({ ...okrForm, krs: okrForm.krs.filter((_, j) => j !== i) })}><Icon name="x" size={13} /></button>
                </div>
              )
            })}
          </div>
        </div>}
      </Modal>

      <Modal open={!!reviewOf} onClose={() => setReviewOf(null)} width={640} icon="award"
        title={reviewOf ? (reviewOf.mode === 'self' ? `Tự đánh giá ${REVIEW_PERIOD}` : reviewOf.mode === 'mgr' ? `Đánh giá ${reviewOf.emp.name}` : `Kết quả đánh giá — ${reviewOf.emp.name}`) : ''}
        sub={reviewOf ? `${reviewOf.emp.position} · ${deptOf(reviewOf.emp.dept).name}` : ''}
        footer={reviewOf && <><span className="cc-grow cc-sub">{reviewOf.mode !== 'view' && draft ? `Điểm có trọng số: ${weighted(draft.scores).toFixed(2)} · xếp loại ${grade(weighted(draft.scores))}` : ''}</span>
          <button className="cc-btn ghost" onClick={() => setReviewOf(null)}>{reviewOf.mode === 'view' ? 'Đóng' : 'Hủy'}</button>
          {reviewOf.mode !== 'view' && <button className="cc-btn" onClick={submitReview}><Icon name="send" size={14} />{reviewOf.mode === 'self' ? 'Gửi quản lý' : 'Hoàn tất đánh giá'}</button>}</>}>
        {reviewOf && draft && (() => {
          const r = rv(reviewOf.emp.id)
          return (
            <div className="cc-stack">
              <table className="cc-table2 compact">
                <thead><tr><th>Tiêu chí</th><th className="r">Trọng số</th><th className="c">Tự đánh giá</th><th className="c">Quản lý</th></tr></thead>
                <tbody>{REVIEW_SKILLS.map(s => {
                  const selfV = reviewOf.mode === 'self' ? draft.scores[s.key] : r.self?.[s.key]
                  const mgrV = reviewOf.mode === 'mgr' ? draft.scores[s.key] : r.mgr?.[s.key]
                  const pick = (editable, v) => editable
                    ? <div className="cc-scale">{[1, 2, 3, 4, 5].map(n => <button key={n} className={v === n ? 'on' : ''} onClick={() => setDraft({ ...draft, scores: { ...draft.scores, [s.key]: n } })}>{n}</button>)}</div>
                    : <b className="mono">{v ?? '·'}</b>
                  return <tr key={s.key}><td>{s.label}</td><td className="r mono">{s.weight}%</td><td className="c">{pick(reviewOf.mode === 'self', selfV)}</td><td className="c">{pick(reviewOf.mode === 'mgr', mgrV)}</td></tr>
                })}</tbody>
              </table>
              {r.selfNote && reviewOf.mode !== 'self' && <div className="cc-kv"><span>Nhân viên tự nhận xét</span><b>{r.selfNote}</b></div>}
              {r.mgrNote && reviewOf.mode === 'view' && <div className="cc-kv"><span>Quản lý nhận xét</span><b>{r.mgrNote}</b></div>}
              {reviewOf.mode !== 'view' && <Field label={reviewOf.mode === 'self' ? 'Kết quả nổi bật / khó khăn' : 'Nhận xét & định hướng phát triển'}><input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>}
              {reviewOf.mode === 'view' && r.state !== 'done' && <div className="cc-sub">Chưa thể chấm điểm: {REVIEW_STATES[r.state].label.toLowerCase()}.</div>}
            </div>
          )
        })()}
      </Modal>

      <Modal open={!!enrollFor} onClose={() => setEnrollFor(null)} width={560} icon="graduation" title={enrollFor ? `Đào tạo — ${enrollFor.name}` : ''}
        footer={<button className="cc-btn" onClick={() => setEnrollFor(null)}>Xong</button>}>
        {enrollFor && <div className="cc-stack">
          {COURSES.filter(c => enrolled(enrollFor.id)[c.id] != null).map(c => (
            <div key={c.id} className="cc-learner">
              <span className={`cc-ico sm cc-tone-${c.tone}`}><Icon name="graduation" size={13} /></span>
              <div className="cc-grow"><b>{c.title}</b><span className="cc-sub">{c.hours} giờ · {c.format}</span></div>
              <input type="range" min="0" max="100" step="10" value={enrolled(enrollFor.id)[c.id]}
                onChange={e => setProgress(enrollFor.id, c.id, Number(e.target.value))} aria-label="Tiến độ" />
              <span className="mono cc-sub" style={{ width: 36, textAlign: 'right' }}>{enrolled(enrollFor.id)[c.id]}%</span>
            </div>
          ))}
          {can('performance', 'create') && role !== 'employee' && <>
            <h3 className="cc-h3" style={{ margin: '6px 0 0' }}>Ghi danh theo lộ trình</h3>
            <div className="cc-checks">{LEARNING_PATHS.map(p => <button key={p.id} className="cc-btn ghost" onClick={() => enrollPath(enrollFor.id, p)}><Icon name="plus" size={13} />{p.title}</button>)}</div>
          </>}
        </div>}
      </Modal>
    </div>
  )
}
