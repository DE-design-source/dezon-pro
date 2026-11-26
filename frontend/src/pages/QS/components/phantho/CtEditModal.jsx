import { useEffect, useMemo, useRef, useState } from 'react'
import { MrootPortal } from '../common/ModalHost'
import QsIcon from '../common/QsIcon'
import { qsToast as toast } from '../common/dialogs'
import { mediaUrl } from '../../api/files'
import * as api from '../../api/qsApi'
import { money, ptN, ptMoneyN_, fmtDate } from '../../lib/format.js'
import { PT_LOAI, ptLoaiGop_, ptNccList_, ctThuTuIn_ } from '../../lib/phantho.js'
import { nodeName } from '../../lib/tree.js'
import { useQsStore } from '../../state/store'
import { congTacActions } from '../../state/useCongTac'
import { downscaleImage_, uploadImg_ } from '../importer/imgUpload'
import {
  CT_DEMUC_CHON, ctDeMucNhan_, CT_MODES, CT_DVT, ctHangMucList_, ctGrpParse_, ctGrpText_, ctPrevVals_, ctGiaSyncVals_,
} from './ptModel'
import { usePtTemplate } from './ptHooks'
import './phantho.css'

/* Hộp "Cập nhật công tác" - port ctEditModal_ / ctFormHtml_ (pre 'ctm') / ctModePick_ / ctModeSync_ / ctGiaSync_ / ctPrev_ /
   ctGrpRender_ (bố cục cũ: đề mục lớn + dòng tên/giá trị) / ctImgRender_ / ctPickImg_ / ctFormRead_ / ctSideHtml_ / ctLoadHistory_ /
   ctSaveModal_ (PUB/phantho.js:729-816, 919-1163) và nút Duyệt (ctDuyet_ 676-679, spCanDuyet_ sanpham.js:326).
   Props (cố định từ Batch 0): ctId (id công tác trong cache congTac), onClose(), onSaved(workItem) sau khi lưu.
   Thêm (tuỳ chọn): không. Lưu = PATCH /work-items/:id với đủ trường của form như bản gốc; máy chủ tự bỏ duyệt khi sửa. */

const fmtDateTime_ = v => {
  if (v == null || v === '') return '—'
  const d = new Date(v); if (isNaN(d.getTime())) return String(v)
  const z = n => (n < 10 ? '0' : '') + n
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
}
const s_ = v => (v == null ? '' : String(v))

function initForm(c) {
  const dg = Number(c.dg) || 0, dgnt = Number(c.dgnt) || 0
  const ck = (dg && dgnt) ? Math.round((1 - dgnt / dg) * 100 * 100) / 100 : ''
  const f = {
    ten: s_(c.ten), hangMuc: s_(c.hangMuc), deMuc: s_(c.deMuc), maNhom: s_(c.maNhom), loai: ptLoaiGop_(c.loai), ncc: s_(c.ncc), dvt: s_(c.dvt),
    mode: c.mode || 'item', kl: s_(c.kl), dt: s_(c.dt), hs: s_(c.hs),
    dg: dg ? money(dg) : '', ck: ck === '' ? '' : String(ck), dgnt: dgnt ? money(dgnt) : '',
    gc: s_(c.gc), phamVi: s_(c.phamVi), linkTaiLieu: s_(c.linkTaiLieu), hinhAnh: s_(c.hinhAnh), thuTu: s_(c.thuTu), maSP: s_(c.maSP),
  }
  return giaSync(f, '')   // ctFormInit_ -> ctModeSync_ -> ctGiaSync_(pre,'')
}
// Giá bán lẻ ⟷ %Chiết khấu ⟷ Giá đại lý: gõ ô nào cũng tự tính 2 ô còn lại (ctGiaSync_)
function giaSync(f, src) {
  const r = ctGiaSyncVals_(src, ptMoneyN_(f.dg), ptN(String(f.ck).replace(',', '.')), ptMoneyN_(f.dgnt))
  const o = { ...f }
  if (src !== 'dgnt') o.dgnt = r.nt ? money(r.nt) : ''
  if (src !== 'ck') o.ck = (r.ck || r.ck === 0) ? String(r.ck) : ''
  if (src !== 'dg') o.dg = r.dg ? money(r.dg) : ''
  return o
}

function Side({ c, hist }) {
  return (
    <>
      <div className="qspt-who">
        <span><QsIcon name="plus" size={13} /> Tạo bởi <b>{c.nguoiTao || '—'}</b>{c.ngayTao ? ' · ' + fmtDate(c.ngayTao) : ''}</span>
        <span><QsIcon name="edit" size={13} /> Sửa cuối bởi <b>{c.nguoiSua || '—'}</b>{c.ngayCapNhat ? ' · ' + fmtDateTime_(c.ngayCapNhat) : ''}</span>
        {c.daDuyet
          ? <span className="ok"><QsIcon name="check" size={13} /> Duyệt bởi <b>{c.nguoiDuyet || '—'}</b>{c.ngayDuyet ? ' · ' + fmtDateTime_(c.ngayDuyet) : ''}</span>
          : <span className="warn"><QsIcon name="clock" size={13} /> Chưa duyệt</span>}
      </div>
      <div className="qspt-hist">
        <div className="qspt-hist-h"><QsIcon name="clock" size={15} /> Lịch sử cập nhật <span className="qspt-hist-n">{hist.list ? hist.list.length : '…'}</span></div>
        <div className="qspt-hist-list">
          {hist.err ? <div className="qspt-hempty err" role="alert">Không tải được lịch sử cập nhật: {hist.err}</div>
            : !hist.list ? <div className="qspt-hempty">Đang tải…</div>
              : !hist.list.length ? <div className="qspt-hempty">Chưa có lịch sử cập nhật.</div>
                : hist.list.map((h, i) => (
                  <div key={i} className="qspt-h">
                    <div className="qspt-h-top"><b>{h.field}</b><span className="qspt-h-by"><QsIcon name="clock" size={11} /> {(h.by || '?') + ' · ' + fmtDateTime_(h.at)}</span></div>
                    <div className="qspt-h-diff"><span className="old">{h.old || '—'}</span><span className="arr">→</span><span className="new">{h.new || '—'}</span></div>
                  </div>
                ))}
        </div>
      </div>
    </>
  )
}

export default function CtEditModal({ ctId, onClose, onSaved }) {
  const congTac = useQsStore(s => s.congTac)
  const tpl = usePtTemplate()
  const c = useMemo(() => (congTac || []).filter(x => x.id === ctId)[0] || null, [congTac, ctId])
  const [f, setF] = useState(() => (c ? initForm(c) : null))
  const [grps, setGrps] = useState(() => ctGrpParse_((c && c.thongSo) || ''))
  const [hist, setHist] = useState({ list: null, err: '' })
  const [canDuyet, setCanDuyet] = useState(true)
  const [busy, setBusy] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const hmList = useMemo(() => ctHangMucList_(tpl, congTac), [tpl, congTac])

  // Lịch sử cập nhật (ctLoadHistory_); lỗi thì báo rõ thay vì coi như rỗng
  useEffect(() => {
    if (!ctId) return undefined
    const ac = new AbortController()
    setHist({ list: null, err: '' })
    api.ctHistory(ctId, ac.signal).then(r => setHist({ list: r || [], err: '' }))
      .catch(e => { if (!ac.signal.aborted) setHist({ list: [], err: String((e && e.message) || e) }) })
    return () => ac.abort()
  }, [ctId])
  // Quyền duyệt (spCanDuyet_: chưa đọc được quyền thì coi như có, như bản gốc)
  useEffect(() => {
    const ac = new AbortController()
    api.spMyPerms(ac.signal).then(p => setCanDuyet(p ? !!p.duyet : true)).catch(() => { if (!ac.signal.aborted) setCanDuyet(true) })
    return () => ac.abort()
  }, [])
  useEffect(() => {
    const key = e => {
      if (e.key !== 'Escape') return
      const ovs = document.querySelectorAll('.qsc-ov')
      if (ovs.length && !ovs[ovs.length - 1].classList.contains('qspt-ctov')) return
      closeRef.current && closeRef.current()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  if (!c || !f) {
    return (
      <MrootPortal>
        <div className="qsc-ov qspt-ctov" onClick={e => { if (e.target === e.currentTarget) onClose && onClose() }}>
          <div className="qspt-dlg" style={{ width: 420 }}>
            <div className="qspt-mhead"><h3>Cập nhật công tác</h3><button className="qspt-mx" onClick={() => onClose && onClose()}>✕</button></div>
            <div className="qspt-hempty err" role="alert">Không tìm thấy công tác này (có thể đã bị xoá). Tải lại danh sách công tác rồi thử lại.</div>
          </div>
        </div>
      </MrootPortal>
    )
  }

  const set = (k, v) => setF(o => ({ ...o, [k]: v }))
  const gia = (k, v) => setF(o => giaSync({ ...o, [k]: v }, k))
  const m = f.mode
  const show = { kl: m === 'item', dt: m === 'area' || m === 'area0', hs: m === 'area' || m === 'area0', dgnt: m === 'item', ck: m === 'item', dg: m === 'item' || m === 'area' }
  const tu = ctDeMucNhan_(f.hangMuc)
  const pv = ctPrevVals_(m, f.kl, f.dt, f.hs, ptMoneyN_(f.dg), ptMoneyN_(f.dgnt))
  const nt = ptMoneyN_(f.dgnt)
  const imgs = String(f.hinhAnh || '').split('\n').map(x => x.trim()).filter(Boolean)

  const setG = fn => setGrps(g => fn(JSON.parse(JSON.stringify(g))))
  async function pickImg() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true
    inp.onchange = async () => {
      const fs = Array.prototype.slice.call(inp.files || []); if (!fs.length) return
      toast('Đang tải ' + fs.length + ' ảnh…')
      for (let i = 0; i < fs.length; i++) {
        try {
          const d = await downscaleImage_(fs[i], 1600, 0.82)
          if (!d || d === '__DECODE_FAIL__') { toast('Không đọc được ảnh ' + fs[i].name); continue }
          const tok = await uploadImg_(d, fs[i].name || 'cong-tac.jpg')
          setF(o => ({ ...o, hinhAnh: (o.hinhAnh ? o.hinhAnh + '\n' : '') + tok }))
        } catch (e) { toast('Lỗi tải ảnh: ' + e.message) }
      }
      toast('Đã tải xong ảnh')
    }
    inp.click()
  }
  // ctFormRead_
  function read() {
    const num = t => { t = String(t || '').trim(); return t === '' ? '' : ptN(t) }
    return {
      loai: f.loai, mode: f.mode || 'item', maNhom: f.maNhom.trim(), hangMuc: f.hangMuc.trim(), deMuc: f.deMuc.trim(), ten: f.ten.trim(),
      ncc: f.ncc.trim(), dvt: f.dvt.trim(), kl: num(f.kl), dt: num(f.dt), hs: num(f.hs),
      dgnt: ptMoneyN_(f.dgnt.trim()), dg: ptMoneyN_(f.dg.trim()),
      gc: f.gc.trim(), thongSo: ctGrpText_(grps).trim(), phamVi: f.phamVi.trim(), linkTaiLieu: f.linkTaiLieu.trim(), hinhAnh: f.hinhAnh.trim(),
      thuTu: ctThuTuIn_(f.thuTu), maSP: (f.maSP || '').trim(),
    }
  }
  async function save() {
    const d = read()
    if (!d.ten) { toast('Nhập nội dung công việc'); return }
    if (!d.hangMuc) { toast('Nhập hạng mục'); return }
    if (d.thuTu === null) { toast('Thứ tự phải là số nguyên không âm (để trống = giữ nguyên)'); return }
    if (d.thuTu === '') delete d.thuTu
    setBusy(true)
    try {
      const out = await congTacActions.ctUpdate(c.id, d)
      toast('Đã lưu công tác')
      if (onSaved) onSaved(out)
      if (onClose) onClose()
    } catch (e) { toast('Lỗi lưu: ' + e.message); setBusy(false) }
  }
  async function duyet() {
    const on = !c.daDuyet
    try {
      await congTacActions.ctDuyet([c.id], on)
      toast(on ? 'Đã duyệt công tác' : 'Đã bỏ duyệt')
      onClose && onClose()
    } catch (e) { toast('Lỗi: ' + e.message) }
  }

  const Fld = ({ span, k, lbl, ph, req, list }) => (
    <div className={'qspt-f qspt-f-' + span}>
      <label htmlFor={'qsptctm' + k}>{lbl}{req ? <b className="req">*</b> : null}</label>
      <input id={'qsptctm' + k} type="text" list={list} value={f[k]} placeholder={ph || ''} onChange={e => set(k, e.target.value)} />
    </div>
  )
  const Num = ({ span, k, lbl, ph, on }) => (on ? (
    <div className={'qspt-f qspt-f-' + span}>
      <label htmlFor={'qsptctm' + k}>{lbl}</label>
      <input id={'qsptctm' + k} type="number" step="any" value={f[k]} placeholder={ph || ''} onChange={e => set(k, e.target.value)} />
    </div>
  ) : null)
  return (
    <MrootPortal>
      <div className="qsc-ov qspt-ctov" onClick={e => { if (e.target === e.currentTarget) onClose && onClose() }}>
        <div className="qspt-dlg qspt-ctdlg" role="dialog" aria-label="Cập nhật công tác">
          <div className="qspt-mhead">
            <h3>Cập nhật công tác</h3>
            <span className={`qspt-duyet${c.daDuyet ? ' on' : ''}`}>{c.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span>
            <button className="qspt-mx" title="Đóng" onClick={() => onClose && onClose()}>✕</button>
          </div>
          <div className="qspt-2col">
            <div className="qspt-body">
              <div className="qspt-ctf">
                <section className="qspt-step2">
                  <header><span className="qspt-no">1</span><div><h4>Công tác này là gì?</h4><p>Tên và chỗ đứng của nó trong bảng khái toán</p></div></header>
                  <div className="qspt-grid">
                    {Fld({ span: 12, k: 'ten', lbl: 'Nội dung công việc', ph: 'VD: Giàn tải, máy ép cọc Pmax 90T', req: 1 })}
                    {Fld({ span: 5, k: 'hangMuc', lbl: 'Hạng mục', ph: 'VD: Công tác ép cọc', req: 1, list: 'qspt-dl-hm' })}
                    <div className="qspt-f qspt-f-5">
                      <label htmlFor="qsptctmdeMuc">Phân loại (đề mục bóc tách)</label>
                      <select id="qsptctmdeMuc" value={f.deMuc} onChange={e => set('deMuc', e.target.value)}>
                        <option value="">— Tự nhận theo tên hạng mục{tu ? (': ' + tu) : ': chưa nhận ra'} —</option>
                        <option value="0">Chỉ nằm ở 3.1 Phần thô</option>
                        {CT_DEMUC_CHON.map(cd => <option key={cd} value={cd}>{cd + ' · ' + nodeName(cd)}</option>)}
                        {f.deMuc && f.deMuc !== '0' && CT_DEMUC_CHON.indexOf(f.deMuc) < 0 && <option value={f.deMuc}>{f.deMuc}</option>}
                      </select>
                    </div>
                    {Fld({ span: 2, k: 'maNhom', lbl: 'Số hạng mục', ph: 'II' })}
                    <div className="qspt-f qspt-f-4">
                      <label htmlFor="qsptctmloai">Loại báo giá<b className="req">*</b></label>
                      <select id="qsptctmloai" value={f.loai} onChange={e => set('loai', e.target.value)}>
                        {PT_LOAI.map(x => <option key={x[0]} value={x[0]}>{x[1]}</option>)}
                      </select>
                    </div>
                    {Fld({ span: 5, k: 'ncc', lbl: 'Nhà thầu · nhà cung cấp', ph: 'VD: H77', list: 'qspt-dl-ncc' })}
                    <div className="qspt-f qspt-f-3">
                      <label htmlFor="qsptctmthuTu" title="Thư viện sắp công tác theo số này trong cùng loại báo giá (nhỏ đứng trước)">Thứ tự</label>
                      <input id="qsptctmthuTu" type="number" min="0" step="1" value={f.thuTu} placeholder="0" onChange={e => set('thuTu', e.target.value)} />
                    </div>
                    {Fld({ span: 5, k: 'maSP', lbl: 'Mã sản phẩm', ph: 'VD: KSHT' })}
                    {Fld({ span: 6, k: 'dvt', lbl: 'Đơn vị tính', ph: 'VD: m · m2 · tim · gói', req: 1, list: 'qspt-dl-dvt' })}
                  </div>
                  <datalist id="qspt-dl-hm">{hmList.map(v => <option key={v} value={v} />)}</datalist>
                  <datalist id="qspt-dl-ncc">{ptNccList_(congTac).map(v => <option key={v.ten} value={v.ten} />)}</datalist>
                  <datalist id="qspt-dl-dvt">{CT_DVT.map(v => <option key={v} value={v} />)}</datalist>
                </section>

                <section className="qspt-step2">
                  <header><span className="qspt-no">2</span><div><h4>Tính tiền thế nào?</h4><p>Chọn cách tính rồi nhập giá — hệ thống tự ra phần còn lại</p></div></header>
                  <div className="qspt-seg">
                    {CT_MODES.map(x => (
                      <button key={x[0]} type="button" className={`qspt-segb${m === x[0] ? ' on' : ''}`} onClick={() => setF(o => giaSync({ ...o, mode: x[0] }, ''))}>
                        <b>{x[1]}</b><i>{x[2]}</i>
                      </button>
                    ))}
                  </div>
                  <div className="qspt-grid">
                    {Num({ span: 4, k: 'kl', lbl: 'Khối lượng mẫu', ph: '1', on: show.kl })}
                    {Num({ span: 4, k: 'dt', lbl: 'Diện tích mẫu (m²)', ph: '0', on: show.dt })}
                    {Num({ span: 4, k: 'hs', lbl: 'Hệ số', ph: '1', on: show.hs })}
                    {show.dg && (
                      <div className="qspt-f qspt-f-4"><label htmlFor="qsptctmdg">Giá bán lẻ (đ)<b className="req">*</b></label>
                        <input id="qsptctmdg" className="qspt-money" inputMode="numeric" value={f.dg} placeholder="0" onChange={e => gia('dg', e.target.value)} /></div>
                    )}
                    {show.ck && (
                      <div className="qspt-f qspt-f-4"><label htmlFor="qsptctmck">%Chiết khấu</label>
                        <input id="qsptctmck" className="qspt-pct" inputMode="decimal" value={f.ck} placeholder="0" onChange={e => gia('ck', e.target.value)} /></div>
                    )}
                    {show.dgnt && (
                      <div className="qspt-f qspt-f-4"><label htmlFor="qsptctmdgnt">Giá đại lý · giá vốn (đ)</label>
                        <input id="qsptctmdgnt" className="qspt-money" inputMode="numeric" value={f.dgnt} placeholder="0" onChange={e => gia('dgnt', e.target.value)} /></div>
                    )}
                    <div className="qspt-f qspt-f-12">
                      <div className="qspt-prev">
                        <span className="pv-l">Dòng trong bảng</span>
                        {pv ? (
                          <>
                            <b>{(pv.kl || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} {f.dvt.trim() || '—'} × {money(ptMoneyN_(f.dg))} đ = {money(pv.tt)} đ</b>
                            {nt ? <i className={pv.ln < 0 ? 'neg' : ''}>Lợi nhuận {money(pv.ln)} đ · {pv.pct.toFixed(1)}%</i> : <i>Chưa nhập giá vốn</i>}
                          </>
                        ) : <b>Chỉ liệt kê, không tính tiền</b>}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="qspt-step2">
                  <header><span className="qspt-no">3</span><div><h4>Mô tả thêm <span className="opt">Không bắt buộc</span></h4><p>Ghi chú, thông số, ảnh — hiện ở panel thông tin công tác</p></div></header>
                  <div className="qspt-grid">
                    <div className="qspt-f qspt-f-6"><label htmlFor="qsptctmgc">Ghi chú · điều kiện áp dụng</label>
                      <textarea id="qsptctmgc" rows={3} value={f.gc} placeholder="VD: Đơn giá cho trên 20m/tim cọc (tùy địa chất khu vực)" onChange={e => set('gc', e.target.value)} /></div>
                    <div className="qspt-f qspt-f-6"><label htmlFor="qsptctmpv">Phạm vi ứng dụng — mỗi dòng 1 ý</label>
                      <textarea id="qsptctmpv" rows={3} value={f.phamVi} placeholder={'Nhà phố, biệt thự có tầng hầm\nMặt bằng đủ rộng cho xe cẩu'} onChange={e => set('phamVi', e.target.value)} /></div>
                  </div>
                  <div className="qspt-sub"><span>Thông số kỹ thuật</span>
                    <button type="button" className="qspt-addbig" onClick={() => setG(g => g.concat([{ t: '', rows: [{ k: '', v: '' }] }]))}><QsIcon name="plus" size={13} /> Thêm đề mục lớn</button>
                  </div>
                  <div className="qspt-grps">
                    {!grps.length ? (
                      <div className="qspt-grp-empty">Chưa có đề mục nào. Bấm <b>Thêm đề mục lớn</b> để mô tả thông số kỹ thuật (VD: <i>Thông số kỹ thuật tham khảo</i> → <i>Lực ép tối đa (Pmax): 90 tấn</i>).</div>
                    ) : grps.map((g, gi) => (
                      <div key={gi} className="qspt-grp">
                        <div className="qspt-grp-h">
                          <input className="qspt-grp-t" value={g.t || ''} placeholder="Tên đề mục lớn — VD: Thông số kỹ thuật tham khảo" onChange={e => setG(x => { x[gi].t = e.target.value; return x })} />
                          <button type="button" className="qspt-grp-x" title="Xoá đề mục lớn" onClick={() => setG(x => { x.splice(gi, 1); return x })}>✕</button>
                        </div>
                        <div className="qspt-grp-b">
                          {g.rows.map((r, ri) => (
                            <div key={ri} className="qspt-kv">
                              <input className="qspt-kv-k" value={r.k || ''} placeholder="Tên đề mục nhỏ" onChange={e => setG(x => { x[gi].rows[ri].k = e.target.value; return x })} />
                              <input className="qspt-kv-v" value={r.v || ''} placeholder="Giá trị / mô tả" onChange={e => setG(x => { x[gi].rows[ri].v = e.target.value; return x })} />
                              <button type="button" className="qspt-kv-x" title="Xoá dòng" onClick={() => setG(x => { x[gi].rows.splice(ri, 1); if (!x[gi].rows.length) x[gi].rows.push({ k: '', v: '' }); return x })}>✕</button>
                            </div>
                          ))}
                        </div>
                        <button type="button" className="qspt-addsmall" onClick={() => setG(x => { x[gi].rows.push({ k: '', v: '' }); return x })}><QsIcon name="plus" size={12} /> Thêm đề mục nhỏ</button>
                      </div>
                    ))}
                  </div>
                  <div className="qspt-grid" style={{ marginTop: 14 }}>
                    <div className="qspt-f qspt-f-6"><label>Ảnh công tác</label>
                      <div className="qspt-imgrow">
                        {imgs.length ? imgs.map((u, i) => (
                          <div key={i} className="qspt-img">
                            <img src={mediaUrl(u)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                            <button type="button" className="qspt-imgx" title="Bỏ ảnh này" onClick={() => { const a = imgs.slice(); a.splice(i, 1); set('hinhAnh', a.join('\n')) }}>✕</button>
                          </div>
                        )) : <span className="qspt-noimg">Chưa có ảnh — bấm "Thêm ảnh" để tải lên</span>}
                      </div>
                      <button type="button" className="qspt-btn ghost sm" onClick={pickImg}><QsIcon name="plus" size={14} /> Thêm ảnh</button>
                    </div>
                    {Fld({ span: 6, k: 'linkTaiLieu', lbl: 'Link tài liệu kỹ thuật', ph: 'https://…' })}
                  </div>
                </section>
              </div>
              <div className="qspt-mact">
                <button className="qspt-btn ghost sm" onClick={() => onClose && onClose()}>Đóng</button>
                {canDuyet && <button className="qspt-btn ghost sm" onClick={duyet}><QsIcon name="check" size={14} /> {c.daDuyet ? 'Bỏ duyệt' : 'Duyệt'}</button>}
                <button className="qspt-btn blue" disabled={busy} onClick={save}><QsIcon name="check" size={15} /> Lưu thay đổi</button>
              </div>
            </div>
            <aside className="qspt-side"><Side c={c} hist={hist} /></aside>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}
