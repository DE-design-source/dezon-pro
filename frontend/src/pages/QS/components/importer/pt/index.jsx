import { useMemo, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import { qsToast, qsConfirm, qsAlert } from '../../common/dialogs'
import ImgUpBlock from '../ImgUpBlock'
import { waitUploads_, useImp } from '../importStore'
import { ptLibrary_, ctHangMucList_ } from '../NganhSel'
import CtEditModal from '../../phantho/CtEditModal'
import { useQs } from '../../../state/QsData'
import { useQsStore } from '../../../state/store'
import { congTacActions } from '../../../state/useCongTac'
import * as api from '../../../api/qsApi'
import { mediaUrl } from '../../../api/files'
import { money, pad2, ptN, ptMoneyN_ } from '../../../lib/format.js'
import { nodeName } from '../../../lib/tree.js'
import { ctOf_, ptLoaiGop_, ptSecLoai_, ctThuTuIn_ } from '../../../lib/phantho.js'
import { ptLoaiNgan_, ctDeMucCua_, ctGrpText_, ptTpl_, ptAddFromLib_ } from '../../products/pt/ptCore'
import { setU } from '../../products/list/spStore'
import { SP_FLT_EMPTY } from '../../products/list/spModel'
import CtForm from './CtForm'
import PtFileImport from './PtFileImport'
import { useCtImp, ctGet, ctSet, ctForm, newForm_, ctPendUid_ } from './ctImpStore'
import './ptImport.css'

/* Nhập dữ liệu · ngành "Xây dựng · công tác phần thô" (renderImportPT_ phần form + danh sách, ctRecentList_, ctImpSave, ctPendEdit_,
   ctPendDel_, ctPendCommit_ / ctPendCommitRun_, ctFormRead_ - PUB/nhap.js:872-1025, phantho.js:1068-1083).
   Form chỉ đưa công tác vào DANH SÁCH CHỜ (panel phải, thẻ có Sửa / Xoá); bấm "Thêm công tác" mới ghi Database (POST /work-items
   từng công tác, lỗi thì ở lại kèm lý do), rồi tuỳ chọn thêm luôn vào bảng khái toán của dự án đang mở.
   Thanh số liệu + ô chọn Ngành hàng do ImportTab vẽ. Props: {} (cố định từ Batch 0). */
const img1 = v => mediaUrl(String(v || '').split('\n')[0].trim())
const hideImg = e => { e.currentTarget.style.visibility = 'hidden' }
const isAuth = e => !!(e && e.name === 'QsAuthError')

/* Đọc form thành bản ghi công tác (ctFormRead_ 'imp'): ảnh lấy từ khối Ảnh, bỏ ảnh xem trước chưa tải xong */
function ctFormRead_(form) {
  const d = form.d
  const v = k => String(d[k] == null ? '' : d[k]).trim()
  const num = k => { const t = v(k); return t === '' ? '' : ptN(t) }
  const anh = [form.main].concat(form.list || []).filter(x => x && String(x).indexOf('data:') !== 0).join('\n')
  let loai = v('loai'); const goc = v('loaiGoc')
  if (goc && ptLoaiGop_(goc) === loai) loai = goc       // vẫn là loại cũ -> giữ giá trị gốc
  return { loai, mode: v('mode'), maNhom: v('maNhom'), hangMuc: v('hangMuc'), deMuc: v('deMuc'), ten: v('ten'),
    ncc: v('ncc'), dvt: v('dvt'), kl: num('kl'), dt: num('dt'), hs: num('hs'),
    dgnt: ptMoneyN_(v('dgnt')), dg: ptMoneyN_(v('dg')),
    gc: v('gc'), thongSo: ctGrpText_(form.grps).trim(), phamVi: v('phamVi'), linkTaiLieu: v('linkTaiLieu'), hinhAnh: anh,
    thuTu: ctThuTuIn_(d.thuTu), maSP: v('maSP') }
}

export default function ImportPt() {
  const { cur, congTac, navigate, setHmNode } = useQs()
  const onTab = useQsStore(s => s.tab) === 'import'
  const form = useCtImp(s => s.form)
  const pd = useCtImp(s => s.pending)
  const ps = useCtImp(s => s.sessionAdded)
  const pendEdit = useCtImp(s => s.pendEdit)
  const committing = useCtImp(s => s.committing)
  const commitText = useCtImp(s => s.commitText)
  const uploading = useImp(s => s.imgUploading) || 0
  const [waitTxt, setWaitTxt] = useState('')
  const [editId, setEditId] = useState(null)
  const formRef = useRef(null)
  const hmList = useMemo(() => ctHangMucList_(ptLibrary_(congTac), congTac), [congTac])
  const sua = pendEdit ? pd.filter(x => x.uid === pendEdit)[0] : null

  const acc = {
    main: form.main, list: form.list,
    put: fn => ctForm(F => { const r = fn({ main: F.main, list: F.list }); return { main: r.main, list: r.list } }),
  }
  const setForm = fn => ctForm(F => fn(F))
  const resetForm = () => ctSet(s => ({ form: newForm_(null, s.ghiAll) }))

  // Bấm nút dưới form: đưa vào danh sách chờ (hoặc cập nhật đúng dòng đang sửa): CHƯA ghi Database
  async function impSave() {
    if (uploading > 0) { setWaitTxt('⏳ Đợi tải ảnh…'); await waitUploads_(15000); setWaitTxt('') }
    const F = ctGet().form
    const d = ctFormRead_(F)
    if (!d.ten) { qsToast('Nhập tên hạng mục / nội dung công việc'); return }
    if (!d.hangMuc) { qsToast('Nhập hạng mục'); return }
    if (!d.loai) { qsToast('Chọn Loại báo giá'); return }
    if (!d.mode) { qsToast('Chọn Cách tính'); return }
    if (d.thuTu === null) { qsToast('Thứ tự phải là số nguyên không âm (hoặc để trống)'); return }
    const ghi = !!F.ghi
    const st = ctGet(), x = st.pendEdit ? st.pending.filter(p => p.uid === st.pendEdit)[0] : null
    if (x) {
      ctSet(s => ({ pending: s.pending.map(p => (p.uid === x.uid ? { uid: p.uid, d, ghi } : p)) }))
      qsToast('Đã cập nhật "' + d.ten + '" trong danh sách chờ')
    } else {
      ctSet(s => ({ pending: [{ uid: ctPendUid_(), d, ghi }].concat(s.pending) }))
      qsToast('Đã đưa "' + d.ten + '" vào danh sách chờ — bấm "Thêm công tác" để lưu vào Database')
    }
    ctSet(s => ({ pendEdit: null, form: newForm_(null, s.ghiAll) }))
  }
  async function pendEditOpen(x) {
    const st = ctGet()
    if (st.committing) { qsToast('Đang lưu vào Database — đợi xong rồi sửa'); return }
    if (st.pendEdit && st.pendEdit !== x.uid && !await qsConfirm('Đang sửa một công tác khác — bỏ các thay đổi chưa cập nhật?')) return
    ctSet({ pendEdit: x.uid, form: newForm_(x.d, x.ghi, !!x.chan) })
    const f = formRef.current; if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' })
    qsToast('Đã mở "' + x.d.ten + '" trong form — sửa xong bấm "Cập nhật vào danh sách chờ"')
  }
  async function pendDel(x) {
    if (!await qsConfirm('Xoá "' + x.d.ten + '" khỏi danh sách chờ?\n(Công tác chưa được lưu vào Database nên sẽ mất hẳn.)')) return
    const st = ctGet()
    if (!st.pending.some(p => p.uid === x.uid)) return
    ctSet(s => (s.pendEdit === x.uid
      ? { pending: s.pending.filter(p => p.uid !== x.uid), pendEdit: null, form: newForm_(null, s.ghiAll) }
      : { pending: s.pending.filter(p => p.uid !== x.uid) }))
  }
  async function commit() {
    const st = ctGet()
    if (st.committing) return
    // dòng nhập từ file còn lỗi (chan) ở lại danh sách chờ cho tới khi mở trong form và bấm Cập nhật
    const ds = st.pending.filter(x => !x.chan)
    if (!ds.length) { qsToast(st.pending.length ? 'Các công tác chờ đều còn lỗi — mở từng thẻ, sửa rồi bấm Cập nhật' : 'Chưa có công tác nào chờ lưu'); return }
    if (st.pendEdit && !await qsConfirm('Bạn đang sửa 1 công tác trong form nhưng chưa bấm "Cập nhật".\nLưu luôn bản CŨ của công tác đó?')) return
    ctSet({ committing: true, commitText: '' })
    try { await commitRun(ds) } finally { ctSet({ committing: false, commitText: '' }) }
  }
  async function commitRun(ds) {
    ctSet({ commitText: '⏳ Đang lưu 0/' + ds.length + '…' })
    let ok = 0, het = false
    const conLai = [], daLuu = [], loi = {}
    for (let k = 0; k < ds.length; k++) {
      const x = ds[k]
      try {
        const kq = await api.ctSave(x.d)
        ok++; daLuu.push(x)
        const row = (kq && kq.rows && kq.rows[0]) || x.d
        ctSet(s => ({ sessionAdded: [row].concat(s.sessionAdded) }))
      } catch (e) {
        loi[x.uid] = String((e && e.message) || e).slice(0, 160); conLai.push(x)
        if (isAuth(e)) { het = true; ds.slice(k + 1).forEach(y => conLai.push(y)); break }   // hết phiên: dừng, màn đăng nhập hiện ra
      }
      ctSet({ commitText: '⏳ Đang lưu ' + (k + 1) + '/' + ds.length + '…' })
    }
    const xong = {}; daLuu.forEach(x => { xong[x.uid] = 1 })
    // giữ dòng thêm trong lúc lưu; dòng lỗi mang nhãn "Lỗi" + lý do
    ctSet(s => {
      const pending = s.pending.filter(x => !xong[x.uid]).map(x => (loi[x.uid] ? { ...x, loi: loi[x.uid] } : x))
      return s.pendEdit && xong[s.pendEdit] ? { pending, pendEdit: null } : { pending }
    })
    let list = congTac
    try { list = await congTacActions.ctReload() } catch (e) { /* ctLoad tự ghi lỗi vào store */ }
    // Thêm vào bảng khái toán của dự án đang mở (những công tác đã tick)
    let them = 0
    if (cur) {
      const tpl = ptTpl_(cur.maDA, list), refs = []
      daLuu.filter(x => x.ghi).forEach(x => {
        const d = x.d
        const si = tpl.findIndex(t => t.db && t.t === d.hangMuc && ptLoaiGop_(ptSecLoai_(t)) === ptLoaiGop_(d.loai))
        const ii = si >= 0 ? tpl[si].items.findIndex(a => { const c = ctOf_(a); return c && c.ten === d.ten }) : -1
        if (si >= 0 && ii >= 0) refs.push([si, ii])
      })
      if (refs.length) them = Math.max(0, ptAddFromLib_(tpl, refs))
    }
    if (!ctGet().pendEdit) ctSet(s => ({ form: newForm_(null, s.ghiAll) }))
    if (het) return
    const msg = 'Đã lưu ' + ok + ' công tác vào Database' + (them ? (' · thêm ' + them + ' vào bảng khái toán') : '')
    if (conLai.length) {
      await qsAlert({ title: conLai.length + ' công tác chưa lưu được', ok: 'Đã hiểu',
        note: msg + '.\nCác dòng dưới đây vẫn nằm trong danh sách chờ (nhãn "Lỗi") — sửa rồi bấm Thêm công tác lại.',
        dong: conLai.map(x => (x.d.ten || '(không tên)') + ' — ' + loi[x.uid]) })
    } else qsToast(msg)
  }
  function xemDanhSach() {
    navigate('sanpham')
    setTimeout(() => { setU({ node: '3.1', f: SP_FLT_EMPTY(), page: 1, sel: {} }); setHmNode('3.1', 'sp') }, 300)
  }

  const live = id => (congTac || []).filter(c => c.id === id)[0]
  const cards = pd.map((x, i) => {
    const c = x.d, dangSua = pendEdit === x.uid
    const dmC = ctDeMucCua_(c)
    const phu = [c.hangMuc, dmC ? (dmC + ' ' + nodeName(dmC)) : '', c.dg ? (money(c.dg) + ' đ' + (c.dvt ? '/' + c.dvt : '')) : '', c.loai ? ptLoaiNgan_(c.loai) : '', c.ncc ? ('NT ' + c.ncc) : '', (c.thuTu !== '' && c.thuTu != null) ? ('Thứ tự ' + c.thuTu) : ''].filter(Boolean).join(' · ')
    return (
      <div key={x.uid} className={'qsi-pc' + (x.loi ? ' qsi-err' : '') + (dangSua ? ' qsi-editing' : '')}>
        {String(c.hinhAnh || '').split('\n')[0] ? <img className="qsi-pc-th" src={img1(c.hinhAnh)} alt="" onError={hideImg} /> : <span className="qsi-pc-th qsi-pc-noimg"><QsIcon name="image" size={14} /></span>}
        <div className="qsi-pc-mid">
          <div className="qsi-pc-name" title={c.ten || ''}>{c.ten || ''}</div>
          {phu ? <div className="qsi-pc-sub" title={phu}>{phu}</div> : null}
          {x.loi ? <div className="qsi-pc-loi">{x.loi}</div> : null}
          <span className="qsi-pc-tag">{dangSua ? 'Đang sửa' : (x.loi ? 'Lỗi — sửa lại' : 'Chờ lưu')}</span>
          {x.ghi ? <span className="qsi-pc-tag qsip-kt">+ khái toán</span> : null}
        </div>
        <div className="qsi-pc-act">
          <button className="qsi-pc-btn" title="Sửa — mở lại trong form" onClick={() => pendEditOpen(x)}><QsIcon name="edit" size={14} /></button>
          <button className="qsi-pc-btn qsi-del" title="Xoá khỏi danh sách chờ" onClick={() => pendDel(x)}><QsIcon name="trash" size={14} /></button>
        </div>
      </div>
    )
  })

  return (
    <div className="qsi-layout">
      <div className="qsi-dbwrap qsip-wrap" ref={formRef}>
        <PtFileImport />
        <ImgUpBlock key={form.seq} acc={acc} title="Ảnh công tác" moreLabel="Hình chi tiết công tác" mainOptional active={onTab} />
        <CtForm form={form} set={setForm} hmList={hmList} congTac={congTac} />
        <div className="qsi-savebar">
          {sua ? <div className="qsi-pe-note"><QsIcon name="edit" size={14} /> Đang sửa 1 công tác trong danh sách chờ — chỉnh xong bấm <b>Cập nhật</b></div> : null}
          <label className="qsi-ghck qsip-ghck"><input type="checkbox" checked={!!form.ghi}
            onChange={e => { const on = e.target.checked; ctSet(s => ({ ghiAll: on, form: { ...s.form, ghi: on } })) }} />
            {' '}Thêm luôn vào bảng khái toán của dự án đang chọn{cur ? (' — ' + cur.ten) : ' (chưa chọn dự án)'}</label>
          {sua ? (
            <>
              <button className="qsi-btn qsi-blue qsi-block" disabled={!!waitTxt} onClick={impSave}>{waitTxt || <><QsIcon name="check" size={15} /> Cập nhật vào danh sách chờ</>}</button>
              <button className="qsi-btn qsi-sm" onClick={() => ctSet(s => ({ pendEdit: null, form: newForm_(null, s.ghiAll) }))}>Huỷ sửa</button>
            </>
          ) : (
            <>
              <button className="qsi-btn qsi-blue qsi-block" disabled={!!waitTxt} onClick={impSave}>{waitTxt || 'Đưa vào danh sách chờ'}</button>
              <button className="qsi-btn qsi-sm" onClick={resetForm}>Xoá form</button>
            </>
          )}
        </div>
      </div>

      <div className="qsi-recent">
        <div className="qsi-recent-h">Công tác vừa nhập (phiên này) <span className="qsi-rcount">{pad2(pd.length + ps.length)}</span></div>
        <div className="qsi-recent-note">Danh sách này chỉ ghi lại thao tác của <b>phiên đang mở</b> — tải lại trang sẽ trống. Công tác đã lưu <b>vẫn nằm trong Database</b>: <a onClick={xemDanhSach}>xem Danh sách sản phẩm →</a></div>
        <div className="qsi-recent-b">
          {pd.length ? <><div className="qsi-pc-hd">Chờ lưu <span>{pd.length}</span><i>Chưa vào Database</i></div><div className="qsi-pc-list">{cards}</div></> : null}
          {pd.length && ps.length ? <div className="qsi-pc-hd qsi-done">Đã lưu vào Database <span>{ps.length}</span></div> : null}
          {(ps.length || !pd.length) ? (
            <table className="qsi-rtbl">
              <thead><tr><th className="qsi-c">Sửa</th><th className="qsi-c">STT</th><th>Nội dung công việc</th><th className="qsi-c">Hình ảnh</th><th>Loại báo giá</th><th>Đơn giá</th></tr></thead>
              <tbody>{ps.length ? ps.map((c0, i) => {
                const c = (c0.id && live(c0.id)) || c0      // sửa bằng hộp Cập nhật công tác xong thì hiện bản mới
                return (
                  <tr key={(c0.id || '') + '|' + i}>
                    <td className="qsi-c qsi-ract">{c0.id
                      ? <button className="qsi-redit" title="Sửa lại công tác này" onClick={() => setEditId(c0.id)}><QsIcon name="edit" size={13} /></button>
                      : <span className="qsi-redit qsi-dis" title="Không rõ bản ghi — mở Danh sách sản phẩm để sửa"><QsIcon name="edit" size={13} /></span>}</td>
                    <td className="qsi-c">{i + 1}</td>
                    <td className="qsi-rname">{c.ten || ''}{c.hangMuc ? <i className="qsi-rma">{c.hangMuc}</i> : null}</td>
                    <td className="qsi-c">{String(c.hinhAnh || '').split('\n')[0] ? <img className="qsi-rth" src={img1(c.hinhAnh)} alt="" onError={hideImg} /> : <span className="qsi-rth" />}</td>
                    <td>{ptLoaiNgan_(c.loai)}</td>
                    <td className="qsi-rdate">{c.dg ? money(c.dg) + ' đ' : '—'}</td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={6} className="qsi-empty">Chưa nhập công tác nào trong phiên này.<br />Công tác bạn nhập sẽ hiện ở đây — bấm <b>Thêm công tác</b> để lưu vào Database.</td></tr>
              )}</tbody>
            </table>
          ) : null}
        </div>
        <div className="qsi-rfoot">
          {pd.length ? <div className="qsi-rfoot-note"><b>{pd.length}</b> công tác đang chờ — <b>chưa</b> lưu vào Database</div> : null}
          <button className="qsi-btn qsi-blue qsi-block" disabled={!pd.length || committing} onClick={commit}>
            {committing ? (commitText || '⏳ Đang lưu vào Database…') : <><QsIcon name="plus" size={15} /> Thêm công tác{pd.length ? ' (' + pd.length + ')' : ''}</>}</button>
        </div>
      </div>
      {editId && <CtEditModal ctId={editId} onClose={() => setEditId(null)} onSaved={() => setEditId(null)} />}
    </div>
  )
}
