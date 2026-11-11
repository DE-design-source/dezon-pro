import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { MrootPortal } from '../common/Mroot'
import { useQs } from '../../state/QsData'
import { currentGroup, draftName_, dezonUrl_, TT_DU_AN, ttChuan_ } from '../../lib/dashModel.js'
import { safeUrl_, money, fmtDate } from '../../lib/format.js'
import { cpTong_ } from '../../lib/totals.js'
import { projCtx_ } from './projectShell'
import { usePhuTrach, setPhuTrach, ptRoles_, PT_ROLES } from '../dashboard/ptStore'
import { PtCell } from '../dashboard/ProjectViews'
import {
  addDraftForCur, saveProjectShared, saveDraftInfo, saveProgress, removeProject,
} from './projectActions'
import { escOnTop_ } from './projectShell'
import './project.css'

/* Hộp "Thông tin dự án" (port projInfoModal / projInfoInner_, PUB/app.js:2117-2172; shot modal-project-info.png).
   Luôn hiện bản nháp ĐANG MỞ (cur): projInfoModal(maDA) mở bản nháp trước rồi mới mở hộp.
   Props: onClose(). Chọn tab bản nháp khác = mở bản đó và ở lại hộp (openDraft). */
// Phân loại dự án ở Danh sách dự án (TT_DU_AN, lib/dashModel); giá trị cũ Bản nháp / Hoàn thành được đổi tên khi mở
const TRANG_THAI = TT_DU_AN
const s = v => (v == null ? '' : String(v))

export default function ProjectInfoModal({ onClose }) {
  const { cur, projects, selectProject } = useQs()
  const [ver, setVer] = useState(0)   // tăng sau mỗi lần lưu -> dựng lại form từ dữ liệu mới (như projModalRefresh_)
  const closeRef = useRef(onClose)
  const ovRef = useRef(null)
  closeRef.current = onClose

  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && escOnTop_(ovRef.current)) closeRef.current() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { if (!cur) closeRef.current() }, [cur])
  if (!cur) return null
  const gr = currentGroup(projects, cur)
  const bump = ok => { if (ok) setVer(v => v + 1) }

  return (
    <MrootPortal>
      {/* Trang toàn màn hình (không còn hộp nổi): nút "Quay lại" / Esc / ✕ để về màn trước */}
      <div ref={ovRef} className="qsc-ov qs-pi-page">
        <div className="qsc-dlg qs-pdlg qs-pi-dlg" role="dialog" aria-modal="true">
          <div className="qs-pdlg-h">
            <button type="button" className="qsc-btn qs-pi-back" onClick={onClose}><Icon name="arrowLeft" size={15} />Quay lại</button>
            <h3><Icon name="building" size={16} />Thông tin dự án</h3>
            {/* tên dự án + chuyển bản nháp nằm luôn trên hàng tiêu đề */}
            <div className="qs-pi-switch">
              <div className="qs-pi-sw-l">
                <span className="qs-pi-sw-ic"><Icon name="building" size={18} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="qs-pi-sw-name">{gr.name}</div>
                  <div className="qs-pi-sw-sub">{(cur.khachHang || 'Chưa có khách hàng') + (cur.sdt ? ' · ' + cur.sdt : '') + ' · ' + gr.drafts.length + ' bản nháp'}</div>
                </div>
              </div>
              <div className="qs-pi-tabs">
                {gr.drafts.map((d, i) => (
                  <button key={d.maDA} type="button" className={`qs-pi-tab${d.maDA === cur.maDA ? ' on' : ''}`} onClick={() => selectProject(d.maDA)}>
                    <Icon name="fileText" size={12} />{draftName_(d, i)}
                  </button>
                ))}
                <button type="button" className="qs-pi-tab add" onClick={addDraftForCur}><Icon name="plus" size={13} />Thêm bản nháp</button>
              </div>
            </div>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <div className="qs-pi-b">
            {/* 2 cột: trái = Báo cáo (nhân sự dự án + thông tin khác), phải = Thông tin dự án + Thông tin bản nháp */}
            <div className="qs-pi-cols">
              <ReportCard gr={gr} cur={cur} />
              <div className="qs-pi-main">
                <SharedCard key={'s|' + cur.maDA + '|' + ver} p={cur} onSaved={bump} />
                <DraftCard key={'d|' + cur.maDA + '|' + ver} p={cur} idx={gr.idx} many={gr.drafts.length > 1} onSaved={bump} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}

/* Cột "Báo cáo": Nhân sự dự án (ptStore, quản trị giao được) + các thông tin khác của dự án / bản nháp đang mở
   (trạng thái, tiến độ, ngày tạo, số bản nháp, giá trị báo giá + số dòng như tab Chi phí, nhà cung cấp) */
function ReportCard({ gr, cur }) {
  const { lines, projData } = useQs()
  const { map, users, canEdit } = usePhuTrach()
  const key = gr.drafts.length ? gr.drafts[0].maDA : cur.maDA
  const roles = ptRoles_(map[key])
  const nPt = new Set([...roles.ql, ...roles.dp, ...roles.th].map(u => String(u).toLowerCase())).size
  const ten = u => { const x = users.find(y => String(y.username || '').toLowerCase() === String(u).toLowerCase()); return (x && (x.hoTen || x.username)) || u }
  const ls = lines || []
  const T = ls.length ? cpTong_(ls, '', projCtx_(cur, projData)) : null
  const ncc = [...new Set(ls.map(l => String(l.thuongHieu || '').trim()).filter(Boolean))]
  const pct = Math.max(0, Math.min(100, Number(cur.tienDo) || 0))
  const row = (k, v) => <div className="qs-pi-rp-r"><span>{k}</span><b>{v}</b></div>
  return (
    <aside className="qs-pi-report" aria-label="Báo cáo">
      <section className="qs-pi-scard">
        <div className="qs-pi-sh"><h3>Nhân sự dự án</h3>{nPt > 0 && <span>{nPt + ' người'}</span>}</div>
        <div className="qs-pi-rp-sec">
          {/* 3 vai trò: Quản lý (= cột Phụ trách của Danh sách dự án) · Người điều phối · Người thực hiện */}
          {PT_ROLES.map(([k, nhan]) => (
            <div key={k} className="qs-pi-role">
              <span className="lb">{nhan}</span>
              <PtCell ds={roles[k]} users={users} canEdit={canEdit} onChange={list => setPhuTrach(key, list, k)} />
              {roles[k].length > 1 && <small className="ppl">{roles[k].map(ten).join(', ')}</small>}
            </div>
          ))}
          {!canEdit && !nPt && <small className="qs-pi-rp-hint">Quản trị giao nhân sự ở đây hoặc cột Phụ trách của Danh sách dự án.</small>}
        </div>
      </section>
      <section className="qs-pi-scard">
        <div className="qs-pi-sh"><h3>Báo cáo dự án</h3><span>{draftName_(cur, gr.idx < 0 ? 0 : gr.idx)}</span></div>
        <div className="qs-pi-rp-sec">
          {row('Trạng thái', cur.trangThai || 'Bản nháp')}
          <div className="qs-pi-rp-r"><span>Tiến độ</span><b className="qs-pi-rp-pg"><i><em style={{ width: pct + '%' }} /></i>{pct}%</b></div>
          {row('Ngày tạo', cur.ngayTao ? fmtDate(cur.ngayTao) : '—')}
          {row('Số bản nháp', gr.drafts.length)}
          {row('Kiến trúc sư', cur.kienTrucSu || '—')}
          {row('Dòng sản phẩm', ls.length)}
          {row('Giá trị báo giá', T ? money(T.total) + ' đ' : 'Chưa có báo giá')}
          {T && row('Lợi nhuận', money(T.ln) + ' đ · ' + (Math.round(T.bien * 10) / 10).toLocaleString('vi-VN') + '%')}
          <div className="qs-pi-rp-r col"><span>Nhà cung cấp</span>
            {ncc.length ? <div className="qs-pi-rp-ncc">{ncc.map(n => <i key={n}>{n}</i>)}</div> : <b>—</b>}
          </div>
        </div>
      </section>
    </aside>
  )
}

function Field({ label, value, onChange, type, wide, children }) {
  return (
    <label className={`qs-field${wide ? ' qs-pi-wide' : ''}`}>
      <span>{label}</span>
      {children || <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} />}
    </label>
  )
}

function SharedCard({ p, onSaved }) {
  const [f, setF] = useState({ ten: s(p.ten), kienTrucSu: s(p.kienTrucSu), khachHang: s(p.khachHang), sdt: s(p.sdt), diaChi: s(p.diaChi), linkDezon: s(p.linkDezon) })
  const [busy, setBusy] = useState(false)
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  async function save() { setBusy(true); const ok = await saveProjectShared(f); setBusy(false); onSaved(ok) }
  return (
    <div className="qs-pi-card">
      <div className="qs-pi-card-h"><span className="qs-pi-card-ic"><Icon name="building" size={18} /></span><h3>Thông tin dự án</h3></div>
      <div className="qs-pi-card-b">
        <p className="qs-pi-note">Áp dụng cho tất cả bản nháp của dự án này.</p>
        <div className="qs-pi-grid">
          <Field label="Tên dự án" value={f.ten} onChange={set('ten')} />
          <Field label="Kiến trúc sư" value={f.kienTrucSu} onChange={set('kienTrucSu')} />
          <Field label="Khách hàng" value={f.khachHang} onChange={set('khachHang')} />
          <Field label="Số điện thoại" value={f.sdt} onChange={set('sdt')} />
          <Field label="Địa chỉ" value={f.diaChi} onChange={set('diaChi')} />
          <Field label="Link dự án trên Dezon" wide>
            <div className="qs-pi-link">
              <input type="url" placeholder="https://dezon.vn/…" value={f.linkDezon} onChange={e => set('linkDezon')(e.target.value)} />
              {p.linkDezon ? (
                <a className="qsc-btn" href={safeUrl_(dezonUrl_(p.linkDezon))} target="_blank" rel="noopener noreferrer" title="Mở bài dự án trên dezon.vn">
                  <Icon name="link" size={14} />Mở
                </a>
              ) : null}
            </div>
          </Field>
        </div>
        <div className="qs-pi-save">
          <button type="button" className="qsc-btn blue" disabled={busy} onClick={save}><Icon name="check" size={15} />Lưu thông tin dự án</button>
        </div>
      </div>
    </div>
  )
}

function DraftCard({ p, idx, many, onSaved }) {
  const [f, setF] = useState({
    tenBanNhap: s(p.tenBanNhap), trangThai: s(p.trangThai), vat: s(p.vat), maBaoGia: s(p.maBaoGia), quyMo: s(p.quyMo),
    tongDT: s(p.tongDT), dtBaoGia: s(p.dtBaoGia), nhuCau: s(p.nhuCau), phanKhuc: s(p.phanKhuc), ghiChu: s(p.ghiChu),
    hienTrang: s(p.hienTrang),
  })
  const [prog, setProg] = useState(Number(p.tienDo) || 0)
  const [busy, setBusy] = useState(false)
  const set = k => v => setF(x => ({ ...x, [k]: v }))
  /* Trạng thái cũ / lạ quy về 1 trong 3 loại (ttChuan_): Bản nháp -> Đang báo giá, Hoàn thành -> Đã thực hiện */
  const tt = ttChuan_(f.trangThai)
  async function save() { setBusy(true); const ok = await saveDraftInfo({ ...f, trangThai: tt }, p); setBusy(false); onSaved(ok) }
  return (
    <div className="qs-pi-card">
      <div className="qs-pi-card-h">
        <span className="qs-pi-card-ic"><Icon name="fileText" size={18} /></span>
        <h3>Thông tin bản nháp — {draftName_(p, idx)}</h3>
        <span className="qs-pi-badge">{p.maDA}</span>
        <span style={{ flex: 1 }} />
        {many && <button type="button" className="qsc-btn" onClick={() => removeProject(p.maDA)}><Icon name="trash" size={13} />Xoá bản nháp</button>}
      </div>
      <div className="qs-pi-card-b">
        <div className="qs-pi-grid">
          <Field label="Tên bản nháp" value={f.tenBanNhap} onChange={set('tenBanNhap')} />
          <Field label="Trạng thái">
            <select value={tt} onChange={e => set('trangThai')(e.target.value)}>
              {TRANG_THAI.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="VAT (%)" type="number" value={f.vat} onChange={set('vat')} />
          <Field label="Mã báo giá" value={f.maBaoGia} onChange={set('maBaoGia')} />
          <Field label="Quy mô" value={f.quyMo} onChange={set('quyMo')} />
          <Field label="Tổng DT XD (m²)" value={f.tongDT} onChange={set('tongDT')} />
          <Field label="DT báo giá (m²)" value={f.dtBaoGia} onChange={set('dtBaoGia')} />
          <Field label="Nhu cầu" value={f.nhuCau} onChange={set('nhuCau')} />
          <Field label="Phân khúc" value={f.phanKhuc} onChange={set('phanKhuc')} />
          <Field label="Hiện trạng" wide>
            <textarea className="qs-pi-ht" placeholder="Hiện trạng công trình / mặt bằng (in trên tờ bìa báo giá)" value={f.hienTrang}
              onChange={e => set('hienTrang')(e.target.value)} />
          </Field>
        </div>
        <label className="qs-field qs-pi-gc">
          <span>Ghi chú</span>
          <textarea placeholder="Ghi chú cho bản nháp này" value={f.ghiChu} onChange={e => set('ghiChu')(e.target.value)} />
        </label>
        <div className="qs-pi-prog">
          <span className="qs-pi-prog-l">Tiến độ</span>
          <input type="range" min="0" max="100" value={prog} onChange={e => setProg(Number(e.target.value) || 0)} />
          <b>{prog}%</b>
          <button type="button" className="qsc-btn" onClick={() => saveProgress(prog)}>Cập nhật</button>
        </div>
        <div className="qs-pi-save">
          <button type="button" className="qsc-btn blue" disabled={busy} onClick={save}><Icon name="check" size={15} />Lưu bản nháp</button>
        </div>
      </div>
    </div>
  )
}
