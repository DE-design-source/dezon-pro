import { useState } from 'react'
import Icon from '../../../components/ui/Icon'
import { DEPTS, deptOf, fmtDate, HR_TODAY, daysBetween, WORK_SITES, siteOptions } from '../../../data/hrData'
import { STAGES, SOURCES, REVIEW_CRITERIA, JD_LEVELS } from '../../../data/hrData2'
import { Pill, Seg, Modal, Field, Empty } from './shared'
import { useAccess, NoAccess } from './access'
import OnboardPage from './OnboardPage'
import { uploadRaw, mediaUrl } from '../../QS/api/files'
import { safeUrl_ } from '../../QS/lib/format'

const JOB_STATUS = { open: { label: 'Đang tuyển', tone: 'success' }, paused: { label: 'Tạm dừng', tone: 'finance' }, closed: { label: 'Đã đóng', tone: 'muted' } }
const initials = n => n.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()
const avg = r => { const v = Object.values(r.scores); return v.reduce((a, b) => a + b, 0) / v.length }
/* Ngày sau hôm nay n ngày (yyyy-mm-dd) - mặc định hạn nộp / lịch phỏng vấn */
const afterDays = n => { const d = new Date(HR_TODAY + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const BLANK_JOB = { jdId: null, title: '', dept: 'thicong', qty: 1, site: '', salary: '', deadline: afterDays(30), status: 'open', channels: [] }
const BLANK_JD = { code: '', title: '', dept: 'thicong', level: 'Nhân viên', salary: '', summary: '', duties: '', requirements: '', benefits: '' }
const toJdForm = jd => ({ ...jd, duties: jd.duties.join('\n'), requirements: jd.requirements.join('\n'), benefits: jd.benefits.join('\n') })

/* Nội dung một JD (dùng trong thư viện & xem trước khi đăng tin) */
function JdPreview({ jd, compact, onEdit }) {
  const Sec = ({ t, items }) => items.length ? <div className="cc-jd-sec"><b>{t}</b><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null
  return (
    <div className={`cc-jd-view${compact ? ' compact' : ''}`}>
      <p>{jd.summary}</p>
      <Sec t="Nhiệm vụ chính" items={jd.duties} />
      <Sec t="Yêu cầu" items={jd.requirements} />
      {!compact && <Sec t="Quyền lợi" items={jd.benefits} />}
      {compact && <div className="cc-sub">{jd.code} · cập nhật {fmtDate(jd.updated)}{onEdit && <> · <button type="button" className="cc-link-btn" onClick={onEdit}>Sửa JD trong thư viện</button></>}</div>}
    </div>
  )
}
const BLANK_CAND = { name: '', email: '', phone: '', jobId: '', source: 'TopCV', exp: '', cv: '' }

function Stars({ value, onChange }) {
  return (
    <span className="cc-stars">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={n <= value ? 'on' : ''} onClick={() => onChange && onChange(n)} disabled={!onChange} aria-label={`${n} điểm`}>★</button>
      ))}
    </span>
  )
}

/* Phân hệ "Tuyển dụng & Onboarding" */
/* recruit = { jds, jobs, candidates, interviews } từ máy chủ; tal = thao tác ghi (ChamCong.jsx), mỗi lệnh trả Promise kết quả hoặc null khi lỗi.
   Kênh đăng tin / thư mời phỏng vấn chỉ ghi nhận, hệ thống chưa tự đăng hay gửi email. */
export default function RecruitModule({ recruit, tal, onHire, toast, nextEmpCode, defaultManagerOf, employees = [], onOpenEmployee }) {
  const { can, canAll, user, role, log } = useAccess()
  const canHire = can('recruit', 'edit') && canAll('employees', 'create') // nhận việc = tạo hồ sơ nhân sự
  const [tab, setTab] = useState('pipeline')
  const [jobFilter, setJobFilter] = useState('all')
  const [jobForm, setJobForm] = useState(null)
  const [candForm, setCandForm] = useState(null)
  const [openCand, setOpenCand] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)
  const [review, setReview] = useState(null)
  const [ivForm, setIvForm] = useState(null)
  const [onboard, setOnboard] = useState(null) // bước Nhận việc: { candId, code, dept, position, level, joinDate, managerId, site }
  const [jdQ, setJdQ] = useState('')
  const [jdDept, setJdDept] = useState('all')
  const [openJd, setOpenJd] = useState(null)
  const [jdForm, setJdForm] = useState(null)
  const { jobs, candidates, interviews, jds } = recruit
  const jdOf = id => jds.find(x => x.id === id)
  const formJd = jobForm?.jdId ? jdOf(jobForm.jdId) : null

  if (!can('recruit', 'view')) return <NoAccess text="Nhân viên không có quyền truy cập phân hệ tuyển dụng." />

  // Trưởng phòng chỉ thấy tin tuyển dụng của phòng mình
  const myJobs = role === 'manager' ? jobs.filter(j => j.dept === user.dept) : jobs
  const jobIds = new Set(myJobs.map(j => j.id))
  const cands = candidates.filter(c => jobIds.has(c.jobId) && (jobFilter === 'all' || c.jobId === Number(jobFilter)))
  const jobOf = id => jobs.find(j => j.id === id)
  const candOf = id => candidates.find(c => c.id === id)

  function moveStage(id, stage) {
    const c = candOf(id)
    if (!c || c.stage === stage) return
    if (!can('recruit', 'edit')) { toast('Bạn không có quyền chuyển trạng thái ứng viên', 'danger'); return }
    if (c.empCode) { toast(`${c.name} đã nhận việc (hồ sơ ${c.empCode}) — không thể chuyển lại`, 'danger'); return }
    if (stage === 'hired') { if (canHire) startOnboard(c); else toast('Nhận việc cần quyền tạo hồ sơ nhân sự (HR Admin)', 'danger'); return }
    tal.updCand(id, { stage }).then(r => r && log('recruit', 'edit', `Ứng viên ${c.name} → ${STAGES.find(s => s.key === stage).label}`))
  }
  function pickJd(id) {
    const jd = jds.find(x => x.id === Number(id))
    setJobForm(f => (jd ? { ...f, jdId: jd.id, title: jd.title, dept: jd.dept, salary: f.salary && f.jdId === jd.id ? f.salary : jd.salary } : { ...f, jdId: null, title: '' }))
  }
  function saveJd() {
    const f = jdForm
    if (!f.title.trim()) return
    const lines = t => t.split('\n').map(x => x.replace(/^[-•\s]+/, '').trim()).filter(Boolean)
    const rec = { ...f, title: f.title.trim(), duties: lines(f.duties), requirements: lines(f.requirements), benefits: lines(f.benefits) }
    tal.saveJd(rec, f.id ? 'Đã cập nhật JD — các tin tuyển dụng liên quan dùng nội dung mới' : `Đã thêm "${rec.title}" vào thư viện JD`).then(r => {
      if (!r) return
      log('recruit', f.id ? 'edit' : 'create', `Thư viện JD: ${rec.code} ${rec.title}`)
      setOpenJd(r.id)
      setJdForm(null)
    })
  }
  function deleteJd(jd) {
    const used = jobs.filter(j => j.jdId === jd.id).length
    if (used) { toast(`JD đang được dùng bởi ${used} tin tuyển dụng — không thể xoá`, 'danger'); return }
    if (!confirm(`Xoá JD "${jd.title}" khỏi thư viện?`)) return
    tal.deleteJd(jd.id, `Đã xoá JD ${jd.title}`).then(r => {
      if (!r) return
      setOpenJd(null)
      log('recruit', 'delete', `Thư viện JD: ${jd.code} ${jd.title}`)
    })
  }
  function saveJob() {
    const j = jobForm
    if (!j.jdId) return
    tal.saveJob(j, j.id ? 'Đã cập nhật tin tuyển dụng' : `Đã lưu tin "${j.title}"${j.channels.length ? ' (kênh: ' + j.channels.join(', ') + ' — đăng tay)' : ''}`).then(r => {
      if (!r) return
      log('recruit', j.id ? 'edit' : 'create', `Tin tuyển dụng: ${j.title}`)
      setJobForm(null)
    })
  }
  /* CV tải lên kho file (/upload/file -> /files/...) khi bấm Thêm ứng viên */
  async function saveCand() {
    const c = candForm
    if (!c.name.trim() || !c.jobId) return
    const { file, ...rest } = c
    let cvUrl = ''
    if (file) {
      try { cvUrl = (await uploadRaw(file)).url || '' } catch (e) { toast(`Tải CV lỗi: ${e.message}`, 'danger'); return }
    }
    const rec = { ...rest, name: c.name.trim(), jobId: Number(c.jobId), cv: c.cv || `CV_${c.name.replace(/\s+/g, '')}.pdf`, cvUrl }
    tal.addCand(rec, `Đã thêm ứng viên ${rec.name}`).then(r => {
      if (!r) return
      log('recruit', 'create', `Ứng viên ${rec.name} — ${jobOf(rec.jobId).title}`)
      setCandForm(null)
    })
  }
  function saveReview() {
    const r = review
    tal.updCand(r.candId, { review: { by: user.name, round: r.round, scores: r.scores, note: r.note } }, 'Đã lưu đánh giá').then(res => {
      if (!res) return
      log('recruit', 'edit', `Đánh giá ứng viên ${candOf(r.candId).name} (${r.round})`)
      setReview(null)
    })
  }
  function saveInterview() {
    const v = ivForm
    if (!v.candidateId || !v.date) return
    const c = candOf(Number(v.candidateId))
    const { candidateId: _c, ...iv } = v
    // máy chủ chuyển ứng viên đang Ứng tuyển / Sàng lọc sang Phỏng vấn
    tal.updCand(c.id, { interview: iv }, `Đã đặt lịch phỏng vấn ${c.name} (chưa gửi thư mời tự động)`).then(r => {
      if (!r) return
      log('recruit', 'create', `Lịch phỏng vấn ${c.name} — ${fmtDate(v.date)} ${v.time}`)
      setIvForm(null)
    })
  }
  function startOnboard(c) {
    const job = jobOf(c.jobId) || {}
    const level = JD_LEVELS.includes(job.level) ? job.level : 'Nhân viên'
    setOnboard({ candId: c.id, code: nextEmpCode ? nextEmpCode() : '', dept: job.dept || DEPTS[0]?.key, position: job.title || '', level: level === 'Thực tập' ? 'Nhân viên' : level, joinDate: HR_TODAY, managerId: defaultManagerOf?.(job.dept)?.id || '', site: job.site || WORK_SITES[0] })
  }
  const hire = c => startOnboard(c)
  async function confirmOnboard(data) {
    const c = candOf(onboard.candId)
    if (!c) return
    const o = { ...onboard, ...data }
    let res
    // tạo hồ sơ + đánh dấu ứng viên Nhận việc trong 1 lệnh; lỗi đã báo và giữ form (không tạo hồ sơ nào)
    try { res = await onHire(c, jobOf(c.jobId) || { title: o.position, dept: o.dept, salary: '12', site: o.site }, o) } catch (e) { return }
    if (!res) return
    setOnboard(null)
    setOpenCand(null)
  }

  const opened = openCand != null && candOf(openCand)
  const upcoming = [...interviews].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).filter(v => jobIds.has(candOf(v.candidateId)?.jobId))

  if (onboard && candOf(onboard.candId)) {
    const c = candOf(onboard.candId)
    return <OnboardPage candidate={c} job={jobOf(c.jobId)} initial={onboard} employees={employees} defaultManagerOf={defaultManagerOf} onCancel={() => setOnboard(null)} onConfirm={confirmOnboard} />
  }

  return (
    <div className="cc-stack">
      <div className="cc-kpis">
        <div className="cc-card cc-kpi2 cc-tone-primary"><span className="cc-ico"><Icon name="briefcase" size={15} /></span><div><span>Vị trí đang tuyển</span><b>{myJobs.filter(j => j.status === 'open').reduce((s, j) => s + j.qty, 0)}</b><em>{myJobs.filter(j => j.status === 'open').length} tin đang mở</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-attendance"><span className="cc-ico"><Icon name="users" size={15} /></span><div><span>Ứng viên trong pipeline</span><b>{cands.filter(c => !['hired', 'rejected'].includes(c.stage)).length}</b><em>{cands.filter(c => c.stage === 'applied').length} hồ sơ mới chưa xử lý</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-finance"><span className="cc-ico"><Icon name="calendar" size={15} /></span><div><span>Phỏng vấn sắp tới</span><b>{upcoming.filter(v => v.date >= HR_TODAY).length}</b><em>trong 7 ngày tới</em></div></div>
        <div className="cc-card cc-kpi2 cc-tone-success"><span className="cc-ico"><Icon name="userPlus" size={15} /></span><div><span>Nhận việc</span><b>{cands.filter(c => c.stage === 'hired').length}</b><em>{cands.filter(c => c.stage === 'offer').length} đang chờ phản hồi offer</em></div></div>
      </div>

      <div className="cc-toolbar" style={{ marginBottom: 0 }}>
        <Seg value={tab} onChange={setTab} options={[
          { value: 'pipeline', label: 'Ứng viên', icon: 'users', count: cands.length },
          { value: 'jobs', label: 'Tin tuyển dụng', icon: 'briefcase', count: myJobs.length },
          { value: 'interviews', label: 'Lịch phỏng vấn', icon: 'calendar', count: upcoming.length },
          { value: 'jd', label: 'Thư viện JD', icon: 'file', count: jds.length },
        ]} />
        <span className="cc-grow" />
        {tab === 'pipeline' && <select className="cc-select" value={jobFilter} onChange={e => setJobFilter(e.target.value)}><option value="all">Tất cả vị trí</option>{myJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>}
        {tab === 'pipeline' && can('recruit', 'create') && <button className="cc-btn" onClick={() => setCandForm({ ...BLANK_CAND, jobId: jobFilter === 'all' ? myJobs[0]?.id : jobFilter })}><Icon name="userPlus" size={14} />Thêm ứng viên</button>}
        {tab === 'jd' && <label className="cc-search"><Icon name="search" size={14} /><input placeholder="Tìm vị trí, mã JD..." value={jdQ} onChange={e => setJdQ(e.target.value)} /></label>}
        {tab === 'jd' && <select className="cc-select" value={jdDept} onChange={e => setJdDept(e.target.value)}><option value="all">Tất cả phòng ban</option>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</select>}
        {tab === 'jd' && can('recruit', 'create') && <button className="cc-btn" onClick={() => setJdForm({ ...BLANK_JD })}><Icon name="plus" size={14} stroke={2.4} />Thêm JD</button>}
        {tab === 'jobs' && can('recruit', 'create') && <button className="cc-btn" onClick={() => setJobForm({ ...BLANK_JOB })}><Icon name="plus" size={14} stroke={2.4} />Đăng tin tuyển dụng</button>}
        {tab === 'interviews' && can('recruit', 'edit') && <button className="cc-btn" onClick={() => setIvForm({ candidateId: '', date: afterDays(1), time: '09:00', round: 'Vòng 1 — Chuyên môn', interviewer: user.name, mode: 'Trực tiếp', place: 'Phòng họp 1 — VP HCM' })}><Icon name="calendar" size={14} />Đặt lịch phỏng vấn</button>}
      </div>

      {tab === 'pipeline' && (
        <div className="cc-kanban">
          {STAGES.map(s => {
            const list = cands.filter(c => c.stage === s.key)
            return (
              <div key={s.key} className={`cc-kcol cc-tone-${s.tone}${over === s.key ? ' over' : ''}`}
                onDragOver={e => { if (dragId) { e.preventDefault(); setOver(s.key) } }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null) }}
                onDrop={e => { e.preventDefault(); moveStage(dragId, s.key); setDragId(null); setOver(null) }}>
                <div className="cc-kcol-head"><i />{s.label}<span>{list.length}</span></div>
                <div className="cc-kcol-body">
                  {list.length === 0 && <div className="cc-kempty">Kéo ứng viên vào đây</div>}
                  {list.map(c => {
                    const score = c.reviews.length ? c.reviews.reduce((a, r) => a + avg(r), 0) / c.reviews.length : null
                    const iv = interviews.find(v => v.candidateId === c.id && v.date >= HR_TODAY)
                    return (
                      <button key={c.id} className={`cc-kcard${dragId === c.id ? ' dragging' : ''}`} draggable={can('recruit', 'edit')}
                        onDragStart={() => setDragId(c.id)} onDragEnd={() => { setDragId(null); setOver(null) }} onClick={() => setOpenCand(c.id)}>
                        <div className="cc-kcard-top"><span className="cc-av" style={{ width: 28, height: 28, fontSize: 10, background: 'var(--c)' }}>{initials(c.name)}</span><b>{c.name}</b></div>
                        <span className="cc-sub">{jobOf(c.jobId)?.title}</span>
                        {c.empCode && <span className="cc-kcard-emp"><Icon name="checkCircle" size={11} />{c.empCode} · {deptOf(c.empDept || jobOf(c.jobId)?.dept).name}</span>}
                        <div className="cc-kcard-foot">
                          <span className="cc-chip-sm">{c.source}</span>
                          {score != null && <span className="cc-chip-sm star">★ {score.toFixed(1)}</span>}
                          {iv && <span className="cc-chip-sm warn"><Icon name="calendar" size={10} />{fmtDate(iv.date).slice(0, 5)} {iv.time}</span>}
                          <span className="cc-grow" /><span className="cc-sub">{daysBetween(c.applied, HR_TODAY)}n</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'jobs' && (
        <div className="cc-job-grid">
          {myJobs.length === 0 && <Empty icon="briefcase" text="Chưa có tin tuyển dụng" />}
          {myJobs.map(j => {
            const jc = candidates.filter(c => c.jobId === j.id)
            const left = daysBetween(HR_TODAY, j.deadline)
            return (
              <div key={j.id} className="cc-card cc-job">
                <div className="cc-job-top">
                  <span className={`cc-ico cc-tone-${deptOf(j.dept).tone}`}><Icon name="briefcase" size={15} /></span>
                  <div className="cc-grow"><b>{j.title}</b><span className="cc-sub">{deptOf(j.dept).name} · {j.qty} vị trí · {j.site}</span></div>
                  <Pill tone={JOB_STATUS[j.status].tone} dot>{JOB_STATUS[j.status].label}</Pill>
                </div>
                <p className="cc-job-desc">{jdOf(j.jdId)?.summary || j.desc}</p>
                <div className="cc-job-meta"><span><Icon name="wallet" size={12} />{j.salary || 'Thoả thuận'}</span><span className={left < 7 ? 'cc-warn' : ''}><Icon name="calendar" size={12} />Hạn {fmtDate(j.deadline)} {left >= 0 ? `(còn ${left} ngày)` : '(đã hết hạn)'}</span></div>
                <div className="cc-funnel">
                  {STAGES.filter(s => s.key !== 'rejected').map(s => <div key={s.key} className={`cc-tone-${s.tone}`} title={s.label}><b>{jc.filter(c => c.stage === s.key).length}</b><span>{s.label}</span></div>)}
                </div>
                <div className="cc-job-foot">
                  {j.channels.map(ch => <span key={ch} className="cc-chip-sm">{ch}</span>)}
                  <span className="cc-grow" />
                  <button className="cc-link-btn" onClick={() => { setJobFilter(String(j.id)); setTab('pipeline') }}>Xem ứng viên</button>
                  {can('recruit', 'edit') && <button className="cc-icon-btn sm" title="Sửa tin" onClick={() => setJobForm({ ...j })}><Icon name="edit" size={13} /></button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'interviews' && (
        <div className="cc-card cc-pad">
          {upcoming.length === 0 && <Empty icon="calendar" text="Chưa có lịch phỏng vấn" />}
          {Object.entries(upcoming.reduce((g, v) => { (g[v.date] = g[v.date] || []).push(v); return g }, {})).map(([date, list]) => (
            <div key={date} className="cc-iv-day">
              <div className="cc-iv-date"><b>{fmtDate(date).slice(0, 5)}</b><span>{date === HR_TODAY ? 'Hôm nay' : daysBetween(HR_TODAY, date) === 1 ? 'Ngày mai' : `${daysBetween(HR_TODAY, date)} ngày nữa`}</span></div>
              <div className="cc-grow cc-stack" style={{ gap: 8 }}>
                {list.map(v => {
                  const c = candOf(v.candidateId)
                  return (
                    <button key={v.id} className="cc-iv" onClick={() => setOpenCand(c.id)}>
                      <span className="cc-iv-time mono">{v.time}</span>
                      <div className="cc-grow"><b>{c.name}</b><span className="cc-sub">{jobOf(c.jobId)?.title} · {v.round}</span></div>
                      <span className="cc-sub"><Icon name="user" size={12} /> {v.interviewer}</span>
                      <Pill tone={v.mode === 'Online' ? 'primary' : 'attendance'}>{v.mode}</Pill>
                      <span className="cc-sub cc-iv-place">{v.place}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'jd' && (() => {
        const t = jdQ.trim().toLowerCase()
        const list = jds.filter(x => (jdDept === 'all' || x.dept === jdDept) && (!t || (x.title + ' ' + x.code).toLowerCase().includes(t)))
        const cur = (openJd && list.find(x => x.id === openJd)) || list[0]
        return (
          <div className="cc-jd-layout">
            <div className="cc-card cc-jd-list">
              {list.length === 0 && <Empty icon="file" text="Không có JD phù hợp" />}
              {DEPTS.map(d => {
                const group = list.filter(x => x.dept === d.key)
                if (!group.length) return null
                return (
                  <div key={d.key}>
                    <div className="cc-jd-group">{d.name} · {group.length}</div>
                    {group.map(x => {
                      const used = jobs.filter(j => j.jdId === x.id && j.status === 'open').length
                      return (
                        <button key={x.id} className={`cc-jd-item${cur?.id === x.id ? ' active' : ''}`} onClick={() => setOpenJd(x.id)}>
                          <div className="cc-grow"><b>{x.title}</b><span>{x.code} · {x.level}</span></div>
                          {used > 0 && <span className="cc-chip-sm warn">Đang tuyển</span>}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            {cur && (
              <div className={`cc-card cc-pad cc-tone-${deptOf(cur.dept).tone}`}>
                <div className="cc-job-top">
                  <span className="cc-ico"><Icon name="file" size={15} /></span>
                  <div className="cc-grow"><span className="cc-kicker">{cur.code} · {deptOf(cur.dept).name}</span><b style={{ fontSize: 17 }}>{cur.title}</b>
                    <span className="cc-sub">{cur.level} · {cur.salary || 'Thoả thuận'} · cập nhật {fmtDate(cur.updated)} · dùng trong {jobs.filter(j => j.jdId === cur.id).length} tin tuyển dụng</span></div>
                  {can('recruit', 'create') && <button className="cc-btn" onClick={() => { setJobForm({ ...BLANK_JOB, jdId: cur.id, title: cur.title, dept: cur.dept, salary: cur.salary }); setTab('jobs') }}><Icon name="send" size={14} />Đăng tin từ JD</button>}
                  {can('recruit', 'edit') && <button className="cc-icon-btn" title="Sửa JD" onClick={() => setJdForm(toJdForm(cur))}><Icon name="edit" size={15} /></button>}
                  {can('recruit', 'delete') && <button className="cc-icon-btn danger" title="Xoá JD" onClick={() => deleteJd(cur)}><Icon name="trash" size={15} /></button>}
                </div>
                <JdPreview jd={cur} />
              </div>
            )}
          </div>
        )
      })()}

      <Modal open={!!jdForm} onClose={() => setJdForm(null)} width={720} icon="file" title={jdForm?.id ? `Sửa JD — ${jdForm.title}` : 'Thêm JD vào thư viện'} sub="Mỗi dòng trong các ô Nhiệm vụ / Yêu cầu / Quyền lợi là một gạch đầu dòng"
        footer={<><span className="cc-grow cc-sub">{jdForm?.id ? 'Các tin tuyển dụng dùng JD này sẽ tự cập nhật nội dung' : ''}</span><button className="cc-btn ghost" onClick={() => setJdForm(null)}>Hủy</button><button className="cc-btn" onClick={saveJd} disabled={!jdForm?.title.trim()}>Lưu JD</button></>}>
        {jdForm && <div className="cc-form" style={{ marginTop: 0 }}>
          <Field label="Tên vị trí *"><input value={jdForm.title} onChange={e => setJdForm({ ...jdForm, title: e.target.value })} /></Field>
          <Field label="Mã JD"><input value={jdForm.code} placeholder="VD: JD-TC-04" onChange={e => setJdForm({ ...jdForm, code: e.target.value })} /></Field>
          <Field label="Phòng ban"><select value={jdForm.dept} onChange={e => setJdForm({ ...jdForm, dept: e.target.value })}>{DEPTS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</select></Field>
          <Field label="Cấp bậc"><select value={jdForm.level} onChange={e => setJdForm({ ...jdForm, level: e.target.value })}>{JD_LEVELS.map(l => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Khung lương tham khảo" full><input value={jdForm.salary} placeholder="VD: 15–20 triệu" onChange={e => setJdForm({ ...jdForm, salary: e.target.value })} /></Field>
          <Field label="Tóm tắt vị trí" full><textarea rows={2} value={jdForm.summary} onChange={e => setJdForm({ ...jdForm, summary: e.target.value })} /></Field>
          <Field label="Nhiệm vụ chính" full><textarea rows={4} value={jdForm.duties} onChange={e => setJdForm({ ...jdForm, duties: e.target.value })} /></Field>
          <Field label="Yêu cầu"><textarea rows={4} value={jdForm.requirements} onChange={e => setJdForm({ ...jdForm, requirements: e.target.value })} /></Field>
          <Field label="Quyền lợi"><textarea rows={4} value={jdForm.benefits} onChange={e => setJdForm({ ...jdForm, benefits: e.target.value })} /></Field>
        </div>}
      </Modal>

      {/* Hồ sơ ứng viên */}
      <Modal open={!!opened} onClose={() => setOpenCand(null)} width={720} icon="user" title={opened?.name} sub={opened ? `${jobOf(opened.jobId)?.title} · ứng tuyển ${fmtDate(opened.applied)} qua ${opened.source}` : ''}
        footer={opened && <>
          {can('recruit', 'edit') && <select className="cc-select" value={opened.stage} onChange={e => moveStage(opened.id, e.target.value)}>{STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}
          <span className="cc-grow" />
          {can('recruit', 'edit') && <button className="cc-btn ghost" onClick={() => setIvForm({ candidateId: opened.id, date: afterDays(1), time: '09:00', round: 'Vòng ' + (opened.reviews.length + 1), interviewer: user.name, mode: 'Trực tiếp', place: 'Phòng họp 1 — VP HCM' })}><Icon name="calendar" size={14} />Đặt lịch PV</button>}
          {can('recruit', 'edit') && <button className="cc-btn ghost" onClick={() => setReview({ candId: opened.id, round: 'Vòng ' + (opened.reviews.length + 1), scores: Object.fromEntries(REVIEW_CRITERIA.map(c => [c.key, 3])), note: '' })}><Icon name="award" size={14} />Đánh giá</button>}
          {opened.stage === 'offer' && canHire && <button className="cc-btn" onClick={() => hire(opened)}><Icon name="userPlus" size={14} />Nhận việc → tạo hồ sơ NV</button>}
          {opened.empId && onOpenEmployee && <button className="cc-btn ghost" onClick={() => onOpenEmployee(opened.empId)}><Icon name="users" size={14} />Mở hồ sơ {opened.empCode}</button>}
        </>}>
        {opened && <div className="cc-grid2">
          <div>
            <div className="cc-kv"><span>Trạng thái</span><b><Pill tone={STAGES.find(s => s.key === opened.stage).tone} dot>{STAGES.find(s => s.key === opened.stage).label}</Pill></b></div>
            <div className="cc-kv"><span>Email</span><b>{opened.email}</b></div>
            <div className="cc-kv"><span>Điện thoại</span><b>{opened.phone}</b></div>
            <div className="cc-kv"><span>Kinh nghiệm</span><b>{opened.exp}</b></div>
            <div className="cc-doc"><span className="cc-ico sm cc-tone-primary"><Icon name="file" size={13} /></span><div className="cc-grow"><b>{opened.cv}</b><span>{opened.cvUrl ? 'CV đính kèm' : 'Chỉ có tên file (chưa tải lên)'}</span></div>
              {opened.cvUrl && <a href={safeUrl_(mediaUrl(opened.cvUrl))} target="_blank" rel="noreferrer" title="Mở CV"><Icon name="download" size={15} /></a>}</div>
            {opened.hiredAt && <div className="cc-phase-note" style={{ marginTop: 10 }}><Icon name="checkCircle" size={14} />Đã chuyển thành hồ sơ nhân viên ngày {fmtDate(opened.hiredAt)}</div>}
          </div>
          <div>
            <h3 className="cc-h3">Đánh giá phỏng vấn</h3>
            {opened.reviews.length === 0 && <Empty icon="award" text="Chưa có đánh giá" />}
            {opened.reviews.map((r, i) => (
              <div key={i} className="cc-review">
                <div className="cc-review-head"><b>{r.round}</b><span className="cc-chip-sm star">★ {avg(r).toFixed(1)}</span></div>
                <span className="cc-sub">{r.by} · {fmtDate(r.date)}</span>
                {REVIEW_CRITERIA.map(c => <div key={c.key} className="cc-review-row"><span>{c.label}</span><Stars value={r.scores[c.key]} /></div>)}
                {r.note && <q>{r.note}</q>}
              </div>
            ))}
          </div>
        </div>}
      </Modal>

      <Modal open={!!review} onClose={() => setReview(null)} width={480} icon="award" title="Phiếu đánh giá ứng viên" sub={review ? candOf(review.candId)?.name : ''}
        footer={<><button className="cc-btn ghost" onClick={() => setReview(null)}>Hủy</button><button className="cc-btn" onClick={saveReview}>Lưu đánh giá</button></>}>
        {review && <div className="cc-stack">
          <Field label="Vòng phỏng vấn"><input value={review.round} onChange={e => setReview({ ...review, round: e.target.value })} /></Field>
          {REVIEW_CRITERIA.map(c => <div key={c.key} className="cc-review-row big"><span>{c.label}</span><Stars value={review.scores[c.key]} onChange={n => setReview({ ...review, scores: { ...review.scores, [c.key]: n } })} /></div>)}
          <Field label="Nhận xét"><input value={review.note} placeholder="Điểm mạnh, điểm cần lưu ý..." onChange={e => setReview({ ...review, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!candForm} onClose={() => setCandForm(null)} width={560} icon="userPlus" title="Thêm ứng viên" sub="Nhập tay hoặc từ CV nhận qua email"
        footer={<><button className="cc-btn ghost" onClick={() => setCandForm(null)}>Hủy</button><button className="cc-btn" onClick={saveCand} disabled={!candForm?.name.trim()}>Thêm ứng viên</button></>}>
        {candForm && <div className="cc-form" style={{ marginTop: 0 }}>
          <Field label="Họ tên *"><input value={candForm.name} onChange={e => setCandForm({ ...candForm, name: e.target.value })} /></Field>
          <Field label="Vị trí ứng tuyển"><select value={candForm.jobId} onChange={e => setCandForm({ ...candForm, jobId: e.target.value })}>{myJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></Field>
          <Field label="Email"><input type="email" value={candForm.email} onChange={e => setCandForm({ ...candForm, email: e.target.value })} /></Field>
          <Field label="Điện thoại"><input value={candForm.phone} onChange={e => setCandForm({ ...candForm, phone: e.target.value })} /></Field>
          <Field label="Nguồn"><select value={candForm.source} onChange={e => setCandForm({ ...candForm, source: e.target.value })}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="CV (PDF/DOCX)"><input type="file" accept=".pdf,.doc,.docx" onChange={e => setCandForm({ ...candForm, cv: e.target.files[0]?.name || '', file: e.target.files[0] || null })} /></Field>
          <Field label="Tóm tắt kinh nghiệm" full><input value={candForm.exp} onChange={e => setCandForm({ ...candForm, exp: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!jobForm} onClose={() => setJobForm(null)} width={620} icon="briefcase" title={jobForm?.id ? 'Sửa tin tuyển dụng' : 'Đăng tin tuyển dụng'}
        footer={<><span className="cc-grow" /><button className="cc-btn ghost" onClick={() => setJobForm(null)}>Hủy</button><button className="cc-btn" onClick={saveJob} disabled={!jobForm?.jdId}>{jobForm?.id ? 'Lưu' : 'Đăng tin'}</button></>}>
        {jobForm && <div className="cc-form" style={{ marginTop: 0 }}>
          <Field label="Vị trí (từ thư viện JD) *" full>
            <select value={jobForm.jdId || ''} onChange={e => pickJd(e.target.value)}>
              <option value="">— Chọn vị trí trong thư viện JD —</option>
              {DEPTS.map(d => {
                const list = jds.filter(x => x.dept === d.key)
                return list.length ? <optgroup key={d.key} label={d.name}>{list.map(x => <option key={x.id} value={x.id}>{x.title} · {x.level}</option>)}</optgroup> : null
              })}
            </select>
          </Field>
          <div className="cc-sub" style={{ gridColumn: "1 / -1", marginTop: -6 }}>
            Không có vị trí cần tuyển? <button type="button" className="cc-link-btn" onClick={() => { setJobForm(null); setTab('jd'); setJdForm({ ...BLANK_JD }) }}>Thêm JD mới vào thư viện</button>
          </div>
          <Field label="Phòng ban"><select value={jobForm.dept} disabled title="Theo JD"><option value={jobForm.dept}>{deptOf(jobForm.dept).name}</option></select></Field>
          <Field label="Số lượng"><input type="number" min="1" value={jobForm.qty} onChange={e => setJobForm({ ...jobForm, qty: Number(e.target.value) })} /></Field>
          <Field label="Nơi làm việc"><select value={jobForm.site} onChange={e => setJobForm({ ...jobForm, site: e.target.value })}><option value="">— Chọn địa điểm —</option>{siteOptions(jobForm.site).map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Mức lương"><input value={jobForm.salary} placeholder="VD: 15–20 triệu" onChange={e => setJobForm({ ...jobForm, salary: e.target.value })} /></Field>
          <Field label="Hạn nộp hồ sơ"><input type="date" value={jobForm.deadline} onChange={e => setJobForm({ ...jobForm, deadline: e.target.value })} /></Field>
          <Field label="Trạng thái"><select value={jobForm.status} onChange={e => setJobForm({ ...jobForm, status: e.target.value })}>{Object.entries(JOB_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
          <div className="cc-f full">
            <span className="cc-f-label">Mô tả công việc <span style={{ fontWeight: 500 }}>— lấy tự động từ thư viện JD</span></span>
            {formJd ? <JdPreview jd={formJd} compact onEdit={() => { setJobForm(null); setTab('jd'); setOpenJd(formJd.id); setJdForm(toJdForm(formJd)) }} />
              : <div className="cc-rows-empty">Chọn vị trí để hiển thị mô tả công việc</div>}
          </div>
          <Field label="Kênh đăng tin" full>
            <div className="cc-checks">{SOURCES.filter(s => s !== 'Giới thiệu nội bộ').map(s => (
              <label key={s}><input type="checkbox" checked={jobForm.channels.includes(s)} onChange={e => setJobForm({ ...jobForm, channels: e.target.checked ? [...jobForm.channels, s] : jobForm.channels.filter(x => x !== s) })} />{s}</label>
            ))}</div>
          </Field>
        </div>}
      </Modal>

      <Modal open={!!ivForm} onClose={() => setIvForm(null)} width={560} icon="calendar" title="Đặt lịch phỏng vấn" sub="Thư mời được gửi tự động tới ứng viên & người phỏng vấn"
        footer={<><button className="cc-btn ghost" onClick={() => setIvForm(null)}>Hủy</button><button className="cc-btn" onClick={saveInterview} disabled={!ivForm?.candidateId}>Đặt lịch</button></>}>
        {ivForm && <div className="cc-form" style={{ marginTop: 0 }}>
          <Field label="Ứng viên" full><select value={ivForm.candidateId} onChange={e => setIvForm({ ...ivForm, candidateId: e.target.value })}><option value="">— Chọn ứng viên —</option>{candidates.filter(c => jobIds.has(c.jobId) && !['hired', 'rejected'].includes(c.stage)).map(c => <option key={c.id} value={c.id}>{c.name} · {jobOf(c.jobId)?.title}</option>)}</select></Field>
          <Field label="Ngày"><input type="date" value={ivForm.date} onChange={e => setIvForm({ ...ivForm, date: e.target.value })} /></Field>
          <Field label="Giờ"><input type="time" value={ivForm.time} onChange={e => setIvForm({ ...ivForm, time: e.target.value })} /></Field>
          <Field label="Vòng"><input value={ivForm.round} onChange={e => setIvForm({ ...ivForm, round: e.target.value })} /></Field>
          <Field label="Người phỏng vấn"><input value={ivForm.interviewer} onChange={e => setIvForm({ ...ivForm, interviewer: e.target.value })} /></Field>
          <Field label="Hình thức"><select value={ivForm.mode} onChange={e => setIvForm({ ...ivForm, mode: e.target.value })}><option>Trực tiếp</option><option>Online</option></select></Field>
          <Field label={ivForm.mode === 'Online' ? 'Link họp' : 'Địa điểm'}><input value={ivForm.place} onChange={e => setIvForm({ ...ivForm, place: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  )
}
