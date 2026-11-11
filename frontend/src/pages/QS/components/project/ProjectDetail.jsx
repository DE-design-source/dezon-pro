import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import ProductThumb from '../common/ProductThumb'
import ImgViewer from '../common/ImgViewer'
import * as api from '../../api/qsApi'
import { mediaUrl } from '../../api/files'
import { safeUrl_, money } from '../../lib/format.js'
import { dezonUrl_ } from '../../lib/dashModel.js'
import { qsToast as toast } from '../common/dialogs'
import { HeroSlider, ImageManager } from './ProjectImages'
import { nodeName } from '../../lib/tree.js'
import { uploadRaw } from '../../api/files'
import { qsAsk } from '../common/dialogs'
import { resolveProjectEdit, editProjectForm } from './projectActions'

/* Trang chi tiết 1 dự án (mở từ trang Danh sách dự án, tham khảo trang dự án của dezon.vn):
   tên dự án ở đầu trang · ảnh công trình của dự án (dữ liệu phụ 'anhDuAn', trình chiếu như dezon.vn; chưa có thì bấm để thêm) · tab Thông tin (bảng thông tin 2 cột nhãn IN HOA : giá trị + giới thiệu) / Hình ảnh / Sản phẩm /
   Nhà cung cấp / Dự án liên quan. Dữ liệu: thông tin dự án + các dòng báo giá (api.getLines).
   Props: p (dự án), projects (để tìm dự án liên quan), onBack(), onOpenBoc(p), onOpen(p) (mở dự án liên quan). */
const kv_ = x => { const a = String(x.diaChi || '').split(',').map(t => t.trim()).filter(Boolean); return a.length ? a[a.length - 1] : '' }
const img1 = v => (v ? mediaUrl(String(v).split('\n')[0].trim()) : '')
const s_ = v => String(v == null ? '' : v).trim()
const TABS = [['info', 'Thông tin'], ['img', 'Hình ảnh'], ['sp', 'Sản phẩm'], ['ncc', 'Nhà cung cấp'], ['rel', 'Dự án liên quan'], ['boq', 'BOQ']]
/* Ngành hàng của 1 dòng = đề mục cấp 3 của cây hạng mục (3.2.5 Thiết bị vệ sinh, 3.2.6 Thiết bị điện…); đề mục ngắn hơn giữ nguyên */
const nganh_ = l => { const c = s_(l.nhom); if (!c) return ''; const a = c.split('.'); return a.length > 3 ? a.slice(0, 3).join('.') : c }
/* Thu gọn module (ảnh / thông tin) nhớ trong máy */
const FOLD_LS = 'qs_pd_fold'
const foldGet = () => { try { return JSON.parse(localStorage.getItem(FOLD_LS) || '{}') || {} } catch (e) { return {} } }
const foldSet = v => { try { localStorage.setItem(FOLD_LS, JSON.stringify(v)) } catch (e) { /* bỏ qua */ } }
const BOQ_ACCEPT = '.xlsx,.xls,.csv,.pdf'
/* Khối Thông tin cơ bản + bảng Thông tin: [nhãn, khoá, kiểu] - cùng 1 bảng cho xem và sửa tại chỗ (nút Sửa thông tin / Yêu cầu sửa).
   Khu vực (khoá null) tự lấy từ đoạn cuối Địa điểm, Mã dự án (kiểu 'ma') tự tạo khi nhập: cả hai không sửa được. Hàng 'edit' chỉ hiện khi sửa (VAT, link Dezon). */
const TRANG_THAI = ['Bản nháp', 'Đang thực hiện', 'Hoàn thành']
/* Thông tin cơ bản (như trang dự án dezon.vn, 2 cột nhãn : giá trị, đọc theo hàng): Công ty = cột studio (migration 0038);
   Nhóm thiết kế / Nhiếp ảnh gia / Nhà thầu thi công / Năm hoàn thiện = migration 0039. Còn lại là Thông tin nâng cao */
const BASIC_ROWS = [
  ['Dự án', 'ten'], ['Công ty', 'studio'],
  ['Địa điểm', 'diaChi'], ['Nhóm thiết kế', 'nhomThietKe'],
  ['Kiến trúc sư', 'kienTrucSu'], ['Nhiếp ảnh gia', 'nhiepAnhGia'],
  ['Nhà thầu thi công', 'nhaThauThiCong'], ['Năm hoàn thiện', 'namHoanThien', 'nam'],
  ['Khu vực', null], ['Mã dự án', 'maDA', 'ma'],
]
const INFO_ROWS = [
  ['Mã báo giá', 'maBaoGia'],
  ['Khách hàng', 'khachHang'], ['Điện thoại', 'sdt'],
  ['Phân khúc', 'phanKhuc'], ['Quy mô', 'quyMo'],
  ['Tổng diện tích', 'tongDT', 'm2'], ['Diện tích báo giá', 'dtBaoGia', 'm2'],
  ['Trạng thái', 'trangThai', 'tt'], ['Tiến độ', 'tienDo', 'pct'],
  ['VAT', 'vat', 'vat', 'edit'], ['Link Dezon', 'linkDezon', 'url', 'edit'],
]
const INTRO_ROWS = [['Nhu cầu', 'nhuCau', 'Nhu cầu của khách hàng'], ['Hiện trạng', 'hienTrang', 'Hiện trạng công trình / mặt bằng (in trên tờ bìa báo giá)'], ['Ghi chú', 'ghiChu', 'Ghi chú cho bản nháp này']]
/* Nhãn của từng khoá (phiếu yêu cầu sửa hiện cũ -> mới) */
const FIELD_LABELS = {}
const ALL_ROWS = BASIC_ROWS.concat(INFO_ROWS, INTRO_ROWS)
ALL_ROWS.forEach(r => { if (r[1]) FIELD_LABELS[r[1]] = r[0] })
const draftOf_ = p => {
  const o = {}
  ALL_ROWS.forEach(r => { if (r[1]) o[r[1]] = s_(p[r[1]]) })
  o.tienDo = Number(p.tienDo) || 0
  o.vat = s_(p.vat === '' || p.vat == null ? 0 : p.vat)
  if (TRANG_THAI.indexOf(o.trangThai) < 0) o.trangThai = TRANG_THAI[0]
  return o
}
/* Chế độ xem tab Sản phẩm (nhớ trong máy): Bảng · Lưới thẻ · Theo tầng (bảng gom nhóm theo tầng, có tổng từng tầng) */
const SP_VIEWS = [['table', 'Bảng', 'table'], ['grid', 'Lưới thẻ', 'grid'], ['floor', 'Theo tầng', 'layers']]
const SPV_LS = 'qs_pd_spview'
const spvGet = () => { try { const v = localStorage.getItem(SPV_LS); return SP_VIEWS.some(x => x[0] === v) ? v : 'table' } catch (e) { return 'table' } }

export default function ProjectDetail({ p, projects, onBack, onOpenBoc, onOpen }) {
  const [lines, setLines] = useState(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('info')
  const [view, setView] = useState('')
  const [anh, setAnh] = useState(null)          // ảnh công trình (mảng URL), null = đang tải
  const fileRef = useRef(null)
  const [fold, setFoldSt] = useState(foldGet)
  const toggleFold = k => setFoldSt(f => { const n = { ...f, [k]: !f[k] }; foldSet(n); return n })
  const [nganh, setNganh] = useState('')        // lọc tab Sản phẩm theo ngành hàng
  const [nccOpen, setNccOpen] = useState('')    // tab Nhà cung cấp: thẻ đang mở danh sách sản phẩm
  const [spv, setSpvSt] = useState(spvGet)
  const setSpv = v => { setSpvSt(v); try { localStorage.setItem(SPV_LS, v) } catch (e) { /* bỏ qua */ } }
  const [boq, setBoq] = useState(null)          // file BOQ đính kèm (mảng {url, name, at})
  const [boqBusy, setBoqBusy] = useState(0)
  const boqRef = useRef(null)
  /* Sửa thông tin (migration 0037): người duyệt lưu thẳng, người khác gửi yêu cầu; phiếu chờ duyệt của dự án hiện ở đầu trang */
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(null)              // bản nháp đang sửa (cùng khoá với INFO_ROWS / INTRO_ROWS)
  const [lyDo, setLyDo] = useState('')
  const [saving, setSaving] = useState(false)
  const setFld = k => e => { const v = e.target.value; setF(x => ({ ...x, [k]: v })) }
  /* Thông tin nâng cao (tab Thông tin, dưới khối cơ bản): mặc định thu gọn, nhớ trong máy; bấm sửa thì mở. Giới thiệu luôn hiện */
  const advOpen = !!fold.advOpen
  const startEdit = () => {
    setF(draftOf_(p)); setLyDo(''); setTab('info'); setEditing(true)
    if (!fold.advOpen) toggleFold('advOpen')
  }
  async function saveEdit() {
    if (saving) return
    setSaving(true)
    const r = await editProjectForm(p, f, lyDo)
    setSaving(false)
    if (r) { setEditing(false); loadYc() }
  }
  const [yc, setYc] = useState({ canApprove: false, items: [], err: '' })
  const [ycBusy, setYcBusy] = useState(0)
  const loadYc = () => api.listProjectEditRequests(p.maDA, 'pending').then(
    r => setYc({ canApprove: !!(r && r.canApprove), items: (r && r.items) || [], err: '' }),
    e => setYc(y => ({ ...y, items: [], err: String((e && e.message) || e) })))
  useEffect(() => { setEditing(false); setF(null); loadYc() }, [p.maDA])   // eslint-disable-line react-hooks/exhaustive-deps
  async function resolveYc(r, approve) {
    let lyDo = ''
    if (!approve) {
      lyDo = await qsAsk({ title: 'Từ chối yêu cầu sửa', label: 'Lý do từ chối (tuỳ chọn)', placeholder: 'Gửi kèm thông báo cho người yêu cầu', ok: 'Từ chối' })
      if (lyDo == null) return
    }
    setYcBusy(r.id)
    await resolveProjectEdit(r.id, approve, lyDo)
    setYcBusy(0)
    loadYc()
  }
  useEffect(() => {
    let alive = true
    setLines(null); setErr(''); setTab('info')
    setAnh(null); setBoq(null); setNganh('')
    api.getProjData(p.maDA).then(d => {
      if (!alive) return
      setAnh(Array.isArray(d && d.anhDuAn) ? d.anhDuAn : [])
      setBoq(Array.isArray(d && d.boqFiles) ? d.boqFiles : [])
    }, () => { if (alive) { setAnh([]); setBoq([]) } })
    api.getLines(p.maDA).then(ls => { if (alive) setLines(ls || []) }, e => { if (alive) { setErr(String((e && e.message) || e)); setLines([]) } })
    return () => { alive = false }
  }, [p.maDA])

  const ls = lines || []
  const imgs = useMemo(() => { const seen = {}; const out = []; ls.forEach(l => { const u = img1(l.hinhAnh); if (u && !seen[u]) { seen[u] = 1; out.push(u) } }); return out }, [lines])   // eslint-disable-line react-hooks/exhaustive-deps
  const tong = ls.reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0)
  const ncc = useMemo(() => {
    const m = {}
    ls.forEach(l => { const k = s_(l.thuongHieu) || 'Chưa rõ thương hiệu'; const o = m[k] || (m[k] = { ten: k, n: 0, sl: 0, tong: 0 }); o.n++; o.sl += Number(l.soLuong) || 0; o.tong += Number(l.thanhTienBan) || 0 })
    return Object.values(m).sort((a, b) => b.tong - a.tong)
  }, [lines])   // eslint-disable-line react-hooks/exhaustive-deps
  const related = (projects || []).filter(x => x.maDA !== p.maDA && ((s_(p.khachHang) && s_(x.khachHang) === s_(p.khachHang)) || (kv_(p) && kv_(x) === kv_(p))))
  const link = s_(p.linkDezon)
  const pics = anh || []
  async function saveAnh(list) {
    const old = anh
    setAnh(list)
    try { await api.setProjData(p.maDA, 'anhDuAn', list) } catch (e) { setAnh(old); toast('Lỗi lưu ảnh dự án: ' + ((e && e.message) || e)) }
  }
  /* chưa có ảnh: bấm ô ảnh đầu trang -> sang tab Hình ảnh + mở hộp chọn file */
  const addPics = () => { setTab('img'); setTimeout(() => { if (fileRef.current) fileRef.current.click() }, 0) }

  /* Giá trị hiển thị của 1 hàng (xem) */
  const infoVal = r => {
    const k = r[1]
    if (!k) return kv_(p)
    const v = s_(p[k])
    if (r[2] === 'm2') return v ? v + ' m²' : ''
    if (r[2] === 'pct') return p.tienDo != null && p.tienDo !== '' ? (Number(p.tienDo) || 0) + '%' : ''
    if (r[2] === 'tt') return v || 'Bản nháp'
    return v
  }
  /* Ô sửa của 1 hàng (sửa tại chỗ) */
  const infoInput = r => {
    const k = r[1]
    if (!k) return <input value={kv_({ diaChi: f.diaChi })} readOnly tabIndex={-1} placeholder="Tự lấy từ Địa điểm" />
    if (r[2] === 'ma') return <input value={s_(p[k])} readOnly tabIndex={-1} title="Mã tự tạo khi nhập dự án, không sửa được" />
    if (r[2] === 'tt') return <select value={f.trangThai} onChange={setFld('trangThai')}>{TRANG_THAI.map(o => <option key={o}>{o}</option>)}</select>
    if (r[2] === 'pct') return <span className="rg"><input type="range" min="0" max="100" value={f.tienDo} onChange={setFld('tienDo')} /><b>{f.tienDo}%</b></span>
    if (r[2] === 'vat') return <span className="un"><input type="number" min="0" max="100" value={f.vat} onChange={setFld('vat')} /><i>%</i></span>
    if (r[2] === 'm2') return <span className="un"><input inputMode="decimal" value={f[k]} onChange={setFld(k)} /><i>m²</i></span>
    const ph = r[2] === 'url' ? 'https://dezon.vn/…' : r[2] === 'nam' ? 'VD: 2025' : k === 'nhomThietKe' ? 'Các thành viên, cách nhau dấu phẩy' : 'Chưa có'
    return <input type={r[2] === 'url' ? 'url' : 'text'} inputMode={r[2] === 'nam' ? 'numeric' : undefined} value={f[k]} onChange={setFld(k)} autoFocus={k === 'ten'}
      placeholder={ph} className={k === 'ten' && !f.ten.trim() ? 'invalid' : ''} />
  }
  /* Ngành hàng có trong dự án + số dòng */
  const nganhList = useMemo(() => {
    const m = {}
    ls.forEach(l => { const k = nganh_(l); m[k] = (m[k] || 0) + 1 })
    return Object.keys(m).sort().map(k => [k, k ? nodeName(k) : 'Khác', m[k]])
  }, [lines])   // eslint-disable-line react-hooks/exhaustive-deps
  const lsShown = nganh ? ls.filter(l => nganh_(l) === (nganh === '__khac' ? '' : nganh)) : ls
  async function saveBoq(list) {
    const old = boq
    setBoq(list)
    try { await api.setProjData(p.maDA, 'boqFiles', list) } catch (e) { setBoq(old); toast('Lỗi lưu file BOQ: ' + ((e && e.message) || e)) }
  }
  async function addBoq(files) {
    const ok = [...files].filter(f => /\.(xlsx|xls|csv|pdf)$/i.test(f.name))
    if (!ok.length) { toast('Chỉ nhận file Excel (.xlsx, .xls, .csv) hoặc PDF'); return }
    setBoqBusy(ok.length)
    const added = []
    for (const f of ok) {
      try { const r = await uploadRaw(f); if (r && r.url) added.push({ url: r.url, name: f.name, at: new Date().toISOString() }) } catch (e) { toast('Tải "' + f.name + '" lỗi: ' + e.message) }
      setBoqBusy(n => n - 1)
    }
    if (added.length) { await saveBoq([...(boq || []), ...added]); toast('Đã thêm ' + added.length + ' file BOQ') }
  }
  const intro = [['Nhu cầu', p.nhuCau], ['Hiện trạng', p.hienTrang], ['Ghi chú', p.ghiChu]].filter(x => s_(x[1]))

  /* 1 ô của lưới thông tin: xem = giá trị (trống -> "—"), sửa = ô nhập. Trạng thái hiện dạng nhãn, Tiến độ có thanh */
  const kvItem = r => {
    const k = r[1]
    const wide = r[2] === 'url'
    if (editing) return <div key={r[0]} className={'kv' + (wide ? ' wide' : '')}><dt>{r[0]}{k === 'ten' ? ' *' : ''}</dt><dd>{infoInput(r)}</dd></div>
    const v = infoVal(r)
    let body = v || '—'
    if (v && r[2] === 'tt') body = <span className="pill">{v}</span>
    if (v && r[2] === 'pct') body = <span className="prog"><span className="tr"><i style={{ width: Math.min(100, Math.max(0, Number(p.tienDo) || 0)) + '%' }} /></span><b>{v}</b></span>
    return <div key={r[0]} className={'kv' + (wide ? ' wide' : '')}><dt>{r[0]}</dt><dd className={v ? (k === 'ten' ? 'main' : '') : 'nil'}>{body}</dd></div>
  }
  const advRows = editing ? INFO_ROWS : INFO_ROWS.filter(r => r[3] !== 'edit')
  const advFilled = advRows.filter(r => infoVal(r) && !(r[2] === 'tt' && !s_(p.trangThai)) && !(r[2] === 'pct' && !(Number(p.tienDo) > 0))).length
  const showVal = (k, v) => (s_(v) ? (k === 'tienDo' || k === 'vat' ? s_(v) + '%' : s_(v)) : '(trống)')

  return (
    <div className="qs-pd">
      <div className="qs-pd-top">
        <button type="button" className="qs-pd-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Danh sách dự án</button>
        <span style={{ flex: 1 }} />
        {link && <a className="qs-pd-btn" href={safeUrl_(dezonUrl_(link))} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} /> Xem trên Dezon.vn</a>}
        {editing ? (
          <>
            <button type="button" className="qs-pd-btn" disabled={saving} onClick={() => setEditing(false)}>Huỷ</button>
            <button type="button" className="qs-pd-btn primary" disabled={saving || !f.ten.trim()} onClick={saveEdit}>
              <Icon name={yc.canApprove ? 'check' : 'send'} size={14} />
              {saving ? (yc.canApprove ? 'Đang lưu…' : 'Đang gửi…') : (yc.canApprove ? 'Lưu thông tin' : 'Gửi yêu cầu sửa')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="qs-pd-btn" title={yc.canApprove ? 'Sửa thông tin dự án (lưu thẳng, áp dụng ngay)' : 'Gửi yêu cầu sửa thông tin - Admin / người có quyền duyệt xem xét'}
              onClick={startEdit}>
              <Icon name="edit" size={14} /> {yc.canApprove ? 'Sửa thông tin' : 'Yêu cầu sửa'}
            </button>
            <button type="button" className="qs-pd-btn primary" onClick={() => onOpenBoc(p)}><Icon name="table" size={14} /> Mở ở Bóc tách</button>
          </>
        )}
      </div>

      <div className="qs-pd-title">
        <h1>{p.ten}</h1>
        <span className="st">{p.trangThai || 'Bản nháp'}</span>
        {lines != null && <span className="sum"><b>{ls.length}</b> dòng báo giá{tong > 0 ? <> · <b>{money(tong)} đ</b></> : null}</span>}
      </div>

      {editing && (
        <div className={`qs-pd-editbar${yc.canApprove ? ' ok' : ''}`}>
          <Icon name={yc.canApprove ? 'check' : 'clock'} size={15} />
          <span>{yc.canApprove
            ? 'Đang sửa tại tab Thông tin - bạn có quyền duyệt: lưu xong áp dụng ngay, mọi người đều thấy thông tin mới.'
            : 'Đang soạn yêu cầu sửa tại tab Thông tin - gửi tới Admin / người có quyền duyệt; dự án giữ thông tin cũ cho tới khi được duyệt.'}</span>
          {!yc.canApprove && <input value={lyDo} maxLength={500} onChange={e => setLyDo(e.target.value)} placeholder="Lý do / ghi chú cho người duyệt (tuỳ chọn)" />}
        </div>
      )}

      {yc.items.length > 0 && (
        <section className="qs-pd-yc">
          <div className="h"><Icon name="clock" size={15} /><b>{yc.items.length} yêu cầu sửa đang chờ duyệt</b>
            {!yc.canApprove && <span>Thông tin bên dưới vẫn là bản cũ cho tới khi được duyệt</span>}</div>
          {yc.items.map(r => (
            <div key={r.id} className="qs-pd-yci">
              <div className="who"><b>{r.requester || 'Không rõ'}</b><small>{r.at ? new Date(r.at).toLocaleString('vi-VN') : ''}</small>
                {r.lyDo ? <i>"{r.lyDo}"</i> : null}</div>
              <dl>
                {Object.keys(r.changes || {}).map(k => (
                  <div key={k}><dt>{FIELD_LABELS[k] || k}</dt>
                    <dd><s>{showVal(k, (r.oldValues || {})[k])}</s><Icon name="arrowRight" size={13} /><b>{showVal(k, r.changes[k])}</b></dd></div>
                ))}
              </dl>
              {yc.canApprove && (
                <div className="act">
                  <button type="button" className="qs-pd-btn" disabled={ycBusy === r.id} onClick={() => resolveYc(r, false)}><Icon name="x" size={14} /> Từ chối</button>
                  <button type="button" className="qs-pd-btn primary" disabled={ycBusy === r.id} onClick={() => resolveYc(r, true)}><Icon name="check" size={14} /> Duyệt &amp; áp dụng</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className={`qs-pd-mod${fold.img ? ' folded' : ''}`}>
        <button type="button" className="qs-pd-modh" aria-expanded={!fold.img} onClick={() => toggleFold('img')}>
          <span>Hình ảnh dự án{pics.length ? <small>{pics.length} ảnh</small> : null}</span><Icon name="chevronUp" size={16} />
        </button>
        {!fold.img && (anh == null ? <div className="qs-pd-hero empty"><span>Đang tải ảnh dự án…</span></div>
          : <HeroSlider list={pics} onAdd={addPics} onView={setView} />)}
      </section>

      <div className="qs-pd-tabs" role="tablist">
        {TABS.map(t => {
          const n = t[0] === 'img' ? pics.length : t[0] === 'sp' ? ls.length : t[0] === 'ncc' ? ncc.length : t[0] === 'rel' ? related.length : t[0] === 'boq' ? (ls.length ? 1 : 0) + (boq || []).length : null
          return <button type="button" role="tab" key={t[0]} aria-selected={tab === t[0]} className={tab === t[0] ? 'on' : ''} onClick={() => setTab(t[0])}>{t[1]}{n ? <small>{n}</small> : null}</button>
        })}
      </div>
      {err && <div className="qs-pd-err">Lỗi tải dòng báo giá: {err}</div>}

      {tab === 'info' && (
        <div className="qs-pd-sec">
          {/* 1 thẻ Thông tin dự án: hàng Thông tin cơ bản (nổi bật) + Thông tin nâng cao (thu gọn được); cùng lưới nhãn trên / giá trị dưới */}
          <div className={`qs-pd-card${editing ? ' editing' : ''}`}>
            <section className="qs-pd-cardsec basic" aria-label="Thông tin cơ bản">
              <div className="qs-pd-cardh"><span className="ic"><Icon name="building" size={16} /></span><h3>Thông tin cơ bản</h3></div>
              <dl className="qs-pd-kv basic">{BASIC_ROWS.map(kvItem)}</dl>
            </section>
            <section className={`qs-pd-cardsec adv${advOpen ? ' open' : ''}`} aria-label="Thông tin nâng cao">
              <button type="button" className="qs-pd-cardh tog" aria-expanded={advOpen} onClick={() => toggleFold('advOpen')}>
                <span className="ic"><Icon name="sliders" size={16} /></span><h3>Thông tin nâng cao</h3>
                {!editing && <span className="cnt">{advFilled}/{advRows.length} mục đã có</span>}
                <span className="more">{advOpen ? 'Thu gọn' : 'Mở rộng'}<Icon name={advOpen ? 'chevronUp' : 'chevronDown'} size={15} /></span>
              </button>
              {advOpen && <dl className="qs-pd-kv basic">{advRows.map(kvItem)}</dl>}
            </section>
          </div>
          {editing ? (
            <div className="qs-pd-introedit">
              {INTRO_ROWS.map(r => (
                <label key={r[1]}><h3>{r[0]}</h3><textarea value={f[r[1]]} onChange={setFld(r[1])} placeholder={r[2]} /></label>
              ))}
            </div>
          ) : intro.length ? intro.map(x => <div key={x[0]} className="qs-pd-intro"><h3>{x[0]}</h3><p>{x[1]}</p></div>)
            : <div className="qs-pd-empty">Chưa có phần giới thiệu (Nhu cầu / Hiện trạng / Ghi chú) — bấm {yc.canApprove ? 'Sửa thông tin' : 'Yêu cầu sửa'} để nhập.</div>}
        </div>
      )}
      {tab === 'img' && (
        <div className="qs-pd-sec">
          {anh == null ? <div className="qs-pd-empty">Đang tải…</div> : <ImageManager list={pics} onSave={saveAnh} onView={setView} inputRef={fileRef} spImgs={ls.map(l => l.hinhAnh)} />}
        </div>
      )}
      {tab === 'sp' && (
        <div className="qs-pd-sec">
          <div className="qs-pd-spbar">
          {nganhList.length > 1 ? (
            <div className="qs-pd-nganh" role="group" aria-label="Lọc theo ngành hàng">
              <button type="button" className={!nganh ? 'on' : ''} onClick={() => setNganh('')}>Tất cả<small>{ls.length}</small></button>
              {nganhList.map(g => (
                <button type="button" key={g[0] || '__khac'} className={nganh === (g[0] || '__khac') ? 'on' : ''} title={g[0] ? g[0] + '. ' + g[1] : 'Dòng chưa có đề mục'}
                  onClick={() => setNganh(g[0] || '__khac')}>{g[1]}<small>{g[2]}</small></button>
              ))}
            </div>
          ) : <span />}
            <div className="qs-pd-spv" role="group" aria-label="Chế độ xem sản phẩm">
              {SP_VIEWS.map(v => (
                <button type="button" key={v[0]} className={spv === v[0] ? 'on' : ''} title={'Xem dạng ' + v[1]} onClick={() => setSpv(v[0])}>
                  <Icon name={v[2]} size={15} /><span>{v[1]}</span>
                </button>
              ))}
            </div>
          </div>
          {ls.length ? (spv === 'grid' ? (
            <div className="qs-pd-spgrid">
              {lsShown.map(l => (
                <div key={l.lineId} className="qs-pd-spcard">
                  <button type="button" className="img" onClick={() => l.hinhAnh && setView(img1(l.hinhAnh))}><ProductThumb product={l} size={150} src={img1(l.hinhAnh)} /></button>
                  <b title={l.ten}>{l.ten}</b>
                  <span className="br">{[l.thuongHieu, l.tang || 'Chưa phân tầng'].filter(Boolean).join(' · ')}</span>
                  <div className="ft"><span>SL <b>{Number(l.soLuong) || 0}</b> × {money(l.donGiaBan)}</span><b className="tt">{money(l.thanhTienBan)} đ</b></div>
                </div>
              ))}
            </div>
          ) : spv === 'floor' ? (
            <div className="qs-pd-sp">
              <div className="qs-pd-sprow head"><span>Ảnh</span><span>Sản phẩm</span><span>Thương hiệu</span><span>Tầng</span><span className="r">SL</span><span className="r">Đơn giá</span><span className="r">Thành tiền</span></div>
              {(() => {
                const g = {}; const ord = []
                lsShown.forEach(l => { const k = s_(l.tang) || 'Chưa phân tầng'; if (!g[k]) { g[k] = []; ord.push(k) } g[k].push(l) })
                return ord.map(k => (
                  <div key={k} className="qs-pd-spgrp">
                    <div className="qs-pd-spgh"><b>{k}</b><span>{g[k].length} dòng</span><b className="t">{money(g[k].reduce((t, l) => t + (Number(l.thanhTienBan) || 0), 0))} đ</b></div>
                    {g[k].map(l => (
                <div key={l.lineId} className="qs-pd-sprow">
                  <ProductThumb product={l} size={44} src={img1(l.hinhAnh)} onClick={l.hinhAnh ? () => setView(img1(l.hinhAnh)) : undefined} />
                  <span className="nm" title={l.ten}>{l.ten}</span>
                  <span>{l.thuongHieu || '—'}</span>
                  <span>{l.tang || 'Chưa phân tầng'}</span>
                  <span className="r">{Number(l.soLuong) || 0}</span>
                  <span className="r">{money(l.donGiaBan)}</span>
                  <span className="r b">{money(l.thanhTienBan)}</span>
                </div>
                    ))}
                  </div>
                ))
              })()}
            </div>
          ) : (
            <div className="qs-pd-sp">
              <div className="qs-pd-sprow head"><span>Ảnh</span><span>Sản phẩm</span><span>Thương hiệu</span><span>Tầng</span><span className="r">SL</span><span className="r">Đơn giá</span><span className="r">Thành tiền</span></div>
              {lsShown.map(l => (
                <div key={l.lineId} className="qs-pd-sprow">
                  <ProductThumb product={l} size={44} src={img1(l.hinhAnh)} onClick={l.hinhAnh ? () => setView(img1(l.hinhAnh)) : undefined} />
                  <span className="nm" title={l.ten}>{l.ten}</span>
                  <span>{l.thuongHieu || '—'}</span>
                  <span>{l.tang || 'Chưa phân tầng'}</span>
                  <span className="r">{Number(l.soLuong) || 0}</span>
                  <span className="r">{money(l.donGiaBan)}</span>
                  <span className="r b">{money(l.thanhTienBan)}</span>
                </div>
              ))}
            </div>
          )
          ) : <div className="qs-pd-empty">{lines == null ? 'Đang tải…' : 'Dự án chưa có sản phẩm.'}</div>}
        </div>
      )}
      {tab === 'ncc' && (
        <div className="qs-pd-sec">
          {ncc.length ? (
            <div className="qs-pd-ncc">
              {ncc.map(o => (
                <div key={o.ten} className={`qs-pd-nccc${nccOpen === o.ten ? ' on' : ''}`} role="button" tabIndex={0} aria-expanded={nccOpen === o.ten}
                  title={nccOpen === o.ten ? 'Bấm để thu gọn' : 'Bấm để xem sản phẩm ' + o.ten}
                  onClick={() => setNccOpen(v => (v === o.ten ? '' : o.ten))} onKeyDown={e => { if (e.key === 'Enter') setNccOpen(v => (v === o.ten ? '' : o.ten)) }}>
                  <b>{o.ten}</b>
                  <span>{o.n} sản phẩm · SL {o.sl}</span>
                  <span className="t">{money(o.tong)} đ</span>
                  <i style={{ width: tong > 0 ? Math.max(3, Math.round(o.tong / tong * 100)) + '%' : 0 }} />
                </div>
              ))}
            </div>
          ) : null}
          {ncc.length && nccOpen ? (
            <div className="qs-pd-nccsp">
              <div className="h"><b>Sản phẩm {nccOpen}</b><span>{ls.filter(l => (s_(l.thuongHieu) || 'Chưa rõ thương hiệu') === nccOpen).length} dòng</span>
                <button type="button" className="qs-pd-foldb" title="Đóng" onClick={() => setNccOpen('')}><Icon name="x" size={14} /></button></div>
              <div className="qs-pd-sp">
                <div className="qs-pd-sprow head"><span>Ảnh</span><span>Sản phẩm</span><span>Thương hiệu</span><span>Tầng</span><span className="r">SL</span><span className="r">Đơn giá</span><span className="r">Thành tiền</span></div>
                {ls.filter(l => (s_(l.thuongHieu) || 'Chưa rõ thương hiệu') === nccOpen).map(l => (
                  <div key={l.lineId} className="qs-pd-sprow">
                    <ProductThumb product={l} size={44} src={img1(l.hinhAnh)} onClick={l.hinhAnh ? () => setView(img1(l.hinhAnh)) : undefined} />
                    <span className="nm" title={l.ten}>{l.ten}</span>
                    <span>{l.thuongHieu || '—'}</span>
                    <span>{l.tang || 'Chưa phân tầng'}</span>
                    <span className="r">{Number(l.soLuong) || 0}</span>
                    <span className="r">{money(l.donGiaBan)}</span>
                    <span className="r b">{money(l.thanhTienBan)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (!ncc.length ? <div className="qs-pd-empty">{lines == null ? 'Đang tải…' : 'Chưa có nhà cung cấp.'}</div> : null)}
        </div>
      )}
      {tab === 'rel' && (
        <div className="qs-pd-sec">
          {related.length ? (
            <div className="qs-pd-rel">
              {related.map(x => (
                <button type="button" key={x.maDA} className="qs-pd-relc" onClick={() => onOpen(x)}>
                  <b>{x.ten}</b><span>{[x.khachHang, kv_(x)].filter(v => s_(v)).join(' · ') || '—'}</span>
                </button>
              ))}
            </div>
          ) : <div className="qs-pd-empty">Không có dự án cùng khách hàng / khu vực.</div>}
        </div>
      )}
      {tab === 'boq' && (
        <div className="qs-pd-sec qs-pd-boq">
          <div className="qs-pd-boqcard">
            <div className="ic"><Icon name="table" size={22} /></div>
            <div className="tx">
              <b>BOQ trong hệ thống</b>
              <span>{lines == null ? 'Đang tải…' : ls.length ? ls.length + ' dòng bóc tách' + (tong > 0 ? ' · ' + money(tong) + ' đ' : '') + ' · ' + nganhList.length + ' ngành hàng' : 'Dự án chưa có dòng bóc tách nào'}</span>
            </div>
            <button type="button" className="qs-pd-btn primary" onClick={() => onOpenBoc(p)}><Icon name="table" size={14} /> {ls.length ? 'Mở BOQ đầy đủ ở Bóc tách' : 'Bắt đầu bóc tách'}</button>
          </div>
          <div className="qs-pd-boqf">
            <div className="h"><b>File BOQ đính kèm</b><span>Excel (.xlsx, .xls, .csv) hoặc PDF</span></div>
            <input ref={boqRef} type="file" accept={BOQ_ACCEPT} multiple hidden onChange={e => { addBoq(e.target.files); e.target.value = '' }} />
            <div className="qs-pim-drop" onClick={() => boqRef.current && boqRef.current.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addBoq(e.dataTransfer.files) }}>
              <Icon name="upload" size={24} />
              <b>{boqBusy ? 'Đang tải lên ' + boqBusy + ' file…' : 'Kéo thả file BOQ vào đây hoặc bấm để chọn'}</b>
              <span>Dùng khi BOQ của dự án nằm ngoài hệ thống (file của khách, nhà thầu…)</span>
            </div>
            {(boq || []).length > 0 && (
              <div className="qs-pd-boql">
                {boq.map((f, j) => (
                  <div key={f.url + j} className="qs-pd-boqi">
                    <span className={'ty ' + (/\.pdf$/i.test(f.name) ? 'pdf' : 'xls')}>{/\.pdf$/i.test(f.name) ? 'PDF' : 'XLS'}</span>
                    <a href={safeUrl_(mediaUrl(f.url))} target="_blank" rel="noopener noreferrer" title="Mở / tải file">{f.name}</a>
                    <small>{f.at ? new Date(f.at).toLocaleDateString('vi-VN') : ''}</small>
                    <button type="button" title="Xoá file" onClick={() => saveBoq(boq.filter((x, k) => k !== j))}><Icon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {view && <ImgViewer src={view} gallery={pics.map(u => mediaUrl(u)).indexOf(view) >= 0 ? pics.map(u => mediaUrl(u)) : imgs} onClose={() => setView('')} />}
    </div>
  )
}
