import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { uploadRaw, mediaUrl } from '../../api/files'
import { qsToast as toast, qsConfirm, qsAsk } from '../common/dialogs'
import { MrootPortal } from '../common/Mroot'

/* Ảnh công trình của dự án (dữ liệu phụ khoá 'anhDuAn', ảnh đầu = ảnh bìa). Mỗi phần tử là chuỗi URL (bản cũ, chưa phân phòng)
   hoặc {url, phong}.
   HeroSlider: ảnh lớn đầu trang chi tiết như dezon.vn (‹ › + chấm); chưa có ảnh -> ô "Thêm hình ảnh dự án".
   ImageManager: tab Hình ảnh như trang dự án dezon.vn — mỗi phòng 1 hàng: tên phòng bên trái, dải ảnh cuộn ngang ‹ › bên phải;
   ô kéo thả / bấm để tải ảnh vào phòng đang chọn; mỗi ảnh có nút đặt làm ảnh bìa / đổi phòng / xoá.
   onSave(list) ghi lên máy chủ (ProjectDetail gọi api.setProjData). */
export const anhUrl_ = x => (x && typeof x === 'object' ? String(x.url || '') : String(x || ''))
const anhPhong_ = x => (x && typeof x === 'object' ? String(x.phong || '').trim() : '')
const anhOf_ = (url, phong) => (phong ? { url, phong } : url)
const KHAC = 'Chưa phân phòng'
const PHONG_GOI_Y = ['Phòng khách', 'Phòng bếp', 'Phòng ăn', 'Phòng ngủ', 'Phòng tắm', 'Phòng làm việc', 'Sảnh', 'Cầu thang', 'Ngoại thất']

export function HeroSlider({ list: raw, onAdd, onView }) {
  const [i, setI] = useState(0)
  const list = raw.map(anhUrl_)
  if (!list.length) {
    return (
      <button type="button" className="qs-pd-hero empty" onClick={onAdd}>
        <span className="ic"><Icon name="upload" size={30} /></span>
        <b>Chưa có hình ảnh dự án</b>
        <span>Bấm để thêm ảnh công trình (ảnh đầu tiên là ảnh bìa)</span>
      </button>
    )
  }
  const k = Math.min(i, list.length - 1)
  const go = d => setI((k + d + list.length) % list.length)
  return (
    <div className="qs-pd-hero slider">
      <button type="button" className="qs-pd-slide" onClick={() => onView(mediaUrl(list[k]))} title="Bấm để xem ảnh lớn"><img src={mediaUrl(list[k])} alt="" /></button>
      {list.length > 1 && (
        <>
          <button type="button" className="qs-pd-nav l" aria-label="Ảnh trước" onClick={() => go(-1)}><Icon name="chevronRight" size={22} /></button>
          <button type="button" className="qs-pd-nav r" aria-label="Ảnh sau" onClick={() => go(1)}><Icon name="chevronRight" size={22} /></button>
          <div className="qs-pd-dots">{list.map((u, j) => <button type="button" key={u + j} className={j === k ? 'on' : ''} aria-label={'Ảnh ' + (j + 1)} onClick={() => setI(j)} />)}</div>
        </>
      )}
    </div>
  )
}

/* Đọc file trong thư mục kéo thả (webkitGetAsEntry), trả [{file, dirs}] - dirs = các thư mục cha tính từ thư mục được thả */
function walkEntry_(entry, dirs, out) {
  if (entry.isFile) return new Promise(res => entry.file(f => { out.push({ file: f, dirs }); res() }, () => res()))
  if (!entry.isDirectory) return Promise.resolve()
  const rd = entry.createReader()
  const sub = dirs.concat(entry.name)
  return new Promise(res => {
    const all = []
    const more = () => rd.readEntries(es => { if (!es.length) { Promise.all(all.map(e => walkEntry_(e, sub, out))).then(res); return } all.push(...es); more() }, () => res())
    more()
  })
}
const isImg_ = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|avif|bmp)$/i.test(f.name)

/* Tab Hình ảnh: khung thêm ảnh (chọn ảnh · chọn thư mục · dán link · Ctrl+V · ảnh sản phẩm · chụp ảnh; cả khung nhận kéo thả file / thư mục)
   + các phòng. Thư mục: thư mục con cấp 1 = tên phòng (vd Verona/Phòng khách/a.jpg -> Phòng khách); ảnh lẻ vào phòng đang chọn.
   spImgs: ảnh sản phẩm của các dòng bóc tách (giá trị thô hinhAnh) cho cách "Ảnh sản phẩm" */
export function ImageManager({ list, onSave, onView, inputRef, spImgs }) {
  const [prog, setProg] = useState(null)        // {done, total} khi đang tải lên
  const [over, setOver] = useState(false)
  const [phong, setPhong] = useState('')       // phòng gán cho ảnh lẻ thêm tiếp theo
  const [spPick, setSpPick] = useState(null)    // hộp chọn ảnh sản phẩm: Set URL đang chọn
  const own = useRef(null)
  const inp = inputRef || own
  const dirRef = useRef(null)
  const camRef = useRef(null)
  const listRef = useRef(list)
  listRef.current = list
  // Nhóm theo phòng, giữ thứ tự gặp đầu tiên; ảnh chưa phân phòng xếp cuối. j = vị trí trong list (ảnh bìa = 0)
  const rooms = []
  const byName = {}
  list.forEach((x, j) => {
    const ten = anhPhong_(x) || KHAC
    if (!byName[ten]) rooms.push(byName[ten] = { ten, items: [] })
    byName[ten].items.push({ u: anhUrl_(x), j })
  })
  if (byName[KHAC]) rooms.push(rooms.splice(rooms.indexOf(byName[KHAC]), 1)[0])
  const goiY = [...new Set(rooms.map(r => r.ten).filter(t => t !== KHAC).concat(PHONG_GOI_Y))]
  const have = new Set(list.map(anhUrl_))
  const spList = [...new Set((spImgs || []).map(v => String(v || '').split('\n')[0].trim()).filter(Boolean))]
  const spNew = spList.filter(u => !have.has(u))
  const ph0 = () => phong.trim()

  /* Thêm ảnh đã có URL (link, ảnh sản phẩm) - không tải lên máy chủ */
  async function addUrls(urls, ph) {
    const add = [...new Set(urls)].filter(u => !have.has(u)).map(u => anhOf_(u, ph))
    if (!add.length) { toast('Các ảnh này đã có trong dự án'); return }
    await onSave([...listRef.current, ...add])
    toast('Đã thêm ' + add.length + ' ảnh' + (ph ? ' vào ' + ph : ''))
  }
  /* Tải lên [{file, phong}]: 3 file song song, giữ đúng thứ tự, lưu 1 lần khi xong */
  async function upload(items) {
    items = items.filter(x => isImg_(x.file))
    if (!items.length) { toast('Không có file ảnh (jpg, png, webp…)'); return }
    setProg({ done: 0, total: items.length })
    const out = new Array(items.length)
    let i = 0
    let loi = 0
    const worker = async () => {
      while (i < items.length) {
        const k = i++
        const it = items[k]
        try { const r = await uploadRaw(it.file); if (r && r.url) out[k] = anhOf_(r.url, it.phong) } catch (e) { loi++; if (loi <= 3) toast('Tải "' + it.file.name + '" lỗi: ' + e.message) }
        setProg(p => p && { ...p, done: p.done + 1 })
      }
    }
    await Promise.all([0, 1, 2].map(worker))
    setProg(null)
    const added = out.filter(Boolean)
    if (!added.length) return
    await onSave([...listRef.current, ...added])
    const ph = [...new Set(added.map(anhPhong_).filter(Boolean))]
    toast('Đã thêm ' + added.length + ' ảnh' + (ph.length === 1 ? ' vào ' + ph[0] : ph.length > 1 ? ' vào ' + ph.length + ' phòng' : '') + (loi ? ' · ' + loi + ' ảnh lỗi' : ''))
  }
  const addFiles = files => upload([...files].map(f => ({ file: f, phong: ph0() })))
  /* Chọn thư mục: webkitRelativePath = Gốc/Phòng/…/ảnh -> thư mục con cấp 1 là phòng; ảnh nằm thẳng trong Gốc -> phòng đang chọn */
  const addDir = files => upload([...files].map(f => { const d = String(f.webkitRelativePath || '').split('/').slice(0, -1); return { file: f, phong: d[1] || ph0() } }))
  /* Kéo thả: có thư mục -> đọc đệ quy (thả thư mục dự án thì thư mục con = phòng, thả thẳng thư mục phòng thì tên nó = phòng);
     kéo ảnh từ trang web khác -> lấy link */
  async function onDrop(e) {
    e.preventDefault(); setOver(false)
    if (prog) return
    const dt = e.dataTransfer
    const ents = [...(dt.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean)
    if (ents.some(x => x.isDirectory)) {
      const out = []
      await Promise.all(ents.map(en => walkEntry_(en, [], out)))
      upload(out.map(x => ({ file: x.file, phong: x.dirs[1] || x.dirs[0] || ph0() })))
      return
    }
    if (dt.files && dt.files.length) { addFiles(dt.files); return }
    const u = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim().split(/\s+/)[0]
    if (/^https?:\/\//i.test(u)) addUrls([u], ph0())
  }
  async function addLink() {
    const v = await qsAsk({ title: 'Thêm ảnh từ link', note: 'Dán 1 hoặc nhiều link ảnh, cách nhau bằng dấu cách. Ảnh không tải về máy chủ: trang gốc xoá ảnh thì ảnh mất.',
      label: 'Link ảnh', placeholder: 'https://…/anh.jpg https://…', ok: 'Thêm' })
    if (!v) return
    const urls = v.split(/\s+/).filter(x => /^https?:\/\//i.test(x))
    if (!urls.length) { toast('Link phải bắt đầu bằng http:// hoặc https://'); return }
    addUrls(urls, ph0())
  }
  // Ctrl+V ảnh (chụp màn hình, ảnh copy từ web) khi đang ở tab Hình ảnh; dán chữ vào ô nhập thì để yên
  const pasteRef = useRef(null)
  pasteRef.current = e => {
    const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImg_)
    if (!fs.length || prog) return
    e.preventDefault()
    const t = Date.now()
    upload(fs.map((f, k) => ({ file: new File([f], 'dan-anh-' + t + '-' + k + '.' + ((f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')), { type: f.type || 'image/png' }), phong: ph0() })))
  }
  useEffect(() => {
    const h = e => pasteRef.current(e)
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
  }, [])
  useEffect(() => { if (dirRef.current) dirRef.current.setAttribute('webkitdirectory', '') }, [])

  const pick = ten => { setPhong(ten === KHAC ? '' : ten); if (inp.current) inp.current.click() }
  async function del(j) {
    if (!await qsConfirm('Xoá ảnh này khỏi dự án?')) return
    onSave(list.filter((x, i) => i !== j))
  }
  const cover = j => onSave([list[j], ...list.filter((x, i) => i !== j)])
  async function move(j) {
    const v = await qsAsk({ title: 'Đổi phòng của ảnh', label: 'Tên phòng (bỏ trống = chưa phân phòng)', value: anhPhong_(list[j]), required: false, ok: 'Lưu' })
    if (v == null) return
    onSave(list.map((x, i) => (i === j ? anhOf_(anhUrl_(x), v) : x)))
  }
  async function rename(r) {
    const v = await qsAsk({ title: 'Đổi tên phòng', label: 'Tên phòng', value: r.ten === KHAC ? '' : r.ten, required: false, ok: 'Lưu' })
    if (v == null) return
    const js = new Set(r.items.map(it => it.j))
    onSave(list.map((x, i) => (js.has(i) ? anhOf_(anhUrl_(x), v) : x)))
  }
  const click = ref => () => { if (ref.current) ref.current.click() }
  // [icon, tên, mô tả, hành động (null = tắt)]
  const WAYS = [
    ['upload', 'Chọn ảnh', 'Nhiều ảnh từ máy tính', click(inp)],
    ['folder', 'Chọn thư mục', 'Thư mục con = tên phòng', click(dirRef)],
    ['link', 'Dán link ảnh', 'Ảnh trên web, dezon.vn…', addLink],
    ['clipboard', 'Dán ảnh', 'Copy ảnh rồi bấm Ctrl+V', () => toast('Copy ảnh (hoặc chụp màn hình) rồi bấm Ctrl+V ở trang này')],
    ['layers', 'Ảnh sản phẩm', spNew.length ? spNew.length + ' ảnh từ dòng bóc tách' : spList.length ? 'Đã thêm hết ảnh sản phẩm' : 'Dự án chưa có ảnh sản phẩm', spNew.length ? () => setSpPick(new Set()) : null],
    ['smartphone', 'Chụp ảnh', 'Máy ảnh điện thoại / máy tính bảng', click(camRef)],
  ]
  return (
    <div className="qs-pim">
      <input ref={inp} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={dirRef} type="file" multiple hidden onChange={e => { addDir(e.target.files); e.target.value = '' }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <div className={'qs-pim-up' + (over ? ' over' : '') + (list.length ? '' : ' first')}
        onDragOver={e => { e.preventDefault(); if (!over) setOver(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }} onDrop={onDrop}>
        <div className="qs-pim-uph">
          <span className="ic"><Icon name="upload" size={20} /></span>
          <div className="tx">
            <b>{list.length ? 'Thêm ảnh dự án' : 'Chưa có hình ảnh dự án'}</b>
            <span>Kéo thả ảnh hoặc cả thư mục vào khung này · Ctrl+V để dán ảnh · ảnh bìa (★) là ảnh bìa ở Danh sách dự án</span>
          </div>
          <label className="qs-pim-ph">
            <span>Vào phòng</span>
            <input list="qs-pim-rooms" value={phong} onChange={e => setPhong(e.target.value)} placeholder="Chưa phân phòng" />
            <datalist id="qs-pim-rooms">{goiY.map(t => <option key={t} value={t} />)}</datalist>
          </label>
        </div>
        <div className="qs-pim-ways">
          {WAYS.map(w => (
            <button type="button" key={w[1]} disabled={!w[3] || !!prog} onClick={w[3] || undefined}>
              <span className="wi"><Icon name={w[0]} size={18} /></span><b>{w[1]}</b><span>{w[2]}</span>
            </button>
          ))}
        </div>
        {prog && (
          <div className="qs-pim-prog">
            <span>Đang tải lên {prog.done}/{prog.total} ảnh…</span>
            <div className="tr"><i style={{ width: (prog.done / prog.total * 100) + '%' }} /></div>
          </div>
        )}
        {over && <div className="qs-pim-ovl"><Icon name="upload" size={30} /><b>Thả ảnh / thư mục vào đây</b><span>{ph0() ? 'Ảnh lẻ vào: ' + ph0() : 'Thư mục con = tên phòng'}</span></div>}
      </div>
      {rooms.map(r => (
        <RoomRow key={r.ten} r={r} onView={onView} onPick={() => pick(r.ten)} onRename={() => rename(r)}
          onCover={cover} onMove={move} onDel={del} />
      ))}
      {spPick && (
        <MrootPortal>
          <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget) setSpPick(null) }}>
            <div className="qsc-dlg qs-pim-spd" role="dialog" aria-modal="true">
              <div className="qsc-ask-h"><h3>Chọn ảnh sản phẩm trong dự án</h3><button type="button" className="qsc-x" onClick={() => setSpPick(null)}>✕</button></div>
              <div className="qs-pim-spg">
                {spNew.map(u => (
                  <button type="button" key={u} className={spPick.has(u) ? 'on' : ''} onClick={() => setSpPick(s => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n })}>
                    <img src={mediaUrl(u)} alt="" loading="lazy" /><i><Icon name="check" size={13} /></i>
                  </button>
                ))}
              </div>
              <div className="qsc-ask-btns">
                <button type="button" className="qsc-btn" onClick={() => setSpPick(spPick.size === spNew.length ? new Set() : new Set(spNew))}>{spPick.size === spNew.length ? 'Bỏ chọn hết' : 'Chọn hết'}</button>
                <button type="button" className="qsc-btn blue" disabled={!spPick.size} onClick={() => { addUrls([...spPick], ph0()); setSpPick(null) }}>Thêm {spPick.size || ''} ảnh{ph0() ? ' vào ' + ph0() : ''}</button>
              </div>
            </div>
          </div>
        </MrootPortal>
      )}
    </div>
  )
}

/* 1 phòng: tên bên trái, dải ảnh cuộn ngang bên phải (từ 6 ảnh xếp 2 hàng như dezon.vn); ‹ › chỉ hiện khi còn ảnh để cuộn */
function RoomRow({ r, onView, onPick, onRename, onCover, onMove, onDel }) {
  const ref = useRef(null)
  const [nav, setNav] = useState([false, false])
  const upd = () => {
    const el = ref.current
    if (el) setNav([el.scrollLeft > 4, el.scrollLeft + el.clientWidth < el.scrollWidth - 4])
  }
  useEffect(() => {
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [r.items.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const go = d => ref.current.scrollBy({ left: d * ref.current.clientWidth * 0.9, behavior: 'smooth' })
  return (
    <section className="qs-pim-room">
      <div className="qs-pim-rh">
        <h3 className={r.ten === KHAC ? 'nil' : ''}>{r.ten}</h3>
        <small>{r.items.length} ảnh</small>
        <div className="acts">
          <button type="button" title="Thêm ảnh vào phòng này" onClick={onPick}><Icon name="plus" size={14} />Thêm ảnh</button>
          <button type="button" title="Đổi tên phòng (mọi ảnh trong phòng)" onClick={onRename}><Icon name="edit" size={13} />Đổi tên</button>
        </div>
      </div>
      <div className="qs-pim-rail">
        <div ref={ref} className={'qs-pim-track' + (r.items.length >= 6 ? ' r2' : '')} onScroll={upd}>
          {r.items.map(({ u, j }) => (
            <div key={u + j} className="qs-pim-it">
              <button type="button" className="img" onClick={() => onView(mediaUrl(u))}><img src={mediaUrl(u)} alt="" loading="lazy" /></button>
              {j === 0 ? <span className="cover">Ảnh bìa</span>
                : <button type="button" className="act cv" title="Đặt làm ảnh bìa" onClick={() => onCover(j)}><Icon name="star" size={14} /></button>}
              <button type="button" className="act mv" title="Đổi phòng" onClick={() => onMove(j)}><Icon name="tag" size={13} /></button>
              <button type="button" className="act del" title="Xoá ảnh" onClick={() => onDel(j)}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
        {nav[0] && <button type="button" className="qs-pim-nav l" aria-label="Ảnh trước" onClick={() => go(-1)}><Icon name="chevronRight" size={34} /></button>}
        {nav[1] && <button type="button" className="qs-pim-nav r" aria-label="Ảnh sau" onClick={() => go(1)}><Icon name="chevronRight" size={34} /></button>}
      </div>
    </section>
  )
}
