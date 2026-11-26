import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
/* "Admin Kinh doanh" lưu chung mảng assignees (phu_trach) với vai trò này, không cần cột mới */
const ADMIN_KD = 'Admin Kinh doanh'
import {
  LEAD_SOURCES, LEAD_PROVINCES, regionOfProvince, LEAD_PROJECT_TYPES, LEAD_DEPT_OPTIONS,
  LEAD_STAGE_OPTIONS, LEAD_CATEGORY_GROUPS, LEAD_CATEGORIES, BOQ_DEFAULT_LABEL, STAGE_LABEL,
} from '../../../data/kinhDoanhData'
import { lmInitials, findDuplicates, sourceColor, boqOf } from '../utils'
import { uploadRaw, mediaUrl } from '../../QS/api/files'
import ShortlistSelect, { useKdMap, useKdOptions, useMkChannels, saveKdOptions } from './ShortlistSelect'
import AttachBox, { filesOf } from './AttachBox'
import LandCertFields from './LandCertFields'
import { NoteToolbar, noteHotkey } from './RichNote'
import DatePicker from '../../../components/ui/DatePicker'
import { OWNER_GROUPS } from './customer/CdOwners'
const GROUP_LABEL = Object.fromEntries(OWNER_GROUPS.map(g => [g.key, g.label]))

/* ===================== Trang thêm / chỉnh sửa khách hàng tiềm năng =====================
   Bố cục theo mẫu "Form Du an" (2026-11-22): 1 trang cuộn dọc, các khối thẻ đánh số xếp chồng, căn giữa;
   khối Nâng cao thu gọn / mở rộng được (nhớ trong máy). Component được mount sẵn (ẩn bằng display);
   trang cha đổi `key` mỗi lần mở để form nạp lại dữ liệu. */

/* Giá trị ước tính: gõ số tiền đầy đủ (tự chèn dấu chấm nghìn) + đơn vị tiền tệ (mặc định VND); khác VND thì nhập tỷ giá để quy ra VND
   (máy chủ lưu giá trị theo VND - valueVnd). Ô bên phải đọc gọn: "5,1 tỷ VND", "250 nghìn USD" */
const CURRENCIES = [['VND', 1], ['USD', 25500], ['EUR', 27500], ['JPY', 170], ['CNY', 3550]]
const digits_ = s => String(s || '').replace(/[^\d]/g, '')
const groupNum_ = s => { const d = digits_(s); return d ? Number(d).toLocaleString('vi-VN') : '' }
const nf_ = x => (Math.round(x * 100) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
export function moneyWords_(n, cur) {
  n = Number(n) || 0
  const c = cur || 'VND'
  if (!n) return '0 ' + c
  if (n >= 1e9) return nf_(n / 1e9) + ' tỷ ' + c
  if (n >= 1e6) return nf_(n / 1e6) + ' triệu ' + c
  if (n >= 1e3) return nf_(n / 1e3) + ' nghìn ' + c
  return nf_(n) + ' ' + c
}
const closeIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
const chevron = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

/* Tỉnh / Thành phố: 34 tỉnh + "Nước ngoài" (chọn thì gõ quốc gia / thành phố). Khu vực (geo.kv) tự điền theo tỉnh */
const FOREIGN = 'Nước ngoài'
const ALL_TINH = [].concat(...Object.values(LEAD_PROVINCES))

/* Nguồn khách hàng: dữ liệu vẫn là 1 chuỗi form.source ("Facebook Kiến Phong", "Hotline"...); giao diện tách Kênh + Trang / Thương hiệu.
   Kênh "Khác" = chuỗi nguồn không bắt đầu bằng kênh nào (ô Trang giữ nguyên cả chuỗi) */
const SRC_OTHER = 'Khác'
const SRC_CHANNELS = [...[...new Set(['Facebook', 'Zalo', 'TikTok', 'Google', 'Website', 'Hotline', 'Email', 'Giới thiệu', ...LEAD_SOURCES.map(s => String(s).split(' ')[0])])].filter(k => k && k !== SRC_OTHER), SRC_OTHER]
/* Tách theo tiền tố kênh dài nhất khớp "<kênh> " (phân biệt hoa thường) sao cho srcJoin_(srcSplit_(s)) === s: mở khách cũ không sửa thì nguồn giữ nguyên từng ký tự */
function srcSplit_(s, channels) {
  const v = String(s || '')
  if (!v) return { kenh: '', page: '' }
  if (v === SRC_OTHER) return { kenh: SRC_OTHER, page: '' }
  let best = ''
  channels.forEach(k => { if (k && k !== SRC_OTHER && k.length > best.length && (v === k || v.indexOf(k + ' ') === 0)) best = k })
  const page = best ? v.slice(best.length + 1) : ''
  if (!best || (v !== best && !page)) return { kenh: SRC_OTHER, page: v }
  return { kenh: best, page }
}
const srcJoin_ = (kenh, page) => (!kenh || kenh === SRC_OTHER ? (page || kenh || '') : (page ? kenh + ' ' + page : kenh))

/* Khối Nâng cao: trạng thái thu gọn nhớ trong máy */
const ADV_KEY = 'kd-lf-adv-collapsed'

function initForm(lead, me) {
  return {
    name: lead ? lead.name : '',
    phone: lead ? (lead.phone || '') : '',
    email: lead ? (lead.email || '') : '',
    address: lead ? (lead.address || '') : '',
    scale: lead ? (lead.scale || '') : '',
    value: lead && lead.value ? String(Math.round(lead.value * 1e9)) : '',   // số tiền đầy đủ (VND) dạng chữ số
    cur: 'VND',
    rate: '',
    concept: lead ? (lead.concept || '') : '',
    notes: lead ? (lead.notes || '') : '',
    partner: lead ? !!lead.partner : false,
    source: lead && lead.source ? lead.source : LEAD_SOURCES[0],
    dept: lead ? (lead.dept || 'dan-dung') : '',   // tạo mới: phải chọn phòng (MarkUp 2026-11-19)
    creator: lead ? (lead.creator || '') : me,
    manager: lead ? (lead.manager || '') : me,
    type: lead && lead.projectType ? lead.projectType : 'Nhà phố',
    stage: lead ? lead.stage : 'tiep-can',
    categories: lead && lead.categories ? LEAD_CATEGORIES.filter(c => lead.categories.indexOf(c) !== -1) : [],
  }
}

/* Mức quy mô gợi ý (m2 sàn); gõ số tự do thì thẻ kanban tự thêm đơn vị m² */
const LEAD_SCALES = ['Dưới 100 m²', '100 - 200 m²', '200 - 500 m²', '500 - 1.000 m²', '1.000 - 5.000 m²', 'Trên 5.000 m²']

/* Ô nhập dài (Concept, Ghi chú nội bộ): tự giãn cao theo nội dung (tối thiểu ~4 dòng, tối đa 50vh rồi mới cuộn), vẫn kéo giãn dọc tay được.
   active = ô đang hiện (ô bị ẩn thì scrollHeight = 0, đo lại khi hiện).
   Đặt height 'auto' để đo làm khung cuộn chứa ô ngắn lại trong chốc lát -> trình duyệt kéo scrollTop lên (trang nhảy khi đang cuộn gần đáy):
   ghi scrollTop của mọi khung cuộn tổ tiên (và trang) trước khi đo, đặt lại sau khi đặt chiều cao mới */
function AutoTextarea({ value, active, inputRef, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const saved = []
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = window.getComputedStyle(p).overflowY
      if (oy === 'auto' || oy === 'scroll') saved.push([p, p.scrollTop])
    }
    const se = document.scrollingElement
    if (se) saved.push([se, se.scrollTop])
    el.style.height = 'auto'
    const h = el.scrollHeight + el.offsetHeight - el.clientHeight
    el.style.height = Math.min(h, Math.round(window.innerHeight * 0.5)) + 'px'
    saved.forEach(([p, top]) => { if (p.scrollTop !== top) p.scrollTop = top })
  }, [value, active])
  return <textarea ref={el => { ref.current = el; if (inputRef) inputRef.current = el }} className="kd-autogrow" rows={4} value={value} {...rest} />
}

/* Khối thẻ đánh số: vòng số navy + tiêu đề; onToggle = khối thu gọn được (thân vẫn mount, chỉ ẩn, để ô đính kèm đang tải không mất) */
function Sec({ n, title, open = true, onToggle, secRef, children }) {
  const bodyId = useId()
  return (
    <section className="kd-lf-sec" ref={secRef}>
      {onToggle ? (
        <h4 className="kd-lf-sec-h tg">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            <i>{n}</i><span className="t">{title}</span><em>{open ? 'Thu gọn' : 'Mở rộng'}</em>
          </button>
        </h4>
      ) : (
        <div className="kd-lf-sec-h"><i>{n}</i><h4>{title}</h4></div>
      )}
      <div id={bodyId} className="kd-lf-sec-b" style={open ? undefined : { display: 'none' }}>{children}</div>
    </section>
  )
}
/* Hàng nhãn có nút / chú thích bên phải: nút đặt ngoài <label> (label không htmlFor coi nút con là control -> bấm chữ nhãn = bấm nút) */
function Lb({ htmlFor, children, aside }) {
  return <div className="kd-lf-lb"><label htmlFor={htmlFor}>{children}</label>{aside ? <span>{aside}</span> : null}</div>
}

const REASON = { phone: 'trùng SĐT', email: 'trùng email', name: 'trùng tên' }
const ddmmyyyy_ = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '' }
const dupBtn = { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '4px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const plusBtn = { width: 28, height: 28, borderRadius: '50%', border: '1.5px dashed var(--border)', background: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }
const plusIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>

export default function LeadModal({ open, lead, me, leads, onClose, onSave, onOpenLead, onMergeInto }) {
  const mkKenh = useMkChannels() // kênh quảng cáo của tab Marketing: gợi ý thêm cho Trang / Thương hiệu
  const srcExtra = useKdOptions('source')   // nguồn công ty tự thêm (dùng chung tab Tổng quan, Marketing)
  const kenhExtra = useKdOptions('srcKenh') // kênh công ty tự thêm
  const [form, setForm] = useState(() => initForm(lead, me))
  const [boqFile, setBoqFile] = useState(lead ? (lead.boqFile || '') : '')
  const [boqOver, setBoqOver] = useState(false)
  const [assignees, setAssignees] = useState(lead && lead.assignees ? lead.assignees.filter(a => !a || a.role !== ADMIN_KD) : [])
  /* Admin Kinh doanh: nhiều người, mỗi người 1 ô tròn chữ cái đầu (rê chuột = tên), nút "+" mở ô gõ tên */
  const [admins, setAdmins] = useState(lead && lead.assignees ? lead.assignees.filter(a => a && a.role === ADMIN_KD).map(a => a.name) : [])
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminName, setAdminName] = useState('')
  const addAdmin = () => { const n = adminName.trim(); if (n && admins.indexOf(n) < 0) setAdmins(l => [...l, n]); setAdminName(''); setAdminOpen(false) }
  /* Tên dự án (MarkUp 2026-11-16 16:17): máy chủ chưa có cột -> kdOptions.projName {mã lead: tên} như geo */
  const projNameMap = useKdMap('projName')
  const [projName, setProjName] = useState(lead ? projNameMap[String(lead.id)] || '' : '')
  const projNameKey = lead ? projNameMap[String(lead.id)] : null
  useEffect(() => { if (projNameKey && !projName) setProjName(projNameKey) }, [projNameKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Chủ đầu tư (MarkUp 2026-11-19): kdOptions.investor {mã lead: tên} như projName */
  const investorMap = useKdMap('investor')
  const [investor, setInvestor] = useState(lead ? investorMap[String(lead.id)] || '' : '')
  const investorKey = lead ? investorMap[String(lead.id)] : null
  useEffect(() => { if (investorKey && !investor) setInvestor(investorKey) }, [investorKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Người phụ trách bên CĐT (khách Phòng KD Dự Án) = Tên khách hàng; Chức vụ + Phòng ban: kdOptions.cdtContact {mã lead: {role, dept}} */
  const cdtMap = useKdMap('cdtContact')
  const cdtKey = lead ? cdtMap[String(lead.id)] : null
  const [cdt, setCdt] = useState(() => ({ role: (cdtKey && cdtKey.role) || '', dept: (cdtKey && cdtKey.dept) || '' }))
  useEffect(() => { if (cdtKey && !cdt.role && !cdt.dept) setCdt({ role: cdtKey.role || '', dept: cdtKey.dept || '' }) }, [cdtKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [deptWarn, setDeptWarn] = useState(false)
  const isDA = form.dept === 'du-an'
  /* Hình / tệp đính kèm (MarkUp 2026-11-16 16:20) + ảnh sổ đỏ / giấy tờ đất (so):
     kdOptions.attach {mã lead: {img: [{name, url}], file: [...], so: [...]}} */
  const attachMap = useKdMap('attach')
  const [attach, setAttach] = useState(() => { const a = lead ? attachMap[String(lead.id)] || {} : {}; return { img: a.img || [], file: a.file || [], so: a.so || [] } })
  const attachKey = lead ? attachMap[String(lead.id)] : null
  useEffect(() => { if (attachKey && !attach.img.length && !attach.file.length && !attach.so.length) setAttach({ img: attachKey.img || [], file: attachKey.file || [], so: attachKey.so || [] }) }, [attachKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Thời gian dự án (MarkUp 2026-11-16 16:48): kdOptions.timeline {mã lead: {start, end}} (YYYY-MM-DD) như geo */
  const timelineMap = useKdMap('timeline')
  /* Thông số đất (đọc từ ảnh sổ đỏ hoặc gõ tay): kdOptions.land {mã lead: {area, dai, rong, plotNo, mapSheet, purpose, shapeNote, src}} */
  const landMap = useKdMap('land')
  const [land, setLand] = useState(() => (lead ? landMap[String(lead.id)] || {} : {}))
  const landKey = lead ? landMap[String(lead.id)] : null
  const landTouched = useRef(false)
  useEffect(() => { if (landKey && !landTouched.current) setLand(landKey) }, [landKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tl, setTl] = useState(() => { const t = lead ? timelineMap[String(lead.id)] || {} : {}; return { start: t.start || '', end: t.end || '' } })
  const tlKey = lead ? timelineMap[String(lead.id)] : null
  useEffect(() => { if (tlKey && !tl.start && !tl.end) setTl({ start: tlKey.start || '', end: tlKey.end || '' }) }, [tlKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Khu vực + Tỉnh / TP + Phường / Xã: máy chủ chưa có cột -> lưu chung công ty kdOptions.geo {mã lead: {kv, tinh, xa}} (KinhDoanh.saveLead ghi) */
  const geoMap = useKdMap('geo')
  const geo0 = lead ? geoMap[String(lead.id)] || {} : {}
  const [geo, setGeo] = useState({ kv: geo0.kv || '', tinh: geo0.tinh || '', xa: geo0.xa || '' })
  // dữ liệu công ty tải xong sau khi mở form sửa: điền lại nếu chưa tự chọn
  const geoKey = lead ? geoMap[String(lead.id)] : null
  useEffect(() => { if (geoKey && !geo.kv && !geo.tinh && !geo.xa) setGeo({ kv: geoKey.kv || '', tinh: geoKey.tinh || '', xa: geoKey.xa || '' }) }, [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Link Google Maps (geo.map): giữ trạng thái riêng để các nút "Bỏ chọn" tỉnh / phường không xoá mất link */
  const [mapLink, setMapLink] = useState(geo0.map ? String(geo0.map) : '')
  const mapTouched = useRef(false)
  useEffect(() => { if (geoKey && geoKey.map && !mapTouched.current && !mapLink) setMapLink(String(geoKey.map)) }, [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Link Facebook của khách (geo.fb, cùng chỗ lưu với link Google Maps) */
  const [fbLink, setFbLink] = useState(geo0.fb ? String(geo0.fb) : '')
  const fbTouched = useRef(false)
  useEffect(() => { if (geoKey && geoKey.fb && !fbTouched.current && !fbLink) setFbLink(String(geoKey.fb)) }, [geoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const foreign = geo.kv === FOREIGN
  /* Gợi ý Phường / Xã: các phường đã nhập ở khách khác (cùng tỉnh nếu đã chọn tỉnh) */
  const xaBase = useMemo(() => [...new Set(Object.values(geoMap).filter(g => g && g.xa && (!geo.tinh || g.tinh === geo.tinh)).map(g => String(g.xa)))]
    .sort((a, b) => a.localeCompare(b, 'vi')), [geoMap, geo.tinh])
  function pickTinh(t) {
    if (t === FOREIGN) { setGeo(g => (g.kv === FOREIGN ? g : { kv: FOREIGN, tinh: '', xa: '' })); return }
    /* Chọn lại đúng tỉnh cũ: giữ nguyên (khách cũ chỉ có kv). Đổi tỉnh: kv theo tỉnh mới, tỉnh gõ tay ngoài danh sách -> kv rỗng */
    setGeo(g => (t === g.tinh ? g : { kv: regionOfProvince(t) || '', tinh: t, xa: g.tinh && g.tinh !== t ? '' : g.xa }))
  }

  /* Nguồn: Kênh + Trang / Thương hiệu suy ra từ form.source (không giữ trạng thái riêng -> không tự đổi chuỗi nguồn cũ).
     Chữ đầu của kênh Marketing (vd "Instagram Kiến Phong" -> "Instagram") cũng là kênh, để kênh đó hiện đúng nhóm Marketing của ô Trang */
  const kenhBase = useMemo(() => {
    const ks = [...new Set([...SRC_CHANNELS, ...mkKenh.map(s => s.split(' ')[0])])].filter(k => k && k !== SRC_OTHER)
    return [...ks, SRC_OTHER]
  }, [mkKenh])
  const channels = useMemo(() => [...kenhBase, ...kenhExtra.filter(k => kenhBase.indexOf(k) < 0)], [kenhBase, kenhExtra])
  const src = srcSplit_(form.source, channels)
  const srcPages = useMemo(() => {
    const ofK = list => [...new Set(list.map(s => srcSplit_(s, channels)).filter(x => x.kenh === src.kenh && x.page).map(x => x.page))]
    const base = ofK([...LEAD_SOURCES, ...(leads || []).map(l => l && l.source ? String(l.source) : '').filter(Boolean)])
    return { base, extra: ofK(srcExtra).filter(p => base.indexOf(p) < 0), linked: ofK(mkKenh) }
  }, [channels, src.kenh, srcExtra, leads, mkKenh])
  /* Trang mới gõ thêm: lưu cả chuỗi nguồn vào danh sách nguồn công ty (kdOptions.source) như ô Nguồn cũ */
  const addSrcPage = p => { const s = srcJoin_(src.kenh, p); if (srcExtra.indexOf(s) < 0 && LEAD_SOURCES.indexOf(s) < 0) saveKdOptions('source', [...srcExtra, s]) }
  const removeSrcPage = p => { const s = srcJoin_(src.kenh, p); saveKdOptions('source', srcExtra.filter(x => x !== s)) }

  const [advOpen, setAdvOpen] = useState(() => { try { return localStorage.getItem(ADV_KEY) !== '1' } catch { return true } })
  function toggleAdv() {
    const n = !advOpen
    setAdvOpen(n)
    try { localStorage.setItem(ADV_KEY, n ? '0' : '1') } catch { /* bỏ qua */ }
  }

  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigneeName, setAssigneeName] = useState('')
  const [assigneeRole, setAssigneeRole] = useState('')
  /* Nhóm phụ trách (assignees[].dept: kinhdoanh / ctv / concept / thietke / nhathau), khối Phụ trách trang khách hàng gom theo nhóm này */
  const [assigneeDept, setAssigneeDept] = useState('kinhdoanh')
  const [catPos, setCatPos] = useState(null) // vị trí popover hạng mục (null = đóng)
  const [nameFocusTick, setNameFocusTick] = useState(0)
  const [nameWarn, setNameWarn] = useState(false)
  /* Lỗi khi lưu (kiểm trước ở máy hoặc máy chủ trả về): {field, msg} - field = ô bị tô đỏ; msg hiện đỏ ở thanh dưới */
  const [saveErr, setSaveErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const errOn = f => !!saveErr && saveErr.field === f
  const uid = useId()
  const fid = k => uid + k
  const [assigneeFocusTick, setAssigneeFocusTick] = useState(0)
  const nameRef = useRef(null)
  const deptRef = useRef(null)
  const sec1Ref = useRef(null)
  const assigneeNameRef = useRef(null)
  const imgBoxRef = useRef(null)
  const fileBoxRef = useRef(null)
  /* Số tệp đang tải lên ở 2 ô đính kèm: còn tệp chưa tải xong thì chưa cho lưu / gộp (lưu lúc đó sẽ mất tệp) */
  const [imgBusy, setImgBusy] = useState(0)
  const [fileBusy, setFileBusy] = useState(0)
  const [soBusy, setSoBusy] = useState(0)
  const [boqBusy, setBoqBusy] = useState(0)
  const [boqErr, setBoqErr] = useState('')
  const boqInputRef = useRef(null)
  const notesRef = useRef(null)
  const uploading = imgBusy + fileBusy + soBusy + boqBusy > 0
  const UPLOAD_WAIT = 'Đang tải tệp đính kèm lên, vui lòng đợi xong rồi lưu'

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const scrollTo = ref => { if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' }) }

  /* Báo trùng khách (SĐT / email = chắc chắn, tên = có thể); đang sửa thì bỏ chính lead này */
  const dups = useMemo(() => findDuplicates({ phone: form.phone, email: form.email, name: form.name }, leads, lead ? lead.id : null), [form.phone, form.email, form.name, leads, lead])
  const strongDups = dups.filter(d => d.by.some(x => x !== 'name'))

  /* Dán (Ctrl+V) khi khối Nâng cao đang mở: ảnh -> ô Hình, tệp khác -> ô Tệp (ô đính kèm đang focus / rê chuột tự nhận trước, xem AttachBox).
     Đang gõ trong ô chữ mà clipboard có chữ thì để dán chữ như thường */
  useEffect(() => {
    if (!open || !advOpen) return
    const onPaste = e => {
      if (e.defaultPrevented) return
      const cd = e.clipboardData
      const fs = filesOf(cd)
      if (!fs.length) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName)) && cd.getData('text/plain')) return
      e.preventDefault()
      const isImg = f => String(f.type || '').indexOf('image/') === 0
      const imgs = fs.filter(isImg)
      const others = fs.filter(f => !isImg(f))
      if (imgs.length && imgBoxRef.current) imgBoxRef.current.add(imgs)
      if (others.length && fileBoxRef.current) fileBoxRef.current.add(others)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open, advOpen])

  /* Form đang mở: thả tệp trượt ra ngoài ô đính kèm thì không để trình duyệt mở tệp (ô đính kèm tự preventDefault nên bỏ qua) */
  useEffect(() => {
    if (!open) return
    const guard = e => {
      if (e.defaultPrevented || !e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') < 0) return
      e.preventDefault()
      if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [open])

  useEffect(() => { if (nameFocusTick && nameRef.current) nameRef.current.focus() }, [nameFocusTick])
  useEffect(() => { if (assigneeFocusTick && assigneeNameRef.current) assigneeNameRef.current.focus() }, [assigneeFocusTick])

  /* Bấm ra ngoài → đóng 2 popover; cuộn trang (khung cuộn bất kỳ) → đóng popover hạng mục */
  useEffect(() => {
    const closeAll = () => { setAssigneeOpen(false); setAdminOpen(false); setCatPos(null) }
    const closeCat = () => setCatPos(null)
    document.addEventListener('click', closeAll)
    document.addEventListener('scroll', closeCat, true)
    return () => {
      document.removeEventListener('click', closeAll)
      document.removeEventListener('scroll', closeCat, true)
    }
  }, [])

  /* BOQ: tải file thật lên /upload/file (như Hình / Tệp đính kèm), lưu "<url>#<tên gốc>" vào boqFile */
  function pickBoq() { if (!boqBusy && boqInputRef.current) boqInputRef.current.click() }
  async function uploadBoq(f) {
    if (!f) return
    setBoqErr('')
    if (!/\.(xlsx|xls|pdf)$/i.test(f.name || '')) { setBoqErr('"' + f.name + '" không phải file BOQ (chỉ nhận .xlsx, .xls, .pdf)'); return }
    setBoqBusy(1)
    try {
      const r = await uploadRaw(f)
      if (r && r.url) setBoqFile(r.url + '#' + f.name)
      else setBoqErr('Không tải được "' + f.name + '"')
    } catch (e) {
      setBoqErr('Không tải được "' + f.name + '": ' + ((e && e.message) || e))
    } finally { setBoqBusy(0) }
  }

  function toggleAssigneePopover(e) {
    e.stopPropagation()
    setAssigneeName(''); setAssigneeRole(''); setAssigneeDept('kinhdoanh')
    if (!assigneeOpen) setAssigneeFocusTick(t => t + 1)
    setAssigneeOpen(!assigneeOpen)
  }
  /* Người mới chưa có since: máy chủ tự điền ngày nhận phụ trách; người cũ giữ nguyên object (since, dept) */
  function addAssignee() {
    const name = assigneeName.trim()
    const role = assigneeRole.trim()
    if (!name) { assigneeNameRef.current.focus(); return }
    setAssignees(list => [...list, { name, role, dept: assigneeDept }])
    setAssigneeName(''); setAssigneeRole('')
    assigneeNameRef.current.focus()
  }

  function toggleCatPopover(e) {
    e.stopPropagation()
    if (catPos) { setCatPos(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setCatPos({ left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.min(420, window.innerHeight - r.bottom - 16) })
  }
  function toggleCat(value, checked) {
    setForm(f => {
      const has = f.categories.indexOf(value) !== -1
      if (checked === has) return f
      /* Giữ thứ tự theo danh sách checkbox như bản HTML (querySelectorAll('.lm-cat:checked')) */
      const next = checked ? [...f.categories, value] : f.categories.filter(c => c !== value)
      return { ...f, categories: LEAD_CATEGORIES.filter(c => next.indexOf(c) !== -1) }
    })
  }

  /* geo gửi đi: chỉ thêm khoá xa / map / fb khi có (khách cũ giữ đúng dạng {kv, tinh}) */
  const geoOut = () => {
    const g = geo.xa ? { kv: geo.kv || '', tinh: geo.tinh || '', xa: geo.xa } : { kv: geo.kv || '', tinh: geo.tinh || '' }
    const m = mapLink.trim()
    if (m) g.map = m
    const f = fbLink.trim()
    if (f) g.fb = f
    return g
  }
  /* Link Google Maps chỉ nhận http(s) (chặn javascript: ...) */
  const mapOk = s => /^https?:\/\/[^\s]+$/i.test(s)
  const mapTrim = mapLink.trim()
  const mapBad = () => {
    if (!mapTrim || mapOk(mapTrim)) return false
    showErr('map', 'Link Google Maps không hợp lệ: phải bắt đầu bằng http:// hoặc https://')
    return true
  }
  const fbTrim = fbLink.trim()
  const fbBad = () => {
    if (!fbTrim || mapOk(fbTrim)) return false
    showErr('fb', 'Link Facebook không hợp lệ: phải bắt đầu bằng http:// hoặc https:// (vd https://facebook.com/ten.khach)')
    return true
  }
  const mapsQuery = [form.address.trim(), foreign ? '' : geo.xa, geo.tinh].filter(Boolean).join(', ')
  const openUrl = u => { try { window.open(u, '_blank', 'noopener,noreferrer') } catch { /* bỏ qua */ } }
  /* Giá trị dự án quy ra tỷ VND (dùng chung cho Lưu và Gộp vào khách cũ) */
  const valueTy = () => (Number(digits_(form.value)) || 0) * (form.cur === 'VND' ? 1 : (Number(digits_(form.rate)) || (CURRENCIES.find(c => c[0] === form.cur) || [0, 1])[1])) / 1e9
  /* Gộp vào khách cũ: gửi mọi thông tin đã nhập, KinhDoanh.mergeIntoLead điền chỗ trống / ghi lịch sử chăm sóc */
  function mergeInto(id) {
    if (uploading) { alert(UPLOAD_WAIT); return }
    if (mapBad() || fbBad()) return
    const type = form.type || ''
    onMergeInto(id, {
      source: form.source,
      phone: form.phone.trim(),
      email: form.email.trim(),
      name: form.name.trim(),
      notes: form.notes.trim(),
      concept: form.concept.trim(),
      address: form.address.trim(),
      projName: projName.trim(),
      geo: geoOut(),
      projectType: type,
      scale: form.scale.trim(),
      value: valueTy(),
      categories: form.categories.slice(),
      timeline: { start: tl.start || '', end: tl.end || '' },
      attach: { img: attach.img.slice(), file: attach.file.slice(), so: attach.so.slice() },
      land: { ...land },
    })
  }
  /* Câu báo lỗi của máy chủ -> ô tương ứng trên form */
  const fieldOfErr = m => {
    const s = String(m || '')
    if (/Giá trị/i.test(s)) return 'value'
    if (/Phòng kinh doanh/i.test(s)) return 'dept'
    if (/tên khách/i.test(s)) return 'name'
    if (/Giai đoạn/i.test(s)) return 'stage'
    if (/phụ trách|Nhóm phụ trách/i.test(s)) return 'assignees'
    if (/Ngày/i.test(s)) return 'timeline'
    if (/dự án QS/i.test(s)) return 'value'
    return ''
  }
  const fieldRefs = useRef({})
  const fref = k => el => { if (el) fieldRefs.current[k] = el }
  const showErr = (field, msg) => {
    setSaveErr({ field, msg })
    const el = field === 'dept' ? deptRef.current : fieldRefs.current[field]
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function save() {
    if (uploading) { alert(UPLOAD_WAIT); return }
    if (saving) return
    setSaveErr(null)
    if (!form.dept) { setDeptWarn(true); scrollTo(deptRef); return }
    const name = form.name.trim()
    if (!name) { setNameWarn(true); setNameFocusTick(t => t + 1); return }
    if (mapBad() || fbBad()) return
    if (!lead && strongDups.length && !window.confirm('Khách này trùng SĐT/email với: '
      + strongDups.slice(0, 5).map(d => d.lead.name + (d.lead.source ? ' (' + d.lead.source + ')' : '')).join(', ') + (strongDups.length > 5 ? '...' : '')
      + '\nVẫn lưu thành lead mới? (Bấm Huỷ để quay lại, có thể Gộp vào khách cũ)')) { scrollTo(sec1Ref); return }
    /* Giá trị ước tính: máy chủ nhận tối đa 100 triệu tỷ đồng (1e17) */
    const vnd = Math.round(valueTy() * 1e9)
    if (!(vnd >= 0) || vnd > 1e17) {
      showErr('value', 'Giá trị ước tính không hợp lệ: số quá lớn (tối đa 100.000.000 tỷ VND). Kiểm tra lại ô Giá trị ước tính' + (form.cur !== 'VND' ? ' và Tỷ giá.' : '.'))
      return
    }
    const type = form.type || 'Chưa xác định'
    const scale = form.scale.trim()
    /* Tên đã gõ trong popover nhưng chưa bấm "Thêm" vẫn được lưu */
    const pendingName = assigneeName.trim()
    const finalAssignees = pendingName ? [...assignees, { name: pendingName, role: assigneeRole.trim(), dept: assigneeDept }] : assignees.slice()
    const pendingAdmin = adminName.trim()
    /* Admin KD đã có giữ since cũ */
    const adminSince = {}
    ;(lead && lead.assignees || []).forEach(a => { if (a && a.role === ADMIN_KD && a.since && !adminSince[a.name]) adminSince[a.name] = a.since })
    ;[...admins, ...(pendingAdmin && admins.indexOf(pendingAdmin) < 0 ? [pendingAdmin] : [])].forEach(n => finalAssignees.push(adminSince[n] ? { name: n, role: ADMIN_KD, since: adminSince[n] } : { name: n, role: ADMIN_KD }))
    setSaving(true)
    Promise.resolve(onSave({
      name,
      _geo: geoOut(),
      _projName: projName.trim(),
      _investor: isDA ? investor.trim() : '',   // CĐT chỉ có ở khách Phòng KD Dự Án; đổi sang Dân dụng thì xoá
      _cdt: isDA ? { role: cdt.role.trim(), dept: cdt.dept.trim() } : { role: '', dept: '' },
      _attach: attach,
      _timeline: tl,
      _land: land,
      type: scale ? `${type} (${scale})` : type,
      value: valueTy(),   // quy ra tỷ VND
      stage: !lead && form.stage === 'tiep-can' && finalAssignees.some(a => a && a.role !== ADMIN_KD) ? 'giao-ns' : form.stage,   // tạo mới đã có nhân sự KD phụ trách -> vào thẳng giai đoạn "Nhân sự KD phụ trách"
      dept: form.dept || 'dan-dung',
      creator: form.creator.trim(),
      manager: form.manager.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      source: form.source,
      address: form.address.trim(),
      projectType: type,
      scale,
      categories: form.categories,
      boqFile,
      concept: form.concept.trim(),
      notes: form.notes.trim(),
      partner: form.partner,
      assignees: finalAssignees,
    })).then(() => setSaving(false), e => {
      setSaving(false)
      const msg = (e && e.message) || String(e)
      showErr(fieldOfErr(msg), 'Không lưu được: ' + msg)
    })
  }

  const stageInOptions = LEAD_STAGE_OPTIONS.some(([v]) => v === form.stage)
  const rateDefault = (CURRENCIES.find(c => c[0] === form.cur) || [0, 1])[1]

  return (
    <>
      {/* Trang đầy đủ trong vùng nội dung (thay cho hộp nổi): thay chỗ các tab, nút Quay lại / ✕ để về */}
      <div style={{ display: open ? 'block' : 'none' }}>
        <div className="kd-lf">
          <div className="kd-lf-head">
            <button type="button" className="kd-lf-back" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>Quay lại
            </button>
            <div className="kd-lf-title">
              <b>{lead ? 'Chỉnh sửa lead' : 'Thêm khách hàng tiềm năng'}</b>
              <span>Điền thông tin theo từng khối - càng đầy đủ, hồ sơ chuyển giao sang thi công càng chính xác.</span>
            </div>
            <button type="button" className="kd-lf-x" title="Đóng" onClick={onClose}>{closeIcon}</button>
          </div>

          {/* ---- 1. Thông tin khách hàng: Phòng KD (bắt buộc khi tạo mới) + tên, dự án, SĐT, email; khách Dự Án thêm Chủ đầu tư / Chức vụ / Phòng ban ---- */}
          <Sec n={1} title="Thông tin khách hàng" secRef={sec1Ref}>
            <div ref={deptRef} className={'kd-lf-dept' + (deptWarn && !form.dept ? ' warn' : '')}>
              <span className="lb">Phòng ban phụ trách dự án <b className="kd-req">*</b></span>
              <div className="opts" role="radiogroup" aria-label="Phòng kinh doanh" aria-required="true" aria-invalid={deptWarn && !form.dept ? true : undefined}>
                {LEAD_DEPT_OPTIONS.map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={form.dept === v} className={form.dept === v ? 'on' : undefined}
                    onClick={() => { set('dept', v); setDeptWarn(false) }}>
                    <i aria-hidden="true" />
                    <span><b>{label}</b><em>{v === 'du-an' ? 'Có Chủ đầu tư, người phụ trách, chức vụ, phòng ban bên CĐT' : 'Khách lẻ: nhà ở, căn hộ, nhà phố'}</em></span>
                  </button>
                ))}
              </div>
              {deptWarn && !form.dept ? <span className="msg">Chọn phòng kinh doanh trước khi lưu</span> : null}
            </div>
            <div className="kd-lf-g2">
              <div className="kd-field">
                <label htmlFor={fid('name')}>{isDA ? 'Người phụ trách (bên CĐT)' : 'Tên khách hàng'} <b className="kd-req">*</b></label>
                <input ref={nameRef} id={fid('name')} type="text" placeholder="VD: Anh Nguyễn Văn Phú" value={form.name} required
                  aria-invalid={nameWarn && !form.name.trim() ? true : undefined} aria-describedby={nameWarn && !form.name.trim() ? fid('nameMsg') : undefined}
                  onChange={e => set('name', e.target.value)} />
                {nameWarn && !form.name.trim() ? <span className="kd-lf-msg" id={fid('nameMsg')}>{isDA ? 'Nhập tên người phụ trách trước khi lưu' : 'Nhập tên khách hàng trước khi lưu'}</span> : null}
              </div>
              <div className="kd-field"><label htmlFor={fid('proj')}>Tên dự án</label><input id={fid('proj')} type="text" placeholder="VD: Nhà phố Anh Phú - Thủ Đức" value={projName} onChange={e => setProjName(e.target.value)} /></div>
              <div className="kd-field"><label htmlFor={fid('phone')}>Số điện thoại</label><input id={fid('phone')} type="text" placeholder="09xx xxx xxx (nhiều số: cách nhau dấu phẩy)" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
              <div className="kd-field"><label htmlFor={fid('email')}>Email</label><input id={fid('email')} type="text" placeholder="khachhang@email.com" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            </div>
            {isDA && (
              <div className="kd-lf-sub">
                <b>Bên chủ đầu tư</b>
                <div className="kd-lf-g3">
                  <div className="kd-field"><label htmlFor={fid('inv')}>Chủ đầu tư</label><input id={fid('inv')} type="text" placeholder="VD: Công ty CP Đầu tư ABC" value={investor} onChange={e => setInvestor(e.target.value)} /></div>
                  <div className="kd-field"><label htmlFor={fid('role')}>Chức vụ</label><input id={fid('role')} type="text" placeholder="VD: Trưởng ban quản lý dự án" value={cdt.role} onChange={e => setCdt(c => ({ ...c, role: e.target.value }))} /></div>
                  <div className="kd-field"><label htmlFor={fid('cdtDept')}>Phòng ban phụ trách</label><input id={fid('cdtDept')} type="text" placeholder="VD: Ban QLDA" value={cdt.dept} onChange={e => setCdt(c => ({ ...c, dept: e.target.value }))} /></div>
                </div>
              </div>
            )}
            {/* Cảnh báo khách trùng: đỏ = trùng SĐT / email, vàng = chỉ trùng tên */}
            {dups.length ? (() => {
              const c = strongDups.length ? 'var(--danger, #dc2626)' : 'var(--warning, #d97706)'
              return (
                <div style={{ border: '1px solid color-mix(in srgb, ' + c + ' 40%, transparent)', background: 'color-mix(in srgb, ' + c + ' 8%, transparent)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: c, fontWeight: 700, fontSize: 12.5 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    Có thể trùng khách hàng
                  </div>
                  {dups.slice(0, 5).map(({ lead: d, by }) => {
                    const sc = sourceColor(d.source)
                    const strong = by.some(x => x !== 'name')
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                        <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <b style={{ color: 'var(--text)' }}>{d.name}</b>
                          {d.phone ? <span style={{ color: 'var(--text-muted)' }}>{d.phone}</span> : null}
                          {d.source ? <span style={{ padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600, ...(sc ? { color: sc.color, background: sc.bg, border: '1px solid ' + sc.border } : { border: '1px solid var(--border)' }) }}>{d.source}</span> : null}
                          {STAGE_LABEL[d.stage] ? <span style={{ color: 'var(--text-muted)' }}>· {STAGE_LABEL[d.stage]}</span> : null}
                          {d.createdAt ? <span style={{ color: 'var(--text-muted)' }}>· {ddmmyyyy_(d.createdAt)}</span> : null}
                          {d.creator ? <span style={{ color: 'var(--text-muted)' }}>· {d.creator}</span> : null}
                          <span style={{ color: strong ? 'var(--danger, #dc2626)' : 'var(--warning, #d97706)', fontWeight: 600 }}>({by.map(x => REASON[x]).join(', ')})</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                          {onOpenLead ? <button type="button" style={dupBtn} onClick={() => onOpenLead(d.id)}>Mở khách cũ</button> : null}
                          {!lead && onMergeInto ? (
                            <button type="button" style={{ ...dupBtn, border: 'none', background: 'var(--sales)', color: '#fff' }}
                              onClick={() => mergeInto(d.id)}>Gộp vào khách này</button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                  {dups.length > 5 ? <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>+{dups.length - 5} khách khác</div> : null}
                </div>
              )
            })() : null}
          </Sec>

          {/* ---- 2. Nguồn khách hàng: Kênh + Trang / Thương hiệu, ghép lại thành form.source ---- */}
          <Sec n={2} title="Nguồn khách hàng">
            <div className="kd-lf-g2">
              <div className="kd-field"><label>Kênh</label>
                <ShortlistSelect value={src.kenh} onChange={k => { if (k !== src.kenh) set('source', srcJoin_(k, '')) }} base={kenhBase} optKey="srcKenh" placeholder="Chọn kênh" />
              </div>
              <div className="kd-field">
                <Lb aside={src.page && src.kenh !== SRC_OTHER ? <button type="button" title="Chỉ giữ kênh" onClick={() => set('source', srcJoin_(src.kenh, ''))}>Bỏ chọn</button> : null}>Trang / Thương hiệu</Lb>
                <ShortlistSelect value={src.page} free onChange={p => set('source', srcJoin_(src.kenh, p))}
                  base={srcPages.base} items={srcPages.extra} onAdd={addSrcPage} onRemove={removeSrcPage} optKey="source"
                  linked={srcPages.linked} linkedLabel="Marketing"
                  placeholder={src.kenh === SRC_OTHER ? 'Gõ tên nguồn' : 'Chọn hoặc gõ trang / thương hiệu'} />
              </div>
            </div>
          </Sec>

          {/* ---- 3. Địa chỉ: Tỉnh / TP (Nước ngoài -> gõ quốc gia), Phường / Xã, Địa chỉ cả dòng; Khu vực tự điền theo tỉnh ---- */}
          <Sec n={3} title="Địa chỉ">
            <div className="kd-lf-g2">
              <div className="kd-field">
                <Lb aside={geo.kv || geo.tinh ? (
                  <>
                    {geo.kv && !foreign ? <em>Khu vực: {geo.kv}</em> : null}
                    <button type="button" title="Xoá tỉnh / thành phố, phường / xã và khu vực" onClick={() => setGeo({ kv: '', tinh: '', xa: '' })}>Bỏ chọn</button>
                  </>
                ) : null}>Tỉnh / Thành phố</Lb>
                <ShortlistSelect value={foreign ? FOREIGN : geo.tinh} free optKey="tinhKhac" base={[...ALL_TINH, FOREIGN]} placeholder="Chọn tỉnh / thành phố" onChange={pickTinh} />
              </div>
              {foreign ? (
                <div className="kd-field"><label>Quốc gia / Thành phố</label>
                  <ShortlistSelect value={geo.tinh} free optKey="nuocNgoai" base={[]} placeholder="Gõ quốc gia / thành phố" onChange={t => setGeo(g => ({ ...g, tinh: t }))} />
                </div>
              ) : (
                <div className="kd-field">
                  <Lb aside={geo.xa ? <button type="button" title="Xoá phường / xã" onClick={() => setGeo(g => ({ ...g, xa: '' }))}>Bỏ chọn</button> : null}>Phường / Xã</Lb>
                  {/* items / onAdd rỗng: phường gõ mới chỉ chọn cho khách này, không ghi vào danh sách chung công ty (gợi ý = phường đã nhập ở khách cùng tỉnh) */}
                  <ShortlistSelect value={geo.xa} free optKey="phuongXa" base={xaBase} items={[]} onAdd={() => {}} placeholder="Chọn hoặc gõ phường / xã" onChange={x => setGeo(g => ({ ...g, xa: x }))} />
                </div>
              )}
              <div className="kd-field"><label htmlFor={fid('addr')}>Địa chỉ</label><input id={fid('addr')} type="text" placeholder="Số nhà, tên đường" value={form.address} onChange={e => set('address', e.target.value)} /></div>
              <div ref={fref('map')} className={'kd-field' + (errOn('map') ? ' kd-lf-err' : '')}>
                <Lb htmlFor={fid('map')} aside={(
                  <>
                    {mapsQuery ? <button type="button" title={'Tìm "' + mapsQuery + '" trên Google Maps (tab mới), rồi dán link vào ô này'}
                      onClick={() => openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapsQuery))}>Tìm trên Maps</button> : null}
                    {mapTrim && mapOk(mapTrim) ? <button type="button" title="Mở link Google Maps (tab mới)" onClick={() => openUrl(mapTrim)}>Mở</button> : null}
                  </>
                )}>Link Google Maps</Lb>
                <input id={fid('map')} type="url" inputMode="url" placeholder="Dán link Google Maps (https://maps.app.goo.gl/...)" value={mapLink}
                  aria-invalid={errOn('map') || undefined} aria-describedby={errOn('map') ? fid('mapMsg') : undefined}
                  onChange={e => { mapTouched.current = true; setMapLink(e.target.value); if (errOn('map')) setSaveErr(null) }} />
                {errOn('map') ? <span className="kd-lf-msg" id={fid('mapMsg')} role="alert">{saveErr.msg}</span> : null}
              </div>
              <div ref={fref('fb')} className={'kd-field' + (errOn('fb') ? ' kd-lf-err' : '')}>
                <Lb htmlFor={fid('fb')} aside={fbTrim && mapOk(fbTrim) ? <button type="button" title="Mở link Facebook (tab mới)" onClick={() => openUrl(fbTrim)}>Mở</button> : null}>Link Facebook</Lb>
                <input id={fid('fb')} type="url" inputMode="url" placeholder="Dán link Facebook của khách (https://facebook.com/...)" value={fbLink}
                  aria-invalid={errOn('fb') || undefined} aria-describedby={errOn('fb') ? fid('fbMsg') : undefined}
                  onChange={e => { fbTouched.current = true; setFbLink(e.target.value); if (errOn('fb')) setSaveErr(null) }} />
                {errOn('fb') ? <span className="kd-lf-msg" id={fid('fbMsg')} role="alert">{saveErr.msg}</span> : null}
              </div>
            </div>
          </Sec>

          {/* ---- 4. Dự án ---- */}
          <Sec n={4} title="Dự án">
            <div className="kd-lf-g2">
              <div className="kd-field"><label>Loại dự án</label>
                <ShortlistSelect value={form.type} onChange={v => set('type', v)} base={LEAD_PROJECT_TYPES} optKey="projectType" placeholder="Chọn loại dự án" />
              </div>
              <div ref={fref('stage')} className={'kd-field' + (errOn('stage') ? ' kd-lf-err' : '')}><label htmlFor={fid('stage')}>Giai đoạn hiện tại</label>
                <select id={fid('stage')} value={form.stage} onChange={e => set('stage', e.target.value)}>
                  {/* Lead đang ở giai đoạn ngoài các lựa chọn (VD: Dự án thiết kế): ô chọn để trống, nhưng giữ nguyên giai đoạn khi lưu */}
                  {!stageInOptions && <option value={form.stage} hidden />}
                  {LEAD_STAGE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div className="kd-field"><label id={fid('catLb')}>Hạng mục quan tâm</label>
                <button type="button" aria-labelledby={fid('catLb') + ' ' + fid('catV')} className={'kd-lf-pick' + (catPos ? ' on' : '')} onClick={toggleCatPopover} title={form.categories.join(', ') || undefined}
                  aria-haspopup="listbox" aria-expanded={!!catPos}>
                  <span id={fid('catV')} className={form.categories.length ? '' : 'ph'}>{form.categories.length ? form.categories.join(', ') : 'Chọn hạng mục...'}</span>
                  {chevron}
                </button>
              </div>
              {/* Quy mô dự án (MarkUp 2026-11-16 16:21): chọn mức có sẵn hoặc gõ số m2 */}
              <div className="kd-field"><label>Quy mô dự án</label>
                <ShortlistSelect value={form.scale} free onChange={v => set('scale', v)} base={LEAD_SCALES} optKey="scale" placeholder="Chọn hoặc gõ số m² (VD: 120)" />
              </div>
              <div ref={fref('value')} className={'kd-field kd-lf-full' + (errOn('value') ? ' kd-lf-err' : '')}><label htmlFor={fid('value')}>Giá trị ước tính</label>
                <div className="kd-money">
                  <input id={fid('value')} type="text" inputMode="numeric" placeholder="VD: 5.100.000.000" value={groupNum_(form.value)} aria-invalid={errOn('value') || undefined} onChange={e => { set('value', digits_(e.target.value)); if (errOn('value')) setSaveErr(null) }} />
                  <select value={form.cur} onChange={e => set('cur', e.target.value)} title="Đơn vị tiền tệ" aria-label="Đơn vị tiền tệ">
                    {CURRENCIES.map(([c]) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="words" title="Đọc gọn">{moneyWords_(digits_(form.value), form.cur)}</span>
                </div>
                {form.cur !== 'VND' && (
                  <div className="kd-money-rate">
                    <span>Tỷ giá 1 {form.cur} =</span>
                    <input type="text" inputMode="numeric" placeholder={rateDefault.toLocaleString('vi-VN')} value={groupNum_(form.rate)} onChange={e => set('rate', digits_(e.target.value))} />
                    <span>VND · ≈ {moneyWords_((Number(digits_(form.value)) || 0) * (Number(digits_(form.rate)) || rateDefault), 'VND')}</span>
                  </div>
                )}
              </div>
            </div>
          </Sec>

          {/* ---- 5. Thời gian dự án ---- */}
          <Sec n={5} title="Thời gian dự án">
            <div className="kd-lf-g2">
              <div ref={fref('timeline')} className={'kd-field' + (errOn('timeline') ? ' kd-lf-err' : '')}><label>Thời gian khởi công</label>
                <DatePicker value={tl.start} onChange={v => setTl(t => ({ ...t, start: v || '' }))} max={tl.end || undefined} clearable ariaLabel="Thời gian khởi công" />
              </div>
              <div className="kd-field"><label>Thời gian hoàn công</label>
                <DatePicker value={tl.end} onChange={v => setTl(t => ({ ...t, end: v || '' }))} min={tl.start || undefined} clearable ariaLabel="Thời gian hoàn công" />
              </div>
            </div>
          </Sec>

          {/* ---- 6. Phụ trách (không có trong mẫu, giữ chức năng cũ) ---- */}
          <Sec n={6} title="Phụ trách">
            <div className="kd-lf-g2">
              {/* Quản lý: mặc định người tạo, chọn trong danh sách công ty tự thêm hoặc gõ tay */}
              <div className="kd-field"><label>Quản lý</label>
                <ShortlistSelect value={form.manager} onChange={v => set('manager', v)} free optKey="manager" placeholder="Trưởng phòng ban phụ trách" base={[]} />
              </div>
              {/* Người khởi tạo = chủ tài khoản đang đăng nhập (lead cũ giữ người đã tạo), không sửa */}
              <div className="kd-field"><label>Người khởi tạo</label><input type="text" readOnly title="Chủ tài khoản tạo lead" value={form.creator} style={{ opacity: 0.85, cursor: 'default' }} /></div>
              <div ref={fref('assignees')} className={'kd-field' + (errOn('assignees') ? ' kd-lf-err' : '')} style={{ position: 'relative' }}>
                <label>Nhân sự phụ trách</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 38 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6 }}>
                    {assignees.map((a, i) => (
                      <span className="kd-lm-assignee-chip" key={i}>
                        <span className="kd-aa-avatar">{lmInitials(a.name)}</span>
                        {a.name}{a.role || GROUP_LABEL[a.dept] ? <span className="kd-aa-role">· {[GROUP_LABEL[a.dept], a.role].filter(Boolean).join(' - ')}</span> : null}
                        <button type="button" className="kd-aa-remove" title="Xoá" onClick={() => setAssignees(list => list.filter((_, idx) => idx !== i))}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                  <button type="button" title="Thêm người phụ trách" onClick={toggleAssigneePopover} style={plusBtn}>{plusIcon}</button>
                </div>
                <div className="kd-lm-assignee-popover" style={{ display: assigneeOpen ? 'flex' : 'none', top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') addAssignee() }}>
                  <input type="text" ref={assigneeNameRef} placeholder="Họ tên" value={assigneeName} onChange={e => setAssigneeName(e.target.value)} />
                  <input type="text" placeholder="Vai trò (VD: Sale phụ trách, Kỹ thuật...)" value={assigneeRole} onChange={e => setAssigneeRole(e.target.value)} />
                  <select aria-label="Nhóm phụ trách" title="Nhóm phụ trách" value={assigneeDept} onChange={e => setAssigneeDept(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit' }}>
                    {OWNER_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button type="button" className="kd-lm-assignee-btn" onClick={() => setAssigneeOpen(false)}>Đóng</button>
                    <button type="button" className="kd-lm-assignee-btn primary" onClick={addAssignee}>Thêm</button>
                  </div>
                </div>
              </div>
              <div className="kd-field" style={{ position: 'relative' }}>
                <label>Admin Kinh doanh</label>
                <div className="kd-lm-admins" style={{ minHeight: 38 }}>
                  {admins.map(n => (
                    <span key={n} className="kd-lm-admin" title={n}>
                      {lmInitials(n)}
                      <button type="button" title={'Bỏ ' + n} onClick={() => setAdmins(l => l.filter(x => x !== n))}>×</button>
                    </span>
                  ))}
                  <button type="button" title="Thêm admin kinh doanh" onClick={e => { e.stopPropagation(); setAdminOpen(o => !o) }} style={plusBtn}>{plusIcon}</button>
                </div>
                <div className="kd-lm-assignee-popover" style={{ display: adminOpen ? 'flex' : 'none', top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 6 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') addAdmin() }}>
                  <input type="text" placeholder="Họ tên admin kinh doanh" value={adminName} onChange={e => setAdminName(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button type="button" className="kd-lm-assignee-btn" onClick={() => setAdminOpen(false)}>Đóng</button>
                    <button type="button" className="kd-lm-assignee-btn primary" onClick={addAdmin}>Thêm</button>
                  </div>
                </div>
              </div>
            </div>
          </Sec>

          {/* ---- 7. Nâng cao (thu gọn được) ---- */}
          <Sec n={7} title="Nâng cao" open={advOpen} onToggle={toggleAdv}>
            <div className="kd-field">
              <label>BOQ (Bảng khối lượng dự toán)</label>
              {/* Tải file thật lên máy chủ: bấm chọn file hoặc kéo thả (.xlsx, .xls, .pdf) */}
              <input ref={boqInputRef} type="file" accept=".xlsx,.xls,.pdf" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; uploadBoq(f) }} />
              <div className={'kd-lf-boq' + (boqOver ? ' over' : '') + (boqBusy ? ' busy' : '')} role="button" tabIndex={0} onClick={pickBoq} aria-busy={boqBusy > 0 || undefined}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickBoq() } }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!boqOver) setBoqOver(true) }}
                onDragLeave={() => setBoqOver(false)}
                onDrop={e => { e.preventDefault(); setBoqOver(false); const f = filesOf(e.dataTransfer)[0]; if (f) uploadBoq(f) }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <span>{boqBusy ? 'Đang tải file BOQ lên…' : boqFile ? <b>📎 {(boqOf(boqFile) || {}).name}</b> : BOQ_DEFAULT_LABEL}</span>
              </div>
              {boqFile && !boqBusy ? (
                <div className="kd-lf-boq-acts">
                  {(boqOf(boqFile) || {}).url ? <a href={mediaUrl(boqOf(boqFile).url)} target="_blank" rel="noopener noreferrer">Mở file</a> : <em>Bản cũ chỉ có tên file (chưa tải lên), bấm ô trên để tải file thật</em>}
                  <button type="button" onClick={pickBoq}>Đổi file</button>
                  <button type="button" className="danger" onClick={() => { setBoqFile(''); setBoqErr('') }}>Gỡ</button>
                </div>
              ) : null}
              {boqErr ? <span className="kd-lf-msg" role="alert">{boqErr}</span> : null}
            </div>
            {/* Concept | Hình đính kèm | Tệp đính kèm trên 1 hàng (MarkUp 2026-11-16 16:20), màn hẹp tự xuống dòng */}
            <div className="kd-lf-adv3">
              <div className="kd-field"><label>Concept / Ý tưởng thiết kế</label><AutoTextarea active={open && advOpen} rows={3} placeholder="Mô tả phong cách, ý tưởng thiết kế mong muốn của khách hàng..." value={form.concept} onChange={e => set('concept', e.target.value)} /></div>
              <AttachBox ref={imgBoxRef} kind="img" label="Hình đính kèm" items={attach.img} onChange={img => setAttach(a => ({ ...a, img }))} onBusy={setImgBusy} />
              <AttachBox ref={fileBoxRef} kind="file" label="Tệp đính kèm" items={attach.file} onChange={file => setAttach(a => ({ ...a, file }))} onBusy={setFileBusy} />
            </div>
            {/* Ảnh sổ đỏ / giấy tờ đất: riêng với Hình đính kèm để hồ sơ hiện thành mục Sổ đỏ */}
            <div className="kd-lf-so">
              <AttachBox kind="img" label="Ảnh sổ đỏ / giấy tờ đất" items={attach.so} onChange={so => setAttach(a => ({ ...a, so }))} onBusy={setSoBusy} />
              <LandCertFields soItems={attach.so} value={land} onChange={x => { landTouched.current = true; setLand(x) }} />
            </div>
            <div className="kd-field"><label>Ghi chú nội bộ</label>
              <div className="rn-wrap">
                <AutoTextarea active={open && advOpen} inputRef={notesRef} placeholder="Ghi chú cho đội kinh doanh / kỹ thuật... (bôi đen chữ rồi bấm B để in đậm)" value={form.notes}
                  onChange={e => set('notes', e.target.value)} onKeyDown={e => noteHotkey(e, form.notes, v => set('notes', v))} />
                <NoteToolbar taRef={notesRef} value={form.notes} onChange={v => set('notes', v)} />
              </div>
            </div>
            <label className="kd-lf-check">
              <input type="checkbox" checked={form.partner} onChange={e => set('partner', e.target.checked)} />
              Chuyển giao cho đối tác thi công/thiết kế ngoài
            </label>
          </Sec>

          {/* Thanh lưu dính đáy khung cuộn */}
          <div className="kd-lf-foot">
            {saveErr ? <span className="hint kd-lf-errmsg" role="alert">{saveErr.msg}</span> : <span className="hint">{uploading ? UPLOAD_WAIT : (!advOpen && (attach.img.length || attach.file.length || attach.so.length) ? 'Nâng cao (đang thu gọn): ' + [attach.img.length ? attach.img.length + ' hình' : '', attach.file.length ? attach.file.length + ' tệp' : '', attach.so.length ? attach.so.length + ' ảnh sổ đỏ' : ''].filter(Boolean).join(', ') : (isDA ? 'Phòng ban và người phụ trách (bên CĐT) là bắt buộc' : 'Phòng ban và tên khách hàng là bắt buộc'))}</span>}
            <div className="acts">
              <button type="button" className="kd-lf-btn" onClick={onClose}>Huỷ</button>
              <button type="button" className={'kd-lf-btn pri' + (uploading ? ' busy' : '')} onClick={save} title={uploading ? UPLOAD_WAIT : undefined} aria-disabled={uploading || saving}>
                {uploading ? 'Đang tải tệp…' : saving ? 'Đang lưu…' : (lead ? 'Lưu thay đổi' : 'Lưu khách hàng')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Popover hạng mục: định vị fixed theo nút bấm */}
      <div
        className="kd-lm-cat-popover"
        onClick={e => e.stopPropagation()}
        style={catPos ? { display: 'block', left: catPos.left, width: catPos.width, top: catPos.top, maxHeight: catPos.maxHeight } : { display: 'none' }}
      >
        {LEAD_CATEGORY_GROUPS.map((g, gi) => (
          <Fragment key={g.title}>
            <div className="kd-lm-cat-group-title" style={gi > 0 ? { marginTop: 8 } : undefined}>{g.title}</div>
            {g.items.map(c => (
              <label className="kd-lm-cat-option" key={c}>
                <input type="checkbox" value={c} checked={form.categories.indexOf(c) !== -1} onChange={e => toggleCat(c, e.target.checked)} /> {c}
              </label>
            ))}
          </Fragment>
        ))}
      </div>
    </>
  )
}
