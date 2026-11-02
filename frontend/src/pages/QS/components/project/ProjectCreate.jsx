import { useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { qsToast as toast } from '../common/dialogs'
import { showTab } from '../../state/store'
import { importProjectForm, attachBoqFiles } from './projectActions'

/* Trang "Nhập dự án" (mở từ nút Nhập dự án của Danh sách dự án): cùng khung với trang chi tiết (ProjectDetail),
   đủ các trường của bảng Thông tin + phần giới thiệu (Nhu cầu / Hiện trạng / Ghi chú). Khu vực tự lấy từ đoạn cuối Địa điểm.
   Chỉ thêm dự án vào danh sách, không mở thành dự án đang làm như "Tạo dự án" ở Bảng điều khiển.
   Ô đầu tiên là Kiến trúc sư: gõ tên -> gợi ý tên KTS đã có + các dự án KTS đó đã tham gia (bấm = sang trang dự án đó).
   Lưu mà trùng dự án đã có (cùng KTS + cùng tên dự án) thì chuyển về dự án đó, không tạo mới.
   Khối BOQ (chỉ khi nhập mới): tải file BOQ PDF / Excel (đính kèm vào dữ liệu 'boqFiles' sau khi lưu), hoặc "Tạo BOQ từ Dezon Pro":
   tạo dự án như "Tạo dự án" của Bảng điều khiển (mở thành dự án đang làm) rồi chuyển sang Bảng điều khiển.
   Props: onBack(), onCreated(p) (dự án vừa nhập), onOpen(maDA) (dự án đã có).
   Sửa dự án đã có: sửa tại chỗ ở trang chi tiết (ProjectDetail), không dùng trang này. */
const TRANG_THAI = ['Bản nháp', 'Đang thực hiện', 'Hoàn thành']
const EMPTY = {
  kienTrucSu: '', ten: '', khachHang: '', diaChi: '', sdt: '', phanKhuc: '', quyMo: '', tongDT: '', dtBaoGia: '',
  trangThai: TRANG_THAI[0], tienDo: 0, maBaoGia: '', vat: '0', linkDezon: '', nhuCau: '', hienTrang: '', ghiChu: '',
}
const BOQ_ACCEPT = '.xlsx,.xls,.csv,.pdf'

/* So tên không phân biệt hoa thường / dấu / khoảng trắng thừa */
const norm_ = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim()

export default function ProjectCreate({ onBack, onCreated, onOpen }) {
  const { projects } = useQs()
  const [f, setF] = useState(EMPTY)
  const [boqFiles, setBoqFiles] = useState([])   // File chờ tải lên sau khi lưu dự án
  const boqRef = useRef(null)
  function addBoq(files) {
    const all = [...(files || [])]
    const ok = all.filter(x => /\.(xlsx|xls|csv|pdf)$/i.test(x.name))
    if (ok.length < all.length) toast('Chỉ nhận file Excel (.xlsx, .xls, .csv) hoặc PDF')
    if (ok.length) setBoqFiles(l => [...l, ...ok])
  }
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = k => e => { const v = e.target.value; setF(x => ({ ...x, [k]: v })) }
  const nameMissing = !f.ten.trim()
  const kv = (f.diaChi.split(',').map(t => t.trim()).filter(Boolean).pop()) || ''
  const fld = (label, k, extra) => (
    <label className="qs-field">
      <span>{label}</span>
      <input value={f[k]} onChange={set(k)} {...extra} />
    </label>
  )
  /* Tên KTS đã có (cho ô gợi ý) · dự án của KTS đang gõ · dự án trùng (cùng KTS + cùng tên dự án) */
  const ktsNames = useMemo(() => {
    const m = {}
    ;(projects || []).forEach(x => { const k = norm_(x.kienTrucSu); if (k && !m[k]) m[k] = String(x.kienTrucSu).trim() })
    return Object.values(m).sort((a, b) => a.localeCompare(b, 'vi'))
  }, [projects])
  const kq = norm_(f.kienTrucSu)
  const ktsProjects = kq ? (projects || []).filter(x => norm_(x.kienTrucSu).indexOf(kq) >= 0) : []
  const dup = kq && f.ten.trim() ? ktsProjects.find(x => norm_(x.kienTrucSu) === kq && norm_(x.ten) === norm_(f.ten)) : null
  async function submit(e) {
    e.preventDefault()
    setTouched(true)
    if (busy) return
    if (dup) { toast('Dự án "' + dup.ten + '" của KTS ' + dup.kienTrucSu + ' đã có - chuyển về trang dự án'); onOpen(dup.maDA); return }
    setBusy(true)
    const p = await importProjectForm(f)
    if (p && boqFiles.length) await attachBoqFiles(p.maDA, boqFiles)
    setBusy(false)
    if (p) onCreated(p)
  }
  /* "Tạo BOQ từ Dezon Pro": tạo + mở dự án như Bảng điều khiển, đính file BOQ đã chọn (nếu có), rồi sang Bảng điều khiển */
  async function createDash() {
    setTouched(true)
    if (busy) return
    if (dup) { toast('Dự án "' + dup.ten + '" của KTS ' + dup.kienTrucSu + ' đã có - chuyển về trang dự án'); onOpen(dup.maDA); return }
    setBusy('dash')
    const p = await importProjectForm(f, { open: true })
    if (p && boqFiles.length) await attachBoqFiles(p.maDA, boqFiles)
    setBusy(false)
    if (p) { onBack(); showTab('dash') }
  }

  return (
    <form className="qs-pd qs-pn" onSubmit={submit}>
      <div className="qs-pd-top">
        <button type="button" className="qs-pd-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Danh sách dự án</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="qs-pd-btn" onClick={onBack}>Huỷ</button>
        <button type="submit" className="qs-pd-btn primary" disabled={busy}><Icon name="check" size={14} /> {busy ? 'Đang lưu…' : 'Lưu dự án'}</button>
      </div>

      <div className="qs-pd-title">
        <h1>{f.ten.trim() || 'Nhập dự án'}</h1>
        <span className="st">{f.trangThai}</span>
      </div>

      <section className="qs-pn-sec">
        <h3>Kiến trúc sư</h3>
        <div className="qs-pn-grid">
          <label className="qs-field qs-pn-wide">
            <span>Kiến trúc sư <i>(gõ tên để xem các dự án KTS đã tham gia)</i></span>
            <input autoFocus list="qs-pn-kts" value={f.kienTrucSu} onChange={set('kienTrucSu')} placeholder="Tên kiến trúc sư / văn phòng kiến trúc" />
            <datalist id="qs-pn-kts">{ktsNames.map(n => <option key={n} value={n} />)}</datalist>
          </label>
        </div>
        {kq ? (
          <div className="qs-pn-kts">
            <div className="h">{ktsProjects.length
              ? <><b>{ktsProjects.length}</b> dự án KTS này đã tham gia - bấm để mở dự án đã có, hoặc nhập tiếp bên dưới để tạo mới</>
              : 'Chưa có dự án nào của KTS này - nhập thông tin bên dưới để tạo mới'}</div>
            {ktsProjects.length > 0 && (
              <div className="l">
                {ktsProjects.slice(0, 12).map(x => (
                  <button type="button" key={x.maDA} className={dup && dup.maDA === x.maDA ? 'on' : ''} onClick={() => onOpen(x.maDA)} title={'Mở trang dự án ' + x.ten}>
                    <b>{x.ten}</b>
                    <span>{[x.kienTrucSu, x.khachHang, x.trangThai || 'Bản nháp'].filter(v => String(v || '').trim()).join(' · ')}</span>
                  </button>
                ))}
                {ktsProjects.length > 12 && <span className="more">+{ktsProjects.length - 12} dự án khác</span>}
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className="qs-pn-sec">
        <h3>Thông tin dự án</h3>
        <div className="qs-pn-grid">
          <label className="qs-field">
            <span>Tên dự án *</span>
            {dup && <em className="qs-pn-dup">Trùng dự án đã có - Lưu sẽ chuyển về dự án này</em>}
            <input value={f.ten} onChange={set('ten')} placeholder="VD: Nhà phố anh Thành" className={touched && nameMissing ? 'invalid' : ''} />
          </label>
          {fld('Khách hàng', 'khachHang')}
          {fld('Địa điểm', 'diaChi', { placeholder: 'Số nhà, đường, quận, tỉnh / thành' })}
          {fld('Điện thoại', 'sdt', { type: 'tel' })}
          <label className="qs-field">
            <span>Khu vực <i>(tự lấy từ Địa điểm)</i></span>
            <input value={kv} readOnly tabIndex={-1} placeholder="—" />
          </label>
          {fld('Phân khúc', 'phanKhuc')}
          {fld('Quy mô', 'quyMo', { placeholder: 'VD: 1 trệt 2 lầu' })}
          {fld('Tổng diện tích (m²)', 'tongDT', { inputMode: 'decimal' })}
          {fld('Diện tích báo giá (m²)', 'dtBaoGia', { inputMode: 'decimal' })}
          <label className="qs-field">
            <span>Trạng thái</span>
            <select value={f.trangThai} onChange={set('trangThai')}>
              {TRANG_THAI.map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
          {fld('VAT (%)', 'vat', { type: 'number', min: 0, max: 100 })}
          <label className="qs-field qs-pn-wide">
            <span>Link dự án trên Dezon</span>
            <input type="url" value={f.linkDezon} onChange={set('linkDezon')} placeholder="https://dezon.vn/…" />
          </label>
        </div>
      </section>

      <section className="qs-pn-sec">
          <h3>BOQ</h3>
          <div className="qs-pn-boq">
            <div className="qs-pn-boqc">
              <b><Icon name="upload" size={16} /> Tải file BOQ</b>
              <span>File của khách / nhà thầu (Excel .xlsx, .xls, .csv hoặc PDF) - đính kèm vào tab BOQ của dự án khi lưu.</span>
              <input ref={boqRef} type="file" accept={BOQ_ACCEPT} multiple hidden onChange={e => { addBoq(e.target.files); e.target.value = '' }} />
              <div className="qs-pim-drop" onClick={() => boqRef.current && boqRef.current.click()}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addBoq(e.dataTransfer.files) }}>
                <Icon name="upload" size={22} />
                <b>Kéo thả file vào đây hoặc bấm để chọn</b>
              </div>
              {boqFiles.length > 0 && (
                <div className="qs-pd-boql">
                  {boqFiles.map((x, j) => (
                    <div key={x.name + j} className="qs-pd-boqi">
                      <span className={'ty ' + (/\.pdf$/i.test(x.name) ? 'pdf' : 'xls')}>{/\.pdf$/i.test(x.name) ? 'PDF' : 'XLS'}</span>
                      <span className="nm">{x.name}</span>
                      <small>{Math.max(1, Math.round(x.size / 1024))} KB</small>
                      <button type="button" title="Bỏ file" onClick={() => setBoqFiles(l => l.filter((y, k) => k !== j))}><Icon name="x" size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="qs-pn-boqc dz">
              <b><Icon name="table" size={16} /> Tạo BOQ từ Dezon Pro</b>
              <span>Tạo dự án mới ở Bảng điều khiển với thông tin trên rồi chuyển tới Bảng điều khiển để bóc tách / lập BOQ.</span>
              <button type="button" className="qs-pd-btn primary" disabled={busy} onClick={createDash}>
                <Icon name="plus" size={14} /> {busy === 'dash' ? 'Đang tạo…' : 'Tạo dự án & lập BOQ'}
              </button>
            </div>
          </div>
        </section>
    </form>
  )
}
