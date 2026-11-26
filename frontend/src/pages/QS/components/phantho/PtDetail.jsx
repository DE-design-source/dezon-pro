import { useEffect, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'
import ImgViewer from '../common/ImgViewer'
import { safeUrl_ } from '../common/DocsPopover'
import { mediaUrl } from '../../api/files'
import { money } from '../../lib/format.js'
import { useQsStore } from '../../state/store'
import { ptDetailData_, ptSpecRows_, ptLines_, ptKvDai_, ptInfo_, ptInfoKey_ } from './ptModel'
import { usePtUi, setPtUi, ptOvrAll_, ptInfoUser_ } from './ptState'
import { usePtTemplate } from './ptHooks'
import { ptAddFromLib, ptInfoSave } from './ptActions'
import CtEditModal from './CtEditModal'
import './phantho.css'

/* Panel "Thông tin công tác" mở khi bấm 1 công tác ở thư viện Phần thô (port ptShowDetail_ / ptHideDetail_ / ptDetailParts_ /
   ptMedia_ / ptKV_ / ptNotes_ / ptBullets_ / ptSpecRows_ / ptInfoForm_ / ptInfoEdit_ / ptInfoSave_, PUB/phantho.js:1758-1932).
   Không prop: công tác đang mở nằm ở ptState.detail {si, ii} (chỉ số trong bộ mẫu usePtTemplate()). Công tác CSDL -> "Sửa công tác"
   mở CtEditModal; công tác của thư viện mẫu -> "Sửa thông tin" (lưu projData.ptInfo, dùng chung cả công ty). */

function Kv({ k, v }) {
  if (v == null || v === '') return null
  return <div className={`qspt-spec${ptKvDai_(k, v) ? ' stack' : ''}`}><span className="k">{k}</span><span className="v">{v}</span></div>
}
function Notes({ text }) {
  const ls = ptLines_(text)
  return ls.length ? <div className="qspt-notes">{ls.map((l, i) => <div key={i} className="qspt-note">{l}</div>)}</div> : null
}

function InfoForm({ a, sec, infoU }) {
  const inf = ptInfo_(infoU, String(a[0]))
  const gcGoc = (sec.mode === 'none') ? (a[2] || '') : (a[4] || '')
  const [v, setV] = useState({ model: inf.model || '', anh: inf.anh || '', ts: inf.ts || '', gc: inf.gc || '', pv: inf.pv || '', tl: inf.tl || '' })
  const F = (k, lbl, hint, rows, note) => (
    <div className="qspt-inf-f">
      <label>{lbl}</label>
      <textarea rows={rows || 2} placeholder={hint} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} />
      {note ? <i className="qspt-inf-h">{note}</i> : null}
    </div>
  )
  function save() {
    const o = {}; Object.keys(v).forEach(k => { o[k] = String(v[k] || '').replace(/\s+$/, '') })
    ptInfoSave(a, o, ptInfoKey_)
    setPtUi({ infoEdit: false })
  }
  return (
    <div className="qspt-inf-form">
      <div className="qspt-psec">Sửa thông tin công tác</div>
      {F('model', 'Tên / model', 'VD: Giàn tải, máy ép cọc Pmax 90T', 1)}
      {F('anh', 'Ảnh (mỗi dòng 1 link)', 'https://… (dán link ảnh, mỗi dòng một ảnh)', 2)}
      {F('ts', 'Thông số kỹ thuật (mỗi dòng "Tên: giá trị")', 'Lực ép tối đa (Pmax): 90 tấn\nLoại cọc phù hợp: vuông 250×250, tròn ly tâm D300', 5)}
      {F('gc', 'Ghi chú · điều kiện áp dụng', gcGoc || 'VD: Đơn giá cho trên 20m/tim cọc (tùy địa chất khu vực)', 3,
        gcGoc ? 'Để trống = dùng ghi chú gốc trong bảng giá thư viện.' : 'Công tác này chưa có ghi chú gốc — nhập ở đây để hiện trên panel.')}
      {F('pv', 'Phạm vi ứng dụng (mỗi dòng 1 ý)', 'Nhà phố, biệt thự, công trình tải trung bình\nYêu cầu mặt bằng thi công', 3)}
      {F('tl', 'Link tài liệu kỹ thuật', 'https://…', 1)}
      <div className="qspt-inf-act">
        <button className="qspt-btn ghost sm" onClick={() => setPtUi({ infoEdit: false })}>Huỷ</button>
        <button className="qspt-btn blue sm" onClick={save}><QsIcon name="check" size={14} /> Lưu thông tin</button>
      </div>
    </div>
  )
}

export default function PtDetail({ width } = {}) {
  const tpl = usePtTemplate()
  const detail = usePtUi(s => s.detail)
  const infoEdit = usePtUi(s => s.infoEdit)
  const contractor = usePtUi(s => s.contractor)
  const projData = useQsStore(s => s.projData)
  const [idx, setIdx] = useState(0)
  const [view, setView] = useState('')
  const [edit, setEdit] = useState(null)
  const bodyRef = useRef(null)
  const sec = detail ? tpl[detail.si] : null
  const a = sec ? sec.items[detail.ii] : null

  useEffect(() => { setIdx(0); if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [detail && detail.si, detail && detail.ii])
  // ←/→ lật ảnh (pdPanelKey_ PUB/app.js:1276-1282); đang xem ảnh lớn / đang gõ thì để yên.
  // Thêm: bỏ qua khi bảng tính đã dùng phím (defaultPrevented) hoặc đang mở hộp thoại / form sửa, để không lật ảnh khi đi ô.
  useEffect(() => {
    if (!a) return undefined
    const key = e => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || view || edit || e.defaultPrevented) return
      const t = document.activeElement, tg = t ? t.tagName : ''
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return
      if (document.querySelector('.qsc-ov')) return
      e.preventDefault()
      setIdx(i => i + (e.key === 'ArrowLeft' ? -1 : 1))
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [a, view, edit])

  if (!a) return null
  const close = () => setPtUi({ detail: null, infoEdit: false })
  const infoU = ptInfoUser_(projData)
  const P = ptDetailData_(sec, a, detail.ii, ptOvrAll_(), infoU, contractor)
  const imgs = P.imgs.map(v => mediaUrl(v))
  const n = imgs.length, at = n ? (((idx % n) + n) % n) : 0
  const ctr0 = P.ctr
  const chinh = P.chinh.filter(r => r[1] != null && r[1] !== '')
  const specs = P.inf.ts ? ptSpecRows_(P.inf.ts) : []
  return (
    <div className="qs-card qs-bd-info qspt-detail" style={width ? { width } : undefined}>
      <div className="qs-bd-info-head qspt-dhead">
        <span>Thông tin công tác</span>
        {!infoEdit && (ctr0
          ? <span className={`qspt-duyet${ctr0.daDuyet ? ' on' : ''}`}>{ctr0.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span>
          : <span className="qspt-duyet mau">Thư viện mẫu</span>)}
        <button className="qs-bd-info-close" title="Đóng" onClick={close}><QsIcon name="x" size={15} /></button>
      </div>
      <div className="qs-bd-info-body" ref={bodyRef}>
        {infoEdit ? <InfoForm key={detail.si + ':' + detail.ii} a={a} sec={sec} infoU={infoU} /> : (
          <>
            {n > 0 && (
              <div className="qspt-gal">
                <div className="qspt-imgbox">
                  <img key={at} src={imgs[at]} alt="" title="Bấm để xem ảnh lớn" onClick={() => setView(imgs[at])} onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                  {n > 1 && <button className="qspt-gnav prev" title="Ảnh trước (←)" onClick={() => setIdx(i => i - 1)}>‹</button>}
                  {n > 1 && <button className="qspt-gnav next" title="Ảnh sau (→)" onClick={() => setIdx(i => i + 1)}>›</button>}
                  {n > 1 && <span className="qspt-gcount">{at + 1}/{n}</span>}
                  <a className="qspt-gdl" href={safeUrl_(imgs[0])} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc"><QsIcon name="download" size={14} /></a>
                </div>
                {n > 1 && (
                  <div className="qspt-thumbs">
                    {imgs.map((v, i) => <button key={i} className={`qspt-thumb${i === at ? ' on' : ''}`} title={'Ảnh ' + (i + 1)} onClick={() => setIdx(i)}><img src={v} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /></button>)}
                  </div>
                )}
              </div>
            )}
            <div className="qspt-pcode">{P.code}</div>
            <div className="qspt-pname">{P.ten}</div>
            <div className="qspt-hero">
              <div className="qspt-hero-t">Đơn giá bán</div>
              <div className="qspt-hero-v">{money(P.dgBan)}<i>đ{P.dvt ? ' / ' + P.dvt : ''}</i></div>
              {(P.dgNT || P.ln) ? (
                <div className="qspt-hero-r">
                  {P.dgNT ? <span><em>Giá nhà thầu</em><b>{money(P.dgNT)} đ</b></span> : null}
                  {(P.dgBan && P.dgNT) ? <span><em>Lợi nhuận</em><b className={P.ln < 0 ? 'neg' : 'ok'}>{money(P.ln)} đ · {P.lnPct.toFixed(1)}%</b></span> : null}
                </div>
              ) : null}
            </div>
            {chinh.length > 0 && <div className="qspt-pblock"><div className="qspt-psec">Thông tin chính</div>{chinh.map((r, i) => <Kv key={i} k={r[0]} v={r[1]} />)}</div>}
            {specs.length > 0 && (
              <div className="qspt-pblock"><div className="qspt-psec">Thông số kỹ thuật tham khảo</div>
                {specs.map((x, i) => (x.grp ? <div key={i} className="qspt-pgrp">{x.grp}</div> : x.kv ? <Kv key={i} k={x.kv[0]} v={x.kv[1]} /> : <Notes key={i} text={x.notes.join('\n')} />))}
              </div>
            )}
            {P.gc ? (
              <div className="qspt-pblock"><div className="qspt-psec">Ghi chú · điều kiện áp dụng</div><Notes text={P.gc} />
                {P.inf.gc && P.gcGoc && P.inf.gc !== P.gcGoc ? <div className="qspt-pgoc">Ghi chú gốc trong bảng giá: {P.gcGoc}</div> : null}
              </div>
            ) : null}
            {P.inf.pv ? <div className="qspt-pblock"><div className="qspt-psec">Phạm vi ứng dụng</div><ul className="qspt-uls">{ptLines_(P.inf.pv).map((l, i) => <li key={i}>{l}</li>)}</ul></div> : null}
            {P.thieu ? <div className="qspt-thieu">{P.thieu}</div> : null}
            {P.inf.tl ? (
              <div className="qspt-foot2">
                <a className="qspt-fbtn" href={safeUrl_(P.inf.tl)} target="_blank" rel="noopener noreferrer"><QsIcon name="doc" size={14} /> Tài liệu kỹ thuật</a>
                <a className="qspt-fbtn" href={safeUrl_(P.inf.tl)} download target="_blank" rel="noopener noreferrer"><QsIcon name="download" size={14} /> Tải về</a>
              </div>
            ) : null}
          </>
        )}
      </div>
      {!infoEdit && (
        <div className="qspt-dact">
          {ctr0
            ? <button className="qspt-btn ghost sm" onClick={() => setEdit(ctr0.id)}><QsIcon name="edit" size={14} /> Sửa công tác</button>
            : <button className="qspt-btn ghost sm" onClick={() => setPtUi({ infoEdit: true })}><QsIcon name="edit" size={14} /> Sửa thông tin</button>}
          <button className="qspt-btn blue sm" onClick={() => ptAddFromLib(sec, a)}><QsIcon name="plus" size={14} /> Thêm vào bảng</button>
        </div>
      )}
      {view && <ImgViewer src={view} gallery={imgs} onClose={() => setView('')} />}
      {edit && <CtEditModal ctId={edit} onClose={() => setEdit(null)} onSaved={() => setEdit(null)} />}
    </div>
  )
}
