import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'

/* Cột trái Bảng điều khiển: 2 thẻ cộng theo bộ lọc của Danh sách dự án (kiểu thẻ "Gross margin" + "Last 12 weeks").
   A = số đã cộng {n, von, ban, total, ln, bien, vats, groups:[{key, name, value}], done, fail, ready}; nDa = số dự án; label = nhãn bộ lọc.
   Thẻ 1 "Biên lợi nhuận": số % lớn -> chip lợi nhuận -> thanh Giá vốn (gạch chéo) | Lợi nhuận -> 4 dòng số.
   Thẻ 2 "Giá trị theo nhóm": mỗi nhóm 1 dòng tên + số tiền, dưới là thanh ngang (dài theo nhóm lớn nhất, nhóm lớn nhất tô đặc,
   còn lại gạch chéo) + % trên tổng. Tên dài xuống dòng, không bị cắt.
   Số tiền ở các dòng không kèm "đ" (gọn cột); phạm vi lọc nằm dòng riêng dưới tiêu đề để không bị cắt.
   Màn rộng: cột trái vừa 1 màn hình (không cuộn), thẻ 2 chiếm phần cao còn lại, hiện tối đa GRP_MAX ngành hàng:
   bộ tự chọn (lưu trong máy, qs_dash_grp) hoặc mặc định GRP_MAX nhóm lớn nhất. Nút tròn (>) ở góc phải đầu thẻ mở ô bên phải
   cột liệt kê đủ các nhóm (Danh sách dự án dời sang phải và co lại, lớp has-grp-panel trên .qs-dash-main); còn nhóm chưa hiện
   thì nút đỏ + số nhóm ẩn. Trong ô: nút sửa (bút chì) -> tích chọn tối đa GRP_MAX nhóm hiện ở thẻ bên trái, kéo thả (⋮⋮)
   để đổi thứ tự hiện (thứ tự trong qs_dash_grp = thứ tự ở thẻ trái); kéo nhóm chưa tích vào giữa nhóm đã tích = thêm vào đúng chỗ. Esc / ✕ để đóng. */
const f1 = x => (Math.round(x * 10) / 10).toLocaleString('vi-VN') + '%'
const GRP_MAX = 6
const GRP_LS = 'qs_dash_grp'
const loadPick_ = () => { try { const v = JSON.parse(localStorage.getItem(GRP_LS) || 'null'); return Array.isArray(v) ? v.map(String) : null } catch (e) { return null } }
const savePick_ = v => { try { if (v) localStorage.setItem(GRP_LS, JSON.stringify(v)); else localStorage.removeItem(GRP_LS) } catch (e) { /* bỏ qua */ } }

export default function DashSummary({ A, nDa, label }) {
  const ok = A.ready
  const neg = ok && A.ln < 0
  const vat = A.vats.size === 1 ? 'gồm VAT ' + [...A.vats][0] + '%' : 'gồm VAT'
  const vonPct = ok && A.ban > 0 ? Math.min(100, Math.max(0, A.von / A.ban * 100)) : 0
  const sum = A.groups.reduce((t, g) => t + g.value, 0) || 1
  const max = A.groups.reduce((m, g) => Math.max(m, g.value), 0) || 1
  const num = (x, cls) => (ok ? <b className={cls} title={money(x) + ' đ'}>{money(x)}</b> : <span className="qs-sum-sk" />)
  const pct = x => (x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)) + '%'
  const grpRef = useRef(null)
  const [more, setMore] = useState(false)     // danh sách nhóm dài hơn khung nhìn
  const [open, setOpen] = useState(false)     // ô "Giá trị theo nhóm" đầy đủ bên phải cột
  const [pick, setPickSt] = useState(loadPick_)   // khoá nhóm tự chọn hiện ở thẻ trái (null = GRP_MAX nhóm lớn nhất)
  const [editing, setEditing] = useState(false)
  const setPick = v => { setPickSt(v); savePick_(v) }
  const byVal = A.groups.slice().sort((a, b) => b.value - a.value)
  const byKey = {}; A.groups.forEach(g => { byKey[String(g.key)] = g })
  const picked = pick ? pick.map(k => byKey[k]).filter(Boolean).slice(0, GRP_MAX) : []
  const shown = picked.length ? picked : byVal.slice(0, GRP_MAX)
  const shownKeys = shown.map(g => String(g.key))
  const hidden = A.groups.length - shown.length
  const togglePick = k => {
    const cur = shownKeys.slice()
    const i = cur.indexOf(k)
    if (i >= 0) cur.splice(i, 1); else if (cur.length < GRP_MAX) cur.push(k); else return
    setPick(cur)
  }
  const panelRef = useRef(null)
  useEffect(() => {
    const el = grpRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const chk = () => setMore(el.scrollHeight > el.clientHeight + 2)
    const ro = new ResizeObserver(chk); ro.observe(el); chk()
    return () => ro.disconnect()
  }, [A.groups.length, ok])
  useEffect(() => {
    if (!open) return undefined
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    const main = panelRef.current && panelRef.current.closest('.qs-dash-main')
    if (main) main.classList.add('has-grp-panel')
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('keydown', esc); if (main) main.classList.remove('has-grp-panel') }
  }, [open])
  useEffect(() => { if (!open) setEditing(false) }, [open])
  /* kéo thả trong chế độ chọn: chỉ sắp trong nhóm đã tích (thả nhóm chưa tích vào đó = thêm nếu còn chỗ) */
  const dragK = useRef(null)
  const [over, setOver] = useState(null)   // {k, after}: vạch báo chỗ thả
  function dropOn(t, after) {
    const k = dragK.current; dragK.current = null; setOver(null)
    if (!k || k === t || shownKeys.indexOf(t) < 0) return
    if (shownKeys.indexOf(k) < 0 && shownKeys.length >= GRP_MAX) return
    const cur = shownKeys.filter(x => x !== k)
    cur.splice(cur.indexOf(t) + (after ? 1 : 0), 0, k)
    setPick(cur)
  }
  const dragProps = k => ({
    draggable: true,
    onDragStart: e => { dragK.current = k; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k) } catch (er) { /* bỏ qua */ } },
    onDragOver: e => {
      if (!dragK.current || shownKeys.indexOf(k) < 0) return
      e.preventDefault()
      const b = e.currentTarget.getBoundingClientRect(); const after = e.clientY > b.top + b.height / 2
      if (!over || over.k !== k || over.after !== after) setOver({ k, after })
    },
    onDrop: e => { e.preventDefault(); dropOn(k, over && over.k === k ? over.after : false) },
    onDragEnd: () => { dragK.current = null; setOver(null) },
  })
  const row = (g, chk) => (
    <div key={g.key} className={'qs-sm-g' + (chk ? ' chk' : '') + (chk && over && over.k === String(g.key) ? (over.after ? ' drop-after' : ' drop-before') : '')}
      title={(g.name || g.key) + ': ' + money(g.value) + ' đ (' + pct(g.value / sum) + ')'}
      onClick={chk ? () => togglePick(String(g.key)) : undefined} {...(chk ? dragProps(String(g.key)) : {})}>
      <div className="t">
        {chk && <span className="grip" title="Kéo để đổi vị trí" aria-hidden="true">⋮⋮</span>}
        {chk && <input type="checkbox" checked={shownKeys.indexOf(String(g.key)) >= 0} readOnly tabIndex={-1}
          disabled={shownKeys.indexOf(String(g.key)) < 0 && shownKeys.length >= GRP_MAX} />}
        <span className="nm">{g.name || g.key}</span><b>{money(g.value)}</b>
      </div>
      <div className="tr">
        <span className="track"><i className={g.value === max ? 'top' : ''} style={{ width: Math.max(1.5, g.value / max * 100) + '%' }} /></span>
        <span className="pc">{pct(g.value / sum)}</span>
      </div>
    </div>
  )
  const scope = <span className="qs-sm-sub scope" title="Số liệu cộng theo bộ lọc của Danh sách dự án; mỗi dự án tính bản đang mở hoặc bản nháp mới nhất"><Icon name="filter" size={11} />{nDa} dự án · {label || 'Tất cả'}</span>

  return (
    <>
      <section className="qs-card qs-sm" aria-label="Biên lợi nhuận theo bộ lọc">
        <div className="qs-sm-h"><h3>Biên lợi nhuận</h3>{scope}</div>
        {!ok && <div className="qs-sum-load"><i style={{ width: (nDa ? (A.done + A.fail) / nDa * 100 : 100) + '%' }} />Đang tính {A.done + A.fail}/{nDa} dự án…</div>}
        {ok && A.fail > 0 && <div className="qs-sum-warn"><Icon name="alert" size={13} />{A.fail} dự án chưa tải được, chưa cộng vào tổng</div>}

        <div className="qs-sm-hero">
          {ok ? <b className={'qs-sm-big' + (neg ? ' neg' : '')}>{f1(A.bien)}</b> : <span className="qs-sum-sk qs-sm-bigsk" />}
          {ok && (
            <div className="qs-sm-chiprow">
              <span className={'qs-sm-chip' + (neg ? ' neg' : '')}><i aria-hidden="true">{neg ? '▼' : '▲'}</i>{money(A.ln)} đ</span>
            </div>
          )}
          {/* 1 module có viền mờ: câu giải thích + thanh Giá vốn | Lợi nhuận + chú thích */}
          <div className="qs-sm-split">
            <span className="qs-sm-cap">{neg ? 'Lỗ' : 'Lợi nhuận'} trên giá bán chưa VAT</span>
            <div className={'qs-sm-bar' + (neg ? ' neg' : '')} aria-hidden="true">
              <i className="von" style={{ width: vonPct + '%' }} />
              {!neg && <i className="ln" style={{ width: (100 - vonPct) + '%' }} />}
            </div>
            <div className="qs-sm-barl"><span>Giá vốn {ok ? f1(vonPct) : ''}</span><span className={neg ? 'neg' : 'pos'}>Lợi nhuận {ok ? f1(A.bien) : ''}</span></div>
          </div>
        </div>

        <dl className="qs-sm-rows">
          <div><dt>Tổng thanh toán <em>{vat}</em></dt><dd>{num(A.total)}</dd></div>
          <div><dt>Giá bán <em>chưa VAT</em></dt><dd>{num(A.ban)}</dd></div>
          <div><dt>Giá vốn</dt><dd>{num(A.von)}</dd></div>
          <div><dt>Dòng sản phẩm</dt><dd>{ok ? <b>{A.n.toLocaleString('vi-VN')}</b> : <span className="qs-sum-sk" />}</dd></div>
        </dl>
      </section>

      <section className="qs-card qs-sm qs-sm-grpc" aria-label="Giá trị theo nhóm">
        <div className="qs-sm-h"><h3>Giá trị theo nhóm</h3>{ok && A.groups.length > 0 && <span className="qs-sm-sub">{A.groups.length} nhóm</span>}
          {ok && A.groups.length > 0 && (
            <button type="button" className={'qs-sm-more' + (open ? ' on' : '') + (hidden > 0 && !open ? ' warn' : '')}
              title={open ? 'Đóng danh sách ngành hàng' : hidden > 0 ? 'Còn ' + hidden + ' ngành hàng chưa hiện - bấm để xem toàn bộ' : 'Xem tất cả ngành hàng / chọn ngành hàng hiện ở đây'}
              aria-label="Xem tất cả ngành hàng" aria-expanded={open} onClick={() => setOpen(o => !o)}>
              <Icon name="chevronRight" size={14} />
              {hidden > 0 && !open && <em>+{hidden}</em>}
            </button>
          )}
        </div>
        <div className={'qs-sm-grp' + (more ? ' cut' : '')} ref={grpRef}>
          {!ok && [0, 1, 2].map(i => <div key={i} className="qs-sm-g"><span className="qs-sum-sk w" /></div>)}
          {ok && !A.groups.length && <div className="qs-sum-empty">Chưa có hạng mục nào trong các dự án đang lọc.</div>}
          {ok && shown.map(g => row(g))}
        </div>
      </section>
      {open && (
        <aside className="qs-card qs-sm qs-sm-panel" ref={panelRef} aria-label="Giá trị theo nhóm - đầy đủ">
          <div className="qs-sm-h"><h3>{editing ? 'Chọn ngành hàng hiện' : 'Giá trị theo nhóm'}</h3><span className="qs-sm-sub">{editing ? shownKeys.length + '/' + GRP_MAX : A.groups.length + ' nhóm'}</span>
            <button type="button" className={'qsc-x qs-sm-edit' + (editing ? ' on' : '')} title={editing ? 'Xong' : 'Chọn ngành hàng hiện ở thẻ bên trái (tối đa ' + GRP_MAX + ')'}
              onClick={() => setEditing(e => !e)}><Icon name={editing ? 'check' : 'edit'} size={13} /></button>
            <button type="button" className="qsc-x" title="Đóng (Esc)" onClick={() => setOpen(false)}>✕</button>
          </div>
          {editing && (
            <div className="qs-sm-pickbar">
              <span>Tích tối đa {GRP_MAX} ngành hàng để hiện ở thẻ bên trái · kéo ⋮⋮ để đổi vị trí</span>
              <button type="button" disabled={!pick} onClick={() => setPick(null)} title={'Về mặc định: ' + GRP_MAX + ' ngành hàng lớn nhất'}>Mặc định</button>
            </div>
          )}
          <div className="qs-sm-grp">{(editing ? shown.concat(byVal.filter(g => shownKeys.indexOf(String(g.key)) < 0)) : byVal).map(g => row(g, editing))}</div>
        </aside>
      )}
    </>
  )
}
