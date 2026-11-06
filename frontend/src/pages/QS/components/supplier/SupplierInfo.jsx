import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { mediaUrl, uploadRaw, saveBlob, DOC_MAX_MB } from '../../api/files'
import * as api from '../../api/qsApi'
import { qsToast as toast, qsConfirm } from '../common/dialogs'
import { safeUrl_ } from '../../lib/format.js'
import { prodDocs_ } from '../../lib/productFields.js'

/* 3 tab hồ sơ nhà cung cấp ở trang chi tiết: Giới thiệu · Đối tác ("Được tin dùng bởi") · Catalogue.
   Dữ liệu công ty 'nccInfo' = {thương hiệu: {gioiThieu, xuatXu, website, dienThoai, email, diaChi,
   doiTac: [{ten, loai, link, logo}], catalogue: [{url, name, at}]}} (api.getProjData / setProjData với mã '__cty', như nccLogo). */
const s_ = v => String(v == null ? '' : v).trim()
let infoCache = null
export function useNccInfo() {
  const [info, setInfo] = useState(infoCache || {})
  useEffect(() => {
    if (infoCache) return
    api.getProjData('__cty').then(d => { infoCache = (d && d.nccInfo && typeof d.nccInfo === 'object') ? d.nccInfo : {}; setInfo(infoCache) }, () => {})
  }, [])
  /* Ghi đè 1 phần hồ sơ của 1 thương hiệu; lỗi thì trả lại bản cũ */
  async function patch(ten, part) {
    const old = infoCache || {}
    const next = { ...old, [ten]: { ...(old[ten] || {}), ...part } }
    infoCache = next; setInfo(next)
    try { await api.setProjData('__cty', 'nccInfo', next); return true } catch (e) { infoCache = old; setInfo(old); toast('Lỗi lưu hồ sơ nhà cung cấp: ' + ((e && e.message) || e)); return false }
  }
  return { info, patch }
}

/* ---- Giới thiệu: đoạn giới thiệu bên trái, thẻ thông tin liên hệ bên phải; nút Sửa -> form tại chỗ ---- */
const INTRO_F = [['xuatXu', 'Xuất xứ', 'VD: Đức, Việt Nam'], ['website', 'Website', 'https://…'], ['dienThoai', 'Điện thoại', ''],
  ['email', 'Email', ''], ['diaChi', 'Địa chỉ / showroom', '']]
export function IntroTab({ ten, d, onSave }) {
  const [f, setF] = useState(null)
  const filled = s_(d.gioiThieu) || INTRO_F.some(r => s_(d[r[0]]))
  const edit = () => { const o = { gioiThieu: s_(d.gioiThieu) }; INTRO_F.forEach(r => { o[r[0]] = s_(d[r[0]]) }); setF(o) }
  async function save() {
    const o = {}
    Object.keys(f).forEach(k => { o[k] = s_(f[k]) })
    if (await onSave(o)) { setF(null); toast('Đã lưu giới thiệu ' + ten) }
  }
  if (f) {
    return (
      <div className="qs-sui-intro editing">
        <label className="qs-sui-fld wide"><span>Giới thiệu</span>
          <textarea rows={9} value={f.gioiThieu} autoFocus placeholder={'Lịch sử thương hiệu, thế mạnh, dòng sản phẩm chính của ' + ten + '…'} onChange={e => setF({ ...f, gioiThieu: e.target.value })} />
        </label>
        <div className="qs-sui-side">
          {INTRO_F.map(r => (
            <label key={r[0]} className="qs-sui-fld"><span>{r[1]}</span>
              <input value={f[r[0]]} placeholder={r[2]} type={r[0] === 'website' ? 'url' : 'text'} onChange={e => setF({ ...f, [r[0]]: e.target.value })} />
            </label>
          ))}
          <div className="qs-sui-btns">
            <button type="button" className="qs-pd-btn" onClick={() => setF(null)}>Huỷ</button>
            <button type="button" className="qs-pd-btn primary" onClick={save}><Icon name="check" size={14} /> Lưu</button>
          </div>
        </div>
      </div>
    )
  }
  if (!filled) {
    return (
      <div className="qs-pd-empty qs-sui-empty">
        <b>Chưa có giới thiệu về {ten}</b>
        <button type="button" className="qs-pd-btn primary" onClick={edit}><Icon name="edit" size={14} /> Viết giới thiệu</button>
      </div>
    )
  }
  const web = s_(d.website)
  return (
    <div className="qs-sui-intro">
      <div className="qs-sui-text">
        {s_(d.gioiThieu) ? s_(d.gioiThieu).split(/\n{2,}/).map((pa, i) => <p key={i}>{pa}</p>) : <p className="nil">Chưa có đoạn giới thiệu.</p>}
      </div>
      <div className="qs-sui-side">
        <dl className="qs-sui-kv">
          {INTRO_F.map(r => {
            const v = s_(d[r[0]])
            return (
              <div key={r[0]}><dt>{r[1]}</dt>
                <dd className={v ? '' : 'nil'}>{!v ? '—' : r[0] === 'website' ? <a href={safeUrl_(/^https?:/i.test(v) ? v : 'https://' + v)} target="_blank" rel="noopener noreferrer">{v.replace(/^https?:\/\//i, '')}</a>
                  : r[0] === 'email' ? <a href={'mailto:' + v}>{v}</a> : v}</dd>
              </div>
            )
          })}
        </dl>
        <button type="button" className="qs-pd-btn" onClick={edit}><Icon name="edit" size={14} /> Sửa giới thiệu</button>
      </div>
    </div>
  )
}

/* ---- Đối tác: "Được tin dùng bởi" kiến trúc sư / studio…; gợi ý nhanh từ KTS + studio của dự án đang dùng nhà cung cấp ---- */
const LOAI = ['Kiến trúc sư', 'Công ty thiết kế', 'Nhà thầu', 'Chủ đầu tư', 'Khác']
const ini_ = t => s_(t).split(/\s+/).filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase()
export function PartnerTab({ ten, d, onSave, projs }) {
  const list = Array.isArray(d.doiTac) ? d.doiTac : []
  // Form thêm nhiều đối tác 1 lần: mỗi hàng 1 đối tác (tên · loại · link); dán danh sách tên (mỗi dòng 1 tên) tự tách thành nhiều hàng
  const row_ = loai => ({ ten: '', loai: loai || LOAI[0], link: '' })
  const [rows, setRows] = useState(() => [row_(), row_(), row_()])
  const setRow = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const addRow = () => setRows(rs => [...rs, row_(rs.length ? rs[rs.length - 1].loai : '')])
  const delRow = i => setRows(rs => (rs.length > 1 ? rs.filter((r, j) => j !== i) : [row_()]))
  function pasteNames(i, e) {
    const t = e.clipboardData.getData('text')
    const names = t.split(/\r?\n/).map(s_).filter(Boolean)
    if (names.length < 2) return
    e.preventDefault()
    setRows(rs => {
      const loai = rs[i].loai
      const head = rs.slice(0, i)
      const tail = rs.slice(i + 1).filter(r => s_(r.ten) || s_(r.link))
      return [...head, ...names.map(n => ({ ...row_(loai), ten: n })), ...tail, row_(loai)]
    })
  }
  const logoRef = useRef(null)
  const [logoFor, setLogoFor] = useState(-1)
  const save = (next, msg) => onSave({ doiTac: next }).then(ok => { if (ok && msg) toast(msg) })
  const has = t => list.some(x => s_(x.ten).toLowerCase() === s_(t).toLowerCase())
  /* Thêm nhiều đối tác: bỏ hàng trống, trùng tên (với danh sách hoặc giữa các hàng) thì bỏ qua và báo */
  function addMany(items) {
    const seen = new Set()
    const ok = []
    const dup = []
    items.filter(x => s_(x.ten)).forEach(x => {
      const k = s_(x.ten).toLowerCase()
      if (has(x.ten) || seen.has(k)) { dup.push(s_(x.ten)); return }
      seen.add(k)
      ok.push({ ten: s_(x.ten), loai: x.loai, link: s_(x.link) })
    })
    if (!ok.length) { toast(dup.length ? 'Đã có trong danh sách: ' + dup.join(', ') : 'Nhập tên đối tác'); return false }
    save([...list, ...ok], 'Đã thêm ' + (ok.length === 1 ? 'đối tác ' + ok[0].ten : ok.length + ' đối tác') + (dup.length ? ' · bỏ qua trùng: ' + dup.join(', ') : ''))
    return true
  }
  const add = x => addMany([x])
  const nFill = rows.filter(r => s_(r.ten)).length
  function submitRows() {
    if (addMany(rows)) setRows(rs => [row_(rs[0].loai), row_(rs[0].loai), row_(rs[0].loai)])
  }
  async function del(j) {
    if (!await qsConfirm('Bỏ ' + list[j].ten + ' khỏi danh sách đối tác của ' + ten + '?')) return
    save(list.filter((x, i) => i !== j))
  }
  async function upLogo(file) {
    const j = logoFor
    if (!file || j < 0) return
    if (!/^image\//.test(file.type)) { toast('Chỉ nhận file ảnh'); return }
    try { const r = await uploadRaw(file); if (r && r.url) save(list.map((x, i) => (i === j ? { ...x, logo: r.url } : x)), 'Đã lưu logo ' + list[j].ten) } catch (e) { toast('Tải logo lỗi: ' + e.message) }
  }
  // Gợi ý: kiến trúc sư / studio của các dự án đang dùng sản phẩm nhà cung cấp này, chưa có trong danh sách
  const goiY = []
  ;(projs || []).forEach(p => {
    ;[[p.kienTrucSu, 'Kiến trúc sư'], [p.studio, 'Công ty thiết kế']].forEach(([t, loai]) => {
      if (s_(t) && !has(t) && !goiY.some(g => g.ten.toLowerCase() === s_(t).toLowerCase())) goiY.push({ ten: s_(t), loai })
    })
  })
  return (
    <div className="qs-sui-partner">
      <input ref={logoRef} type="file" accept="image/*" hidden onChange={e => { upLogo(e.target.files[0]); e.target.value = '' }} />
      <div className="qs-sui-h"><h3>Được tin dùng bởi</h3><span>{list.length ? list.length + ' đối tác' : 'Kiến trúc sư, công ty thiết kế… đã chọn ' + ten}</span></div>
      {list.length > 0 && (
        <div className="qs-sui-pgrid">
          {list.map((x, j) => (
            <div key={x.ten + j} className="qs-sui-pc">
              <button type="button" className={'av' + (x.logo ? ' img' : '')} title={x.logo ? 'Đổi logo' : 'Thêm logo'} onClick={() => { setLogoFor(j); if (logoRef.current) logoRef.current.click() }}>
                {x.logo ? <img src={mediaUrl(x.logo)} alt="" /> : ini_(x.ten)}
              </button>
              <b title={x.ten}>{x.ten}</b>
              <span className="lo">{x.loai === 'Studio thiết kế' ? 'Công ty thiết kế' : x.loai || 'Khác'}</span>
              {s_(x.link) && <a href={safeUrl_(/^https?:/i.test(x.link) ? x.link : 'https://' + x.link)} target="_blank" rel="noopener noreferrer" title={x.link}><Icon name="link" size={13} /> Xem</a>}
              <button type="button" className="del" title="Bỏ đối tác" onClick={() => del(j)}><Icon name="x" size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <form className="qs-sui-padd" onSubmit={e => { e.preventDefault(); submitRows() }}>
        <div className="qs-sui-prow head"><span>#</span><span>Tên kiến trúc sư / công ty thiết kế</span><span>Loại</span><span>Link (tuỳ chọn)</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="qs-sui-prow">
            <span className="no">{i + 1}</span>
            <input value={r.ten} placeholder={i ? '' : 'VD: KTS Nguyễn Văn A (dán nhiều dòng = nhiều hàng)'} onChange={e => setRow(i, 'ten', e.target.value)} onPaste={e => pasteNames(i, e)} />
            <select value={r.loai} onChange={e => setRow(i, 'loai', e.target.value)}>{LOAI.map(o => <option key={o}>{o}</option>)}</select>
            <input value={r.link} placeholder={i ? '' : 'Website, dezon.vn…'} onChange={e => setRow(i, 'link', e.target.value)} />
            <button type="button" className="rm" title="Bỏ hàng" onClick={() => delRow(i)}><Icon name="x" size={13} /></button>
          </div>
        ))}
        <div className="qs-sui-pft">
          <button type="button" className="qs-pd-btn" onClick={addRow}><Icon name="plus" size={14} /> Thêm hàng</button>
          <span>Enter để lưu · dán danh sách tên (mỗi dòng 1 tên) vào ô Tên để tách thành nhiều hàng</span>
          <button type="submit" className="qs-pd-btn primary" disabled={!nFill}><Icon name="check" size={14} /> Thêm {nFill > 1 ? nFill + ' đối tác' : 'đối tác'}</button>
        </div>
      </form>
      {goiY.length > 0 && (
        <div className="qs-sui-sug">
          <span>Gợi ý từ dự án đang dùng:</span>
          {goiY.map(g => <button type="button" key={g.ten} title={'Thêm ' + g.ten + ' (' + g.loai + ')'} onClick={() => add(g)}><Icon name="plus" size={12} />{g.ten}<small>{g.loai}</small></button>)}
        </div>
      )}
    </div>
  )
}

/* ---- Catalogue: nhiều cách thêm - kéo thả vào bất kỳ đâu trong tab (cả thư mục), chọn file / thư mục, chụp ảnh (điện thoại),
   dán Ctrl+V (file, ảnh chụp màn hình, link), dán link (nhận biết Google Drive, OneDrive, Dropbox, flipbook…),
   lấy từ tài liệu kỹ thuật của sản phẩm cùng thương hiệu ---- */
const CAT_ACCEPT = '.pdf,.xlsx,.xls,.ppt,.pptx,.doc,.docx,image/*'
const CAT_RE = /\.(pdf|xlsx?|pptx?|docx?|png|jpe?g|webp|gif|svg)$/i
const isHttp_ = u => /^https?:/i.test(s_(u))
const normUrl_ = u => (isHttp_(u) ? s_(u) : 'https://' + s_(u))
const urlExt_ = u => (s_(u).split(/[?#]/)[0].match(/\.(\w{2,4})$/) || [])[1]
const ext_ = f => ((String(f.name).match(/\.(\w{2,4})$/) || [])[1] || urlExt_(f.url) || (isHttp_(f.url) ? 'link' : 'file')).toLowerCase()
const TY = { pdf: ['PDF', 'pdf'], xlsx: ['XLS', 'xls'], xls: ['XLS', 'xls'], ppt: ['PPT', 'ppt'], pptx: ['PPT', 'ppt'], doc: ['DOC', 'doc'], docx: ['DOC', 'doc'], link: ['LINK', 'lnk'] }
const KIND = [['pdf', 'PDF', /^pdf$/], ['img', 'Ảnh', /^(png|jpe?g|webp|gif|svg)$/], ['xls', 'Excel', /^xlsx?$/], ['ppt', 'PowerPoint', /^pptx?$/],
  ['doc', 'Word', /^docx?$/], ['link', 'Link', /^link$/]]
const kind_ = f => { const e = ext_(f); const k = KIND.find(r => r[2].test(e)); return k ? k[0] : 'other' }
const SRC = [[/drive\.google|docs\.google/i, 'Google Drive'], [/onedrive\.live|1drv\.ms|sharepoint\.com/i, 'OneDrive'], [/dropbox\.com/i, 'Dropbox'],
  [/issuu\.com|fliphtml5|anyflip|flipbuilder|heyzine/i, 'Flipbook'], [/youtube\.com|youtu\.be|vimeo\.com/i, 'Video']]
const src_ = u => {
  if (!isHttp_(u)) return ''
  const h = SRC.find(r => r[0].test(u))
  if (h) return h[1]
  try { return new URL(u).hostname.replace(/^www\./, '') } catch (e) { return 'Link' }
}
// Tên mặc định của link: tên file ở cuối đường dẫn nếu có đuôi, không thì "Catalogue <thương hiệu> (<nguồn>)"
const linkName_ = (u, ten) => {
  let seg = ''
  try { seg = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '') } catch (e) { /* link lạ: dùng tên mặc định */ }
  return CAT_RE.test(seg) ? seg : 'Catalogue ' + ten + ' (' + src_(u) + ')'
}
const fsize_ = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
/* Kéo thả cả thư mục: duyệt cây thư mục (webkitGetAsEntry), chỉ giữ file đúng loại catalogue.
   Phải lấy entry NGAY trong sự kiện drop (sau await thì dataTransfer rỗng). */
function dropFiles_(dt) {
  const ens = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean)
  if (!ens.some(en => en.isDirectory)) return Promise.resolve([...dt.files])
  const out = []
  const walk = en => new Promise(res => {
    if (en.isFile) { en.file(f => { if (CAT_RE.test(f.name)) out.push(f); res() }, () => res()); return }
    const rd = en.createReader(), all = []
    const next = () => rd.readEntries(es => { if (!es.length) Promise.all(all.map(walk)).then(res); else { all.push(...es); next() } }, () => res())
    next()
  })
  return Promise.all(ens.map(walk)).then(() => out)
}

export function CatalogueTab({ ten, d, onSave, sp }) {
  const list = Array.isArray(d.catalogue) ? d.catalogue : []
  const listRef = useRef(list)
  listRef.current = list
  const [q, setQ] = useState([]) // hàng đợi tải lên: {id, name, size, st: 'up'|'ok'|'err', msg}
  const [over, setOver] = useState(false)
  const [lk, setLk] = useState({ url: '', name: '' })
  const [pick, setPick] = useState(null) // bảng chọn tài liệu sản phẩm: {url: true}
  const [kind, setKind] = useState('')
  const fileRef = useRef(null), dirRef = useRef(null), camRef = useRef(null)
  const dragN = useRef(0)
  // Gộp vào bản MỚI NHẤT (tránh mất dữ liệu khi vừa dán vừa kéo thả cùng lúc)
  const append = (items, msg) => onSave({ catalogue: [...listRef.current, ...items] }).then(ok => { if (ok && msg) toast(msg) })
  const has = u => listRef.current.some(x => x.url === u)

  async function addFiles(files) {
    const ok = [...files].filter(f => f && f.size > 0)
    if (!ok.length) { if (files && files.length) toast('Không có file catalogue hợp lệ (PDF, ảnh, Excel, PowerPoint, Word)'); return }
    const jobs = ok.map((f, i) => ({ id: Date.now() + '-' + i + '-' + f.name, name: f.name, size: f.size, st: 'up', f }))
    setQ(cur => [...cur.filter(x => x.st !== 'ok'), ...jobs.map(({ f, ...x }) => x)])
    const added = []
    for (const j of jobs) {
      let st = 'ok', msg = ''
      try { const r = await uploadRaw(j.f); if (r && r.url) added.push({ url: r.url, name: j.name, at: new Date().toISOString() }); else { st = 'err'; msg = 'Máy chủ không trả đường dẫn' } } catch (e) { st = 'err'; msg = (e && e.message) || String(e) }
      setQ(cur => cur.map(x => (x.id === j.id ? { ...x, st, msg } : x)))
    }
    if (added.length) await append(added, 'Đã thêm ' + added.length + ' catalogue')
    setTimeout(() => setQ(cur => cur.filter(x => x.st !== 'ok')), 2500)
  }
  function addLinks(items) {
    const nw = []
    items.forEach(x => { const url = normUrl_(x.url); if (url.length > 8 && !has(url) && !nw.some(y => y.url === url)) nw.push({ ...x, url }) })
    if (!nw.length) { toast(items.length === 1 ? 'Link này đã có trong catalogue' : 'Các link đã có trong catalogue'); return Promise.resolve(false) }
    const at = new Date().toISOString()
    return append(nw.map(x => ({ url: x.url, name: s_(x.name) || linkName_(x.url, ten), at })), nw.length === 1 ? 'Đã thêm link catalogue' : 'Đã thêm ' + nw.length + ' link')
  }
  function submitLink(e) {
    e.preventDefault()
    if (!s_(lk.url)) { toast('Dán link catalogue vào ô Link'); return }
    addLinks([lk]).then(ok => { if (ok !== false) setLk({ url: '', name: '' }) })
  }

  // Dán Ctrl+V ở bất kỳ đâu trong trang (trừ khi đang gõ trong ô nhập): file, ảnh chụp màn hình, hoặc link
  const pasteRef = useRef(null)
  pasteRef.current = e => {
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const cd = e.clipboardData
    if (!cd) return
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
    const files = [...cd.files].map((f, i) => (/^image\.\w+$/i.test(f.name) ? new File([f], 'Anh-dan-' + stamp + (i ? '-' + i : '') + '.' + f.name.split('.').pop(), { type: f.type }) : f))
    if (files.length) { e.preventDefault(); addFiles(files); return }
    const urls = s_(cd.getData('text')).split(/\s+/).filter(u => /^https?:\/\/\S+$/i.test(u))
    if (urls.length) { e.preventDefault(); addLinks(urls.map(url => ({ url }))) }
  }
  useEffect(() => {
    const h = e => pasteRef.current(e)
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  }, [])

  // Kéo thả vào bất kỳ đâu trong tab; đếm enter/leave để lớp phủ không nháy khi rê qua phần tử con
  const isFileDrag = e => [...(e.dataTransfer.types || [])].includes('Files')
  const dnd = {
    onDragEnter: e => { if (!isFileDrag(e)) return; e.preventDefault(); dragN.current++; setOver(true) },
    onDragOver: e => { if (isFileDrag(e)) e.preventDefault() },
    onDragLeave: e => { if (!isFileDrag(e)) return; dragN.current = Math.max(0, dragN.current - 1); if (!dragN.current) setOver(false) },
    onDrop: e => { if (!isFileDrag(e)) return; e.preventDefault(); dragN.current = 0; setOver(false); dropFiles_(e.dataTransfer).then(addFiles) },
  }

  // Tài liệu kỹ thuật của các sản phẩm thương hiệu này, chưa có trong catalogue
  const docs = useMemo(() => {
    const seen = {}
    list.forEach(x => { seen[x.url] = 1 })
    const out = []
    ;(sp || []).forEach(p => prodDocs_(p).forEach(x => {
      if (seen[x.url]) return
      seen[x.url] = 1
      const seg = s_(x.url).split(/[?#]/)[0].split('/').pop()
      out.push({ url: x.url, g: x.g, spTen: p.ten, name: CAT_RE.test(seg) ? decodeURIComponent(seg) : x.g + ' - ' + p.ten })
    }))
    return out
  }, [sp, list])
  function addPicked() {
    const sel = docs.filter(x => pick[x.url])
    if (!sel.length) { toast('Chưa chọn tài liệu nào'); return }
    const at = new Date().toISOString()
    append(sel.map(x => ({ url: x.url, name: x.name, at })), 'Đã thêm ' + sel.length + ' tài liệu từ sản phẩm').then(() => setPick(null))
  }

  async function del(f) {
    if (!await qsConfirm('Xoá "' + f.name + '" khỏi catalogue của ' + ten + '?')) return
    onSave({ catalogue: listRef.current.filter(x => x !== f) })
  }

  const kinds = KIND.filter(k => list.some(f => kind_(f) === k[0]))
  const shown = kind ? list.filter(f => kind_(f) === kind) : list

  // Chọn nhiều catalogue (null = tắt): bấm thẻ để chọn, Shift + bấm chọn cả dải; Esc để thoát
  const [sel, setSel] = useState(null)
  const lastJ = useRef(-1)
  const picked = sel ? list.filter(f => sel[f.url]) : []
  const allOn = !!sel && shown.length > 0 && shown.every(f => sel[f.url])
  function toggle(j, shift) {
    const nx = { ...(sel || {}) }
    const v = !nx[shown[j].url]
    if (shift && lastJ.current >= 0 && lastJ.current < shown.length) {
      for (let i = Math.min(lastJ.current, j); i <= Math.max(lastJ.current, j); i++) nx[shown[i].url] = v
    } else nx[shown[j].url] = v
    lastJ.current = j
    setSel(nx)
  }
  const selAll = on => setSel(on ? { ...sel, ...Object.fromEntries(shown.map(f => [f.url, true])) } : {})
  useEffect(() => {
    if (!sel) return undefined
    const k = e => { if (e.key === 'Escape') setSel(null) }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [sel])
  async function dlSel() {
    const files = picked.filter(f => !isHttp_(f.url)), links = picked.length - files.length
    for (const f of files) {
      try { const r = await fetch(mediaUrl(f.url)); if (!r.ok) throw new Error('HTTP ' + r.status); saveBlob(await r.blob(), f.name) } catch (e) { toast('Tải "' + f.name + '" lỗi: ' + ((e && e.message) || e)) }
    }
    if (links) toast(links + ' mục là link ngoài, không tải được - dùng "Sao chép link"')
  }
  async function copySel() {
    const txt = picked.map(f => f.name + ': ' + (isHttp_(f.url) ? f.url : mediaUrl(f.url))).join('\n')
    try { await navigator.clipboard.writeText(txt); toast('Đã sao chép ' + picked.length + ' link') } catch (e) { toast('Trình duyệt chặn sao chép') }
  }
  async function delSel() {
    if (!await qsConfirm('Xoá ' + picked.length + ' catalogue đã chọn của ' + ten + '?')) return
    const rm = new Set(picked)
    if (await onSave({ catalogue: listRef.current.filter(x => !rm.has(x)) })) { toast('Đã xoá ' + rm.size + ' catalogue'); setSel(null) }
  }
  const upN = q.filter(x => x.st === 'up').length
  const errN = q.filter(x => x.st === 'err').length
  const nSel = pick ? docs.filter(x => pick[x.url]).length : 0
  return (
    <div className={'qs-sui-cat' + (over ? ' over' : '')} {...dnd}>
      <input ref={fileRef} type="file" accept={CAT_ACCEPT} multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={dirRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={e => { addFiles([...e.target.files].filter(f => CAT_RE.test(f.name))); e.target.value = '' }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      {over && <div className="qs-sui-catov"><Icon name="upload" size={34} /><b>Thả để thêm vào catalogue {ten}</b><span>File hoặc cả thư mục</span></div>}

      <div className="qs-sui-catadd">
        <div className="qs-sui-catdz" role="button" tabIndex={0} onClick={() => fileRef.current && fileRef.current.click()}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); fileRef.current && fileRef.current.click() } }}>
          <span className="ic"><Icon name="upload" size={24} /></span>
          <b>Kéo thả nhiều file hoặc cả thư mục vào đây</b>
          <span className="sub">hoặc bấm <kbd>Ctrl</kbd> + <kbd>V</kbd> để dán file, ảnh chụp màn hình, link</span>
          <div className="acts" onClick={e => e.stopPropagation()}>
            <button type="button" className="qs-pd-btn primary" title="Giữ Ctrl / Shift trong hộp chọn file để chọn nhiều file cùng lúc" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="file" size={14} /> Chọn nhiều file</button>
            <button type="button" className="qs-pd-btn" onClick={() => dirRef.current && dirRef.current.click()}><Icon name="folder" size={14} /> Tải cả thư mục</button>
            <button type="button" className="qs-pd-btn cam" onClick={() => camRef.current && camRef.current.click()}><Icon name="scan" size={14} /> Chụp ảnh</button>
          </div>
          <small>PDF, ảnh, Excel, PowerPoint, Word · tối đa {DOC_MAX_MB}MB/file - nặng hơn thì dán link</small>
        </div>

        <div className="qs-sui-catside">
          <form className="qs-sui-catcard" onSubmit={submitLink}>
            <div className="hd"><span className="ic"><Icon name="link" size={16} /></span><div><b>Dán link catalogue</b><span>Google Drive, OneDrive, Dropbox, flipbook, website hãng…</span></div></div>
            <input value={lk.url} placeholder="https://…" inputMode="url" onChange={e => setLk({ ...lk, url: e.target.value })} />
            <div className="row">
              <input value={lk.name} placeholder={s_(lk.url) ? linkName_(normUrl_(lk.url), ten) : 'Tên (tuỳ chọn)'} onChange={e => setLk({ ...lk, name: e.target.value })} />
              <button type="submit" className="qs-pd-btn primary"><Icon name="plus" size={14} /> Thêm</button>
            </div>
            {s_(lk.url) && <span className="src"><Icon name="check" size={12} /> Nguồn: {src_(normUrl_(lk.url))}</span>}
          </form>
          <div className={'qs-sui-catcard' + (docs.length ? '' : ' off')}>
            <div className="hd"><span className="ic"><Icon name="layers" size={16} /></span><div><b>Lấy từ tài liệu sản phẩm</b>
              <span>{docs.length ? docs.length + ' tài liệu kỹ thuật của sản phẩm ' + ten + ' chưa có ở đây' : 'Sản phẩm ' + ten + ' chưa có tài liệu kỹ thuật mới'}</span></div></div>
            {docs.length > 0 && <button type="button" className="qs-pd-btn" onClick={() => setPick(pick ? null : {})}><Icon name={pick ? 'chevronUp' : 'chevronDown'} size={14} /> {pick ? 'Đóng' : 'Chọn tài liệu'}</button>}
          </div>
        </div>
      </div>

      {pick && docs.length > 0 && (
        <div className="qs-sui-catpick">
          <div className="bar">
            <label><input type="checkbox" checked={nSel === docs.length} onChange={e => setPick(e.target.checked ? Object.fromEntries(docs.map(x => [x.url, true])) : {})} /> Chọn tất cả ({docs.length})</label>
            <button type="button" className="qs-pd-btn primary" disabled={!nSel} onClick={addPicked}><Icon name="plus" size={14} /> Thêm {nSel || ''} tài liệu</button>
          </div>
          <div className="ls">
            {docs.map(x => (
              <label key={x.url} className={pick[x.url] ? 'on' : ''}>
                <input type="checkbox" checked={!!pick[x.url]} onChange={e => setPick({ ...pick, [x.url]: e.target.checked })} />
                <span className={'ty ' + ((TY[ext_(x)] || [0, 'oth'])[1])}>{(TY[ext_(x)] || [ext_(x).toUpperCase().slice(0, 4)])[0]}</span>
                <span className="tx"><b title={x.name}>{x.name}</b><small>{x.g} · {x.spTen}</small></span>
              </label>
            ))}
          </div>
        </div>
      )}

      {q.length > 0 && (
        <div className="qs-sui-catq">
          <div className="bar">
            <b>{upN ? 'Đang tải lên ' + upN + ' file…' : errN ? errN + ' file lỗi' : 'Đã tải xong'}</b>
            {!upN && <button type="button" className="qs-pd-btn" onClick={() => setQ([])}><Icon name="x" size={13} /> Đóng</button>}
          </div>
          {q.map(x => (
            <div key={x.id} className={'it ' + x.st}>
              <span className="st">{x.st === 'up' ? <i className="spin" /> : <Icon name={x.st === 'ok' ? 'check' : 'alert'} size={14} />}</span>
              <span className="nm" title={x.name}>{x.name}</span>
              <span className="sz">{x.st === 'err' ? x.msg : fsize_(x.size)}</span>
            </div>
          ))}
        </div>
      )}

      {list.length ? (
        <>
          <div className="qs-sui-catbar">
            <b>{list.length} catalogue</b>
            {kinds.length > 1 && (
              <div className="qs-pd-nganh">
                <button type="button" className={!kind ? 'on' : ''} onClick={() => setKind('')}>Tất cả<small>{list.length}</small></button>
                {kinds.map(k => <button type="button" key={k[0]} className={kind === k[0] ? 'on' : ''} onClick={() => setKind(k[0])}>{k[1]}<small>{list.filter(f => kind_(f) === k[0]).length}</small></button>)}
              </div>
            )}
            {!sel && <button type="button" className="qs-pd-btn qs-sui-selbtn" onClick={() => { lastJ.current = -1; setSel({}) }}><Icon name="checkCircle" size={14} /> Chọn nhiều</button>}
          </div>
          {sel && (
            <div className="qs-sui-catsel">
              <label><input type="checkbox" checked={allOn} onChange={e => selAll(e.target.checked)} /> Chọn tất cả{kind ? ' (đang lọc)' : ''}</label>
              <b>Đã chọn {picked.length}</b>
              <span className="hint">Shift + bấm để chọn cả dải · Esc để thoát</span>
              <div className="acts">
                <button type="button" className="qs-pd-btn" disabled={!picked.length} onClick={dlSel}><Icon name="download" size={14} /> Tải xuống</button>
                <button type="button" className="qs-pd-btn" disabled={!picked.length} onClick={copySel}><Icon name="copy" size={14} /> Sao chép link</button>
                <button type="button" className="qs-pd-btn danger" disabled={!picked.length} onClick={delSel}><Icon name="trash" size={14} /> Xoá</button>
                <button type="button" className="qs-pd-btn" onClick={() => setSel(null)}>Xong</button>
              </div>
            </div>
          )}
          <div className={'qs-sui-cgrid' + (sel ? ' selecting' : '')}>
            {shown.map((f, j) => {
              const e = ext_(f)
              const img = /^(png|jpe?g|webp|gif|svg)$/.test(e)
              const ty = TY[e] || [e.toUpperCase().slice(0, 4), 'oth']
              const href = safeUrl_(isHttp_(f.url) ? f.url : mediaUrl(f.url))
              const src = src_(f.url)
              const on = !!(sel && sel[f.url])
              const pickMe = ev => { if (!sel) return; ev.preventDefault(); toggle(j, ev.shiftKey) }
              return (
                <div key={f.url + j} className={'qs-sui-cc' + (on ? ' on' : '')}>
                  <button type="button" className="ck" aria-pressed={on} title={on ? 'Bỏ chọn' : 'Chọn'} onClick={ev => { if (!sel) { lastJ.current = j; setSel({ [f.url]: true }) } else toggle(j, ev.shiftKey) }}>
                    {on && <Icon name="check" size={13} />}
                  </button>
                  <a className="cv" href={href} target="_blank" rel="noopener noreferrer" title={sel ? 'Chọn / bỏ chọn' : 'Mở / tải catalogue'} onClick={pickMe}>
                    {img ? <img src={mediaUrl(f.url)} alt="" loading="lazy" /> : <span className={'ty ' + ty[1]}>{ty[0]}</span>}
                    {src && <span className="sr"><Icon name="link" size={11} /> {src}</span>}
                  </a>
                  <a className="nm" href={href} target="_blank" rel="noopener noreferrer" title={f.name} onClick={pickMe}>{f.name}</a>
                  <small>{f.at ? new Date(f.at).toLocaleDateString('vi-VN') : ''}</small>
                  {!sel && <button type="button" className="del" title="Xoá" onClick={() => del(f)}><Icon name="x" size={13} /></button>}
                </div>
              )
            })}
          </div>
        </>
      ) : <div className="qs-sui-catempty">Chưa có catalogue của {ten}. Thêm bằng một trong các cách ở trên.</div>}
    </div>
  )
}
