import { memo, useState } from 'react'
import QsIcon from '../common/QsIcon'
import { qsToast } from '../common/dialogs'
import { coSpec_ } from '../../lib/productFields'
import { mediaUrl, templateUrl } from '../../api/files'
import { useImp } from './importStore'
import { impUploadFiles_, pickFiles_ } from './imgUpload'
import { impParseFile_, impVsCheck_, impSpec_, impImgs_, impCommitBulk_ } from './importActions'
import DbCard from './DbCard'

/* Thẻ "Nhập hàng loạt từ file" + bảng xem trước (port renderImport phần file mẫu, sonTplBtn_, impPick, impShow, impRow_, impEdit,
   impRerow_, impVsSummary_, impImgCell2_, impPickMain / impPickMore / impDelImg, impCommit — PUB/nhap.js:702-719, 851-861, 1147-1296).
   Ô bảng sửa thẳng p._raw như bản gốc (contenteditable), dòng chỉ vẽ lại khi rời ô HẠNG MỤC. */
/* Máy chủ API khác nguồn nên trình duyệt bỏ qua thuộc tính download, mà mẫu đèn không có Content-Disposition (tải về thành
   "mau-nhap-hang-loat.xlsx") -> tải blob rồi lưu đúng tên bản gốc (PUB/nhap.js:855-859). Lỗi thì báo, không im lặng. */
async function dlTpl_(e, name) {
  e.preventDefault()
  const url = e.currentTarget.href
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const u = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 1500)
  } catch (err) { qsToast('Lỗi tải file mẫu: ' + (err.message || err)) }
}
function TplBtn({ loai, hmVal, specs }) {
  if (loai === 'vs') return <a className="qsi-btn qsi-sm" href={templateUrl('vs')} download="Mau-nhap-thiet-bi-ve-sinh-DezonQS.xlsx" onClick={e => dlTpl_(e, 'Mau-nhap-thiet-bi-ve-sinh-DezonQS.xlsx')}><QsIcon name="download" size={14} /> Tải file mẫu thiết bị vệ sinh</a>
  if (loai === 'ct') return <a className="qsi-btn qsi-sm" href={templateUrl('ct')} download="Mau-nhap-cong-tac-o-cam-DezonQS.xlsx" onClick={e => dlTpl_(e, 'Mau-nhap-cong-tac-o-cam-DezonQS.xlsx')} title="1 file cho cả ổ cắm và công tắc — cột HẠNG MỤC quyết định bộ thông số"><QsIcon name="download" size={14} /> Tải file mẫu công tắc - ổ cắm</a>
  if (loai === 'dl') return <a className="qsi-btn qsi-sm" href={templateUrl('dl')} download="Mau-nhap-dien-lanh-DezonQS.xlsx" onClick={e => dlTpl_(e, 'Mau-nhap-dien-lanh-DezonQS.xlsx')} title="1 file cho điều hoà, vật tư lắp đặt và thông gió — cột HẠNG MỤC quyết định bộ thông số"><QsIcon name="download" size={14} /> Tải file mẫu điện lạnh</a>
  if (loai === 'son') {
    // file mẫu sơn nước chỉ gồm thông số của hạng mục đang chọn ở form
    const hm = specs && specs.SON_SPEC ? (specs.SON_SPEC.chuanHM(hmVal) || '') : ''
    if (!hm) return <button className="qsi-btn qsi-sm" disabled title="Chọn Hạng mục ở khối Thông tin cơ bản trước — file mẫu sẽ đúng bộ thông số của hạng mục đó"><QsIcon name="download" size={14} /> Tải file mẫu — chọn hạng mục trước</button>
    return <a className="qsi-btn qsi-sm" href={templateUrl('son', hm)} title={'File mẫu chỉ gồm thông số của hạng mục ' + hm}><QsIcon name="download" size={14} /> Tải file mẫu · {hm}</a>
  }
  return <a className="qsi-btn qsi-sm" href={templateUrl('sp')} download="Mau-nhap-hang-loat-DezonQS.xlsx" onClick={e => dlTpl_(e, 'Mau-nhap-hang-loat-DezonQS.xlsx')}><QsIcon name="download" size={14} /> Tải file mẫu</a>
}

function ImgCell({ p, onChange }) {
  const [wait, setWait] = useState(false)
  const imgs = impImgs_(p), main = imgs[0] || '', more = imgs.slice(1)
  const setImgs = arr => { p.hinhAnh = arr.filter(Boolean).join('\n'); onChange() }
  const pick = (multi, fn) => pickFiles_(multi, 'image/*', async fs => {
    if (!fs.length) return
    setWait(true)
    try { fn(await impUploadFiles_(multi ? fs : fs.slice(0, 1))) } finally { setWait(false) }
  })
  const del = idx => { const cur = impImgs_(p); cur.splice(idx, 1); setImgs(cur) }
  if (wait) return <span className="qsi-iiwait">⏳ Đang tải…</span>
  return (
    <div className="qsi-iicell">
      <div className="qsi-iislot"><span className="qsi-iilb">Ảnh chính</span>
        {main ? (
          <div className="qsi-iithumb"><img src={mediaUrl(main)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /><button className="qsi-iix" title="Xoá" onClick={() => del(0)}>✕</button></div>
        ) : (
          <button className="qsi-iiadd" title="Tải ảnh chính" onClick={() => pick(false, toks => { let cur = impImgs_(p); if (toks.length) { if (cur.length) cur[0] = toks[0]; else cur = [toks[0]] } setImgs(cur) })}><QsIcon name="camera" size={16} /></button>
        )}</div>
      <div className="qsi-iislot"><span className="qsi-iilb">Ảnh chi tiết</span><div className="qsi-iimore">
        {more.map((u, k) => (
          <div className="qsi-iithumb qsi-sm" key={k + '|' + u}><img src={mediaUrl(u)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /><button className="qsi-iix" onClick={() => del(k + 1)}>✕</button></div>
        ))}
        <button className="qsi-iiadd qsi-sm" title="Thêm ảnh chi tiết" onClick={() => pick(true, toks => setImgs(impImgs_(p).concat(toks)))}>＋</button>
      </div></div>
    </div>
  )
}

/* Một dòng: chỉ vẽ lại khi rowVer đổi (rời ô HẠNG MỤC, đổi ảnh) để con trỏ không nhảy khi đang gõ */
const PvRow = memo(function PvRow({ p, i, heads, nganh, specs, onEdited, onRerow }) {
  const vs = coSpec_(nganh), ck = vs ? impVsCheck_(p, nganh, specs) : null
  const err = ck && ck.loi.length
  const edit = (e, h) => {
    const el = e.currentTarget
    if (!p._raw) p._raw = {}
    p._raw[h] = el.textContent
    const SP = vs ? impSpec_(nganh, specs) : null
    if (SP && SP.METRIC[h]) el.classList.toggle('qsi-iimiss', !el.textContent.trim() && impVsCheck_(p, nganh, specs).thieu[h] === 1)
    // đồng bộ vài trường cơ bản để danh sách chờ hiển thị đúng
    if (h === 'TÊN SẢN PHẨM') p.ten = el.textContent
    else if (h === 'THƯƠNG HIỆU') p.thuongHieu = el.textContent
    else if (h === 'MÃ SẢN PHẨM') p.ma = el.textContent
    onEdited()
  }
  return (
    <tr className={err ? 'qsi-iierr' : undefined} title={err ? (ck.hm || '') + (ck.hm ? ': ' : '') + ck.loi.join(', ') : undefined}>
      <td className="qsi-iisttd">{i + 1}{err ? <span className="qsi-iiwarn" title={ck.loi.join(', ')}>!</span> : null}</td>
      <td className="qsi-iiimgtd"><ImgCell p={p} onChange={() => onRerow(i)} /></td>
      {heads.map(h => {
        // cột thông số không thuộc hạng mục của dòng này -> khoá, không nhập
        if (ck && ck.na[h]) return <td key={h} className="qsi-iina" title={'Không áp dụng cho ' + ck.hm}>—</td>
        const miss = ck && (ck.thieu[h] || (h === 'HẠNG MỤC' && !ck.hm))
        const v = p._raw && p._raw[h] != null ? String(p._raw[h]) : ''
        return (
          <td key={h} className={'qsi-iied' + (miss ? ' qsi-iimiss' : '')} contentEditable suppressContentEditableWarning spellCheck={false}
            onInput={e => edit(e, h)} onBlur={h === 'HẠNG MỤC' && vs ? () => onRerow(i) : undefined}>{v}</td>
        )
      })}
    </tr>
  )
}, (a, b) => a.ver === b.ver && a.p === b.p && a.specs === b.specs)

function Preview({ bulk, specs }) {
  const [rowVer, setRowVer] = useState({})
  const [, setTick] = useState(0)
  const [btn, setBtnSt] = useState({ dis: false, text: '' })
  const ps = bulk.products || [], heads = bulk.headers || [], res = bulk.res || {}
  const vs = coSpec_(bulk.nganh)
  const nImg = ps.filter(p => p.hinhAnh).length
  const loiN = vs ? ps.filter(p => impVsCheck_(p, bulk.nganh, specs).loi.length).length : 0
  const rerow = i => setRowVer(r => ({ ...r, [i]: (r[i] || 0) + 1 }))
  const recog = Object.keys(res.mapped || {}).map(k => res.mapped[k]).join(' · ')
  return (
    <>
      <div className="qsi-pv-info">
        <div className="qsi-pv-h">Đọc được <b>{res.count}</b> sản phẩm · <b>{heads.length}</b> cột từ file</div>
        <div className="qsi-pv-sub"><QsIcon name="image" size={15} /> Tải <b>ảnh chính</b> và <b>ảnh chi tiết</b> cho từng SP ở cột đầu — <b style={{ color: nImg < ps.length ? '#c9820a' : '#1a7f37' }}>{nImg}</b>/{res.count} đã có ảnh</div>
        {vs && (
          <div className="qsi-pv-sub">{loiN
            ? <span><b style={{ color: '#c33' }}>{loiN}</b> dòng thiếu thông số bắt buộc / sai hạng mục (ô viền đỏ) — sẽ KHÔNG được nhập nếu chưa sửa</span>
            : <span style={{ color: '#1a7f37' }}>Mọi dòng đủ thông số bắt buộc theo hạng mục</span>}</div>
        )}
      </div>
      <div className="qsi-pv-wrap">
        <table className="qsi-pvtbl">
          <thead><tr><th className="qsi-iistth">STT</th><th className="qsi-iiimgth">Ảnh (chính + chi tiết)</th>{heads.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{ps.map((p, i) => (
            <PvRow key={i} p={p} i={i} heads={heads} nganh={bulk.nganh} specs={specs} ver={rowVer[i] || 0}
              onEdited={() => { if (vs) setTick(t => t + 1) }} onRerow={rerow} />
          ))}</tbody>
        </table>
      </div>
      <div className="qsi-pv-foot">
        <button className="qsi-btn qsi-blue" disabled={btn.dis} onClick={() => impCommitBulk_((dis, text) => setBtnSt({ dis, text }))}>
          {btn.text || <><QsIcon name="check" size={15} /> Đưa {res.count} sản phẩm vào danh sách chờ</>}</button>
        <span className="qsi-pv-note">Cột nhận diện &amp; map DB: {recog}</span>
      </div>
    </>
  )
}

export default function BulkImport({ specs, loai, hmVal }) {
  const bulk = useImp(s => s.bulk)
  const onPick = e => { const f = e.target.files && e.target.files[0]; if (f) impParseFile_(f, specs) }
  return (
    <DbCard title="Nhập hàng loạt từ file" ic="download" note="Tải file mẫu → điền dữ liệu → chọn file lên. Hệ thống tự dò cột theo tiêu đề; tải ảnh cho từng SP rồi đưa vào danh sách chờ — bấm Thêm sản phẩm để lưu.">
      <div className="qsi-file-row">
        <TplBtn loai={loai} hmVal={hmVal} specs={specs} />
        <span className="qsi-file-sep" />
        <input key={bulk.fileSeq || 0} type="file" accept=".xlsx,.xls,.csv" onChange={onPick} />
      </div>
      <div className="qsi-preview">
        {bulk.msg ? <div className={bulk.msg.kind === 'err' ? 'qsi-pv-err' : 'qsi-pv-msg'}>{bulk.msg.text}</div>
          : (bulk.res && bulk.res.count ? <Preview key={bulk.ver} bulk={bulk} specs={specs} /> : null)}
      </div>
    </DbCard>
  )
}
