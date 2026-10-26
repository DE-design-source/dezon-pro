import { useRef } from 'react'
import Icon from '../../../../components/ui/Icon'
import { useFitLevel } from '../common/useFitLevel'

const ZOOMS = [50, 75, 90, 100, 110, 125, 150]
const Sep = () => <span className="qs-bd-tb-sep" />
const Btn = ({ icon, title, active, disabled, onClick, children, className = '' }) => (
  <button
    className={`qs-bd-tb-btn${active ? ' on' : ''} ${className}`}
    title={title}
    disabled={disabled}
    onMouseDown={e => e.preventDefault() /* giữ tiêu điểm ở bảng để phím tắt vẫn chạy */}
    onClick={onClick}
  >
    <Icon name={icon} size={18} />{children}
  </button>
)
const num = n => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

/* Thanh công cụ của bảng tính + thanh công thức.
   Luôn 1 hàng (định dạng + thao tác bảng + cột/xem), phần thừa cuộn ngang.
   s: trạng thái hiện tại để tô nút; a: các thao tác (xem SheetBody) */
export default function SheetToolbar({ s, a, formula }) {
  /* s.hide: tên nút bảng này không dùng (vd. 'import') · s.extraTools: nút riêng của bảng, cuối thanh (Bóc tách: Vừa thêm...)
     · s.leadTools: nút riêng đặt đầu thanh (Bóc tách: cập nhật giá) */
  const on = name => !(s.hide && s.hide.has(name))
  const wrapOn = s.wrapOn !== undefined ? s.wrapOn : !s.fmt.nowrap
  const colorRef = useRef(null)
  const bgRef = useRef(null)
  /* Thiếu chỗ: 1 = nút Tầng / phòng + Hạng mục chỉ còn biểu tượng, 2 = xuống hàng (QS.css, chỉ áp trong khung .qs-bd-toolmod) */
  const barRef = useRef(null)
  useFitLevel(barRef, s.addTools ? 2 : 0, '.qs-tk-addgrp', [!!s.addTools])
  /* Mở bảng màu của trình duyệt, neo ngay dưới nút */
  const pickColor = ref => { const el = ref.current; if (!el) return; if (el.showPicker) el.showPicker(); else el.click() }

  /* Vị trí số 2 (ngay sau leadTools): nút bộ cột nhanh nếu bảng truyền s.quick, không thì nút ẩn/hiện cột giá */
  const q = s.quick
  const priceBtn = q
    ? <Btn icon="sliders" title={q.title} className="badged" active={q.on} onClick={q.onClick}>{q.count != null && <span className="qs-bd-tb-badge">{q.count}</span>}</Btn>
    : <Btn icon="coin" title="Hiện / ẩn các cột giá" className="badged" active={s.priceShown > 0} onClick={a.togglePrice}><span className="qs-bd-tb-badge">{s.priceShown}</span></Btn>
  /* Vị trí số 3: nút chế độ gọn (chiều cao dòng gọn), chỉ biểu tượng nét xanh; đang bật thì nền xanh nhạt */
  /* Chế độ xem tối ưu (bật = !compact): hiện đủ chữ / nội dung / hình, hàng + cột cân theo dữ liệu; tắt = thu gọn chiều cao hàng (thấy giá) */
  const gonBtn = <Btn icon="wrap" title={!s.compact ? 'Đang xem tối ưu (hiện đủ nội dung) — bấm để thu gọn hàng' : 'Xem tối ưu: hiện đủ chữ, nội dung, hình ảnh'} active={!s.compact} onClick={a.toggleCompact} className="qs-bd-tb-gon" />
  /* Vị trí số 4: đóng băng cột STT / Phòng / Tên (Bảng thường có nút tương ứng ở khối công cụ, BreakdownTab) */
  const frozenBtn = <Btn icon="table" title="Đóng băng cột STT / Phòng / Tên" active={s.frozen} onClick={a.toggleFrozen} />
  /* Vị trí số 3: lọc nhanh theo giá trị ô đang chọn — nét xanh như nút chế độ gọn */
  const quickFltBtn = <Btn icon="target" title="Lọc nhanh: chỉ hiện các dòng có cùng giá trị với ô đang chọn" active={s.colFilterOn} onClick={a.toggleColFilter} className="qs-bd-tb-gon" />
  /* Vị trí số 4, cùng cặp với lọc nhanh: chỉ hiện sản phẩm yêu thích */
  const favBtn = <Btn icon="star" title="Lọc nhanh: chỉ hiện sản phẩm yêu thích" active={s.favOnly} onClick={a.toggleFav} className="qs-bd-tb-gon" />
  const formatTools = (
    <>
      <Btn icon="undo" title="Hoàn tác (Ctrl+Z)" disabled={!s.canUndo} onClick={a.undo} />
      <Btn icon="redo" title="Làm lại (Ctrl+Y)" disabled={!s.canRedo} onClick={a.redo} />
      <Sep />
      <Btn icon="scissors" title="Cắt (Ctrl+X)" onClick={a.cut} /><Btn icon="copy" title="Sao chép (Ctrl+C)" onClick={a.copy} /><Btn icon="clipboard" title="Dán (Ctrl+V)" onClick={a.paste} />
      <Sep />
      <Btn icon="minus" title="Giảm cỡ chữ" onClick={a.fontDown} />
      <span className="qs-bd-tb-size">{s.fontSize}</span>
      <Btn icon="plus" title="Tăng cỡ chữ" onClick={a.fontUp} />
      <Sep />
      <Btn icon="bold" title="In đậm (Ctrl+B)" active={s.fmt.b} onClick={() => a.toggleFmt('b')} />
      <Btn icon="italic" title="In nghiêng (Ctrl+I)" active={s.fmt.i} onClick={() => a.toggleFmt('i')} />
      <Btn icon="underline" title="Gạch chân (Ctrl+U)" active={s.fmt.u} onClick={() => a.toggleFmt('u')} />
      <span className="qs-bd-tb-color" style={{ '--sw': s.lastColor.color }}>
        <Btn icon="textColor" title="Màu chữ" className="swatch" onClick={() => pickColor(colorRef)} />
        <input ref={colorRef} type="color" tabIndex={-1} value={s.lastColor.color} onChange={e => a.setColor('color', e.target.value)} />
      </span>
      <span className="qs-bd-tb-color" style={{ '--sw': s.lastColor.bg }}>
        <Btn icon="droplet" title="Màu nền" className="swatch" onClick={() => pickColor(bgRef)} />
        <input ref={bgRef} type="color" tabIndex={-1} value={s.lastColor.bg} onChange={e => a.setColor('bg', e.target.value)} />
      </span>
      <Sep />
      <Btn icon="alignLeft" title="Căn trái" active={s.fmt.align === 'left'} onClick={() => a.align('left')} />
      <Btn icon="alignCenter" title="Căn giữa" active={s.fmt.align === 'center'} onClick={() => a.align('center')} />
      <Btn icon="alignRight" title="Căn phải" active={s.fmt.align === 'right'} onClick={() => a.align('right')} />
      <Btn icon="wrap" title={s.wrapTitle || 'Xuống dòng tự động'} active={wrapOn} onClick={a.toggleWrap} />
      <Btn icon="eraser" title="Xoá định dạng" onClick={a.clearFmt} />
      <Sep />
      <Btn icon="sigma" title="Thống kê vùng đang chọn" active={s.showStats} onClick={a.toggleStats} />
      {s.showStats && s.stats && (
        <span className="qs-bd-tb-stats">
          <span>Tổng: <b>{num(s.stats.sum)}</b></span><span>TB: <b>{num(s.stats.avg)}</b></span>
          <span>Min: <b>{num(s.stats.min)}</b></span><span>Max: <b>{num(s.stats.max)}</b></span><span>Đếm: <b>{s.stats.count}</b></span>
        </span>
      )}
    </>
  )
  const sheetTools = (
    <>
      <Btn icon="search" title="Tìm trong bảng (Ctrl+F)" active={s.panel === 'find'} onClick={() => a.togglePanel('find')} />
      <Sep />
      <Btn icon="rowInsert" title="Chèn dòng bên dưới" onClick={a.insertRow} />
      <Btn icon="rowGroup" title="Nhân bản dòng đang chọn" onClick={a.duplicate} />
      <Btn icon="trash" title="Xoá dòng đang chọn" onClick={a.deleteRows} />
      <Sep />
      <Btn icon="sortAsc" title="Sắp xếp tăng dần theo cột đang chọn" onClick={() => a.sort(1)} />
      <Btn icon="sortDesc" title="Sắp xếp giảm dần theo cột đang chọn" onClick={() => a.sort(-1)} />
      {on('import') && <Btn icon="importDown" title="Nhập dòng từ file CSV" onClick={a.importFile} />}
      <Sep />
      <Btn icon="filter" title="Lọc dòng theo từ khoá (gõ chữ cần tìm)" active={s.panel === 'filter' || s.filterOn} onClick={() => a.togglePanel('filter')} />
      <label className="qs-bd-tb-zoom" title="Thu phóng bảng">
        <select value={ZOOMS.includes(s.zoom) ? s.zoom : ''} onChange={e => a.setZoom(Number(e.target.value))}>
          {!ZOOMS.includes(s.zoom) && <option value="">{s.zoom}%</option>}
          {ZOOMS.map(z => <option key={z} value={z}>{z}%</option>)}
        </select>
        <Icon name="chevronDown" size={15} />
      </label>
      <Sep />
      <Btn icon="printer" title="In bảng" onClick={a.print} /><Btn icon="download" title={on('csv') ? 'Tải xuống file CSV (mở bằng Excel)' : 'Xuất Excel'} onClick={a.download} />
    </>
  )
  /* 2 nút lịch sử (Vừa thêm của bảng + Lịch sử thao tác): nhóm riêng bên trái, ngay sau đóng băng cột */
  const historyTools = (
    <>
      {s.extraTools}
      {on('history') && <Btn icon="history" title="Lịch sử thao tác" active={s.panel === 'history'} onClick={() => a.togglePanel('history')} />}
    </>
  )
  const viewTools = (
    <>
      {/* 'cols' ẩn được khi bảng đã có nút cột riêng ở đầu bảng (Bóc tách: Cột hiển thị + bộ cột trong SheetHeader) */}
      {on('cols') && <Btn icon="sliders" title="Chọn cột hiển thị" className="text" active={s.panel === 'cols'} onClick={() => a.togglePanel('cols')}>Cột {s.cols.shown}/{s.cols.total}</Btn>}
      <Sep />
      <Btn icon="zoomOut" title="Thu nhỏ bảng" onClick={a.zoomOut} />
      <Sep />
      <Btn icon="fitWidth" title={s.fitOn ? 'Đang vừa chiều rộng — bấm để trả về 100%' : 'Thu phóng cho vừa chiều rộng (bấm lần nữa: về 100%)'} active={s.fitOn} onClick={a.fitWidth} />
      <Btn icon="maximize" title={s.full ? 'Thoát toàn màn hình' : 'Toàn màn hình'} active={s.full} onClick={a.toggleFull} />
    </>
  )
  return (
    <>
      {/* 1 hàng: định dạng | thao tác bảng ... (dồn phải) cột / lọc / xem; không đủ chỗ thì cuộn ngang */}
      <div className="qs-bd-tb qs-bd-tb-one" ref={barRef}>{s.leadTools && <>{s.leadTools}<Sep /></>}{on('quick') && <>{priceBtn}<Sep /></>}{gonBtn}<Sep />{frozenBtn}<Sep />{quickFltBtn}{on('fav') && favBtn}<Sep />{(s.extraTools || on('history')) && <>{historyTools}<Sep /></>}{formatTools}<Sep />{sheetTools}<span style={{ flex: 1 }} />{viewTools}{s.addTools && <><Sep /><span className="qs-tk-addgrp">{s.addTools}</span></>}</div>
      {/* formula = null (Bảng thường dùng chung thanh này): không có ô công thức */}
      {formula && <div className="qs-bd-formula">
        <span className="qs-bd-formula-ref">{formula.ref}</span>
        <span className="qs-bd-formula-fx">fx</span>
        <input
          className="qs-bd-formula-value"
          placeholder="Chọn 1 ô để xem / sửa nội dung"
          value={formula.value}
          readOnly={!formula.editable}
          onFocus={formula.onFocus}
          onChange={e => formula.onChange(e.target.value)}
          onKeyDown={formula.onKeyDown}
          onBlur={formula.onBlur}
        />
      </div>}
    </>
  )
}
