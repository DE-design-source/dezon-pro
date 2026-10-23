import Pop from './Pop'
import Icon from '../../../../../components/ui/Icon'
import { tkSheetSua_ } from './tkModel'

const NUMK = ['soLuong', 'giaNCC', 'giaDaiLy', 'donGia', 'donGiaCK', 'thanhTien', 'lnVnd', 'chietKhau', 'lnPct', 'ckKhach', 'donGiaBan', 'thanhTienBan', 'thanhTienVon']

/* Menu chuột phải của bảng Bóc tách — MỘT menu chung cho Bảng thường và Bảng tính (2 bảng cùng tính năng, chỉ khác giao diện):
   gộp tkCtx PUB/app.js:210-269 (Bảng thường) + tkSheetMenu_ bangtinh.js:576-606 (Bảng tính).
   Đầu mục (Ô · Dòng · Tầng · Cột · Cố định · Hiển thị cột · Tô màu · Bảng) và tính năng con hiện cùng lúc, chia 3 cột. mode chỉ đổi vài chỗ nhỏ: xoá dòng (Bảng tính xoá các dòng đang chọn), điền xuống cột
   (Bảng tính chỉ cột sửa được). Mọi việc làm qua `act` do BreakdownTab truyền vào.
   Props: mode, at {x, y} (toạ độ chuột), entry (dòng của lưới), col ({key, label}), text (chữ của ô), ids (dòng đang chọn),
          cf (luật tô màu), sortKey, freezeN, frzRows, act {...}, onClose() */
export default function ContextMenu({ mode = 'plain', at, entry, col, text, ids, cf, sortKey, freezeN, frzRows, act, onClose }) {
  const sheet = mode === 'sheet'
  const item = entry && entry.type === 'item' ? entry.r : null
  const group = entry && entry.type === 'group' ? entry.g : null
  const key = col ? col.key : ''
  const cell = item && key
  const nSel = (ids || []).length
  const r = cf || {}
  const it = (ic, label, fn, o = {}) => ({ ic, label, fn, ...o })

  /* Đầu mục -> tính năng con (đầu mục không có tính năng nào thì không hiện) */
  const secs = [
    cell && { id: 'cell', ic: 'copy', t: 'Ô đang chọn', items: [
      it('copy', 'Sao chép ô', () => act.copyCell(text), { hint: 'Ctrl+C' }),
      it('edit', 'Dán vào ô', () => act.pasteCell(item, key), { hint: 'Ctrl+V' }),
      it('trash', 'Xoá nội dung ô', () => act.clearCell(item, key), { hint: 'Del' }),
      act.clearFmt && it('eraser', 'Xoá định dạng ô đang chọn', act.clearFmt),
      (!sheet || tkSheetSua_(key)) && it('importDown', 'Điền giá trị ô này xuống cả cột',
        () => (sheet ? act.fillDownSheet(item, key, text, col.label) : act.fillDown(item, key, text))),
    ] },
    item && { id: 'row', ic: 'list', t: 'Dòng', items: [
      it('search', 'Đổi sản phẩm từ danh mục…', () => act.pick(item, at)),
      it('copy', 'Sao chép cả dòng', () => act.copyRow(item)),
      it('copy', 'Nhân bản dòng', () => act.dupRow(item)),
      it('plus', 'Chèn dòng trống bên dưới', () => act.insertRow(item)),
      it('check', 'Chọn dòng này', () => act.selectRow(item)),
      it('list', 'Chọn tất cả dòng đang hiện', act.selectAll),
      sheet && nSel > 1
        ? it('trash', 'Xoá ' + nSel + ' dòng đang chọn', () => act.delSel(ids), { danger: true })
        : it('trash', 'Xoá dòng này', () => act.delRow(item), { danger: true }),
    ] },
    { id: 'floor', ic: 'layers', t: group ? 'Tầng: ' + group.name : 'Tầng / phòng', items: [
      group && it('plus', 'Thêm hạng mục trống vào tầng này', () => act.addToFloor(group)),
      group && group.id !== 'CHƯA PHÂN TẦNG' && it('edit', 'Đổi tên tầng', () => act.renameFloor(group)),
      it('plus', 'Thêm tầng / phòng mới', act.addFloor),
    ] },
    key && { id: 'col', ic: 'sortAsc', t: 'Cột: ' + col.label, items: [
      it('sortAsc', 'Sắp xếp tăng dần', () => act.sort(key, 'asc')),
      it('sortDesc', 'Sắp xếp giảm dần', () => act.sort(key, 'desc')),
      sortKey && it('x', 'Bỏ sắp xếp', act.resetSort),
      NUMK.indexOf(key) >= 0 && it('gauge', 'Tính tổng cột', () => act.sumCol(key, col.label)),
      key !== 'ten' && it('eye', 'Ẩn cột này', () => act.hideCol(key)),
    ] },
    /* Kích thước: 1 lệnh mở 1 hộp chỉnh cả hàng lẫn cột (mỗi phần có phạm vi: 1 hàng / cột, tất cả…) */
    { id: 'size', ic: 'fitWidth', t: 'Kích thước', items: [
      (item || key) && act.resizeSize && it('fitWidth', 'Thay đổi kích thước hàng & cột…', () => act.resizeSize(item, key, key ? col.label : '', 'both')),
    ] },
    { id: 'freeze', ic: 'lock', t: 'Cố định', items: [
      key && it('lock', 'Cố định đến cột này', () => act.freezeTo(key)),
      freezeN > 0 && it('x', 'Bỏ cố định cột', act.unfreeze),
      item && it('lock', 'Cố định đến hàng này', () => act.freezeRowTo(item)),
      frzRows > 0 && it('x', 'Bỏ cố định hàng', act.unfreezeRows),
    ] },
    { id: 'cols', ic: 'sliders', t: 'Hiển thị cột', items: [
      it('sliders', 'Chọn cột hiển thị…', act.openCols),
      it('list', 'Hiện lại tất cả cột', act.showAllCols),
    ] },
    { id: 'cf', ic: 'droplet', t: 'Tô màu điều kiện', items: [
      it(null, 'Lợi nhuận < 0', () => act.cfToggle('ln0'), { ck: !!r.ln0, dot: 'cf-red' }),
      it(null, 'Chưa có giá bán', () => act.cfToggle('noPrice'), { ck: !!r.noPrice, dot: 'cf-yellow' }),
      it(null, 'Số lượng = 0', () => act.cfToggle('sl0'), { ck: !!r.sl0, dot: 'cf-grey' }),
    ] },
    { id: 'table', ic: 'table', t: 'Bảng', items: [
      act.clearAllFmt && it('eraser', 'Xoá định dạng cả bảng (về chữ mặc định)', act.clearAllFmt),
      it('search', 'Tìm & thay thế', act.findReplace, { hint: 'Ctrl+F' }),
      it('download', 'Xuất bảng ra Excel', act.gotoExport),
    ] },
  ].filter(Boolean).map(s => ({ ...s, items: s.items.filter(Boolean) })).filter(s => s.items.length)

  const run = fn => () => { onClose(); fn() }
  const Row = ({ x }) => (x.dot ? (
    <div className={`qs-tk-cmi qs-tk-cmck${x.ck ? ' on' : ''}`} onClick={run(x.fn)}>
      <span className="bx">{x.ck ? '✓' : ''}</span><span className={`qs-tk-cfdot ${x.dot}`} /><span>{x.label}</span>
    </div>
  ) : (
    <div className={`qs-tk-cmi${x.danger ? ' danger' : ''}`} onClick={run(x.fn)}>
      <Icon name={x.ic} size={14} /><span>{x.label}</span>{x.hint && <i className="qs-tk-cmik">{x.hint}</i>}
    </div>
  ))

  /* Mọi đầu mục + tính năng con hiện cùng lúc (1 lần bấm là tới chức năng): các khối đầu mục xếp thành 3 cột */
  return (
    <Pop anchor={at} width={760} className="qs-tk-ctx qs-tk-ctx3" onClose={onClose}>
      <div className="qs-tk-ctxgrid">
        {secs.map(sec => (
          <div key={sec.id} className="qs-tk-ctxblk">
            <div className="qs-tk-ctxblkh"><Icon name={sec.ic} size={13} /><span>{sec.t}</span></div>
            {sec.items.map((x, i) => <Row key={i} x={x} />)}
          </div>
        ))}
      </div>
    </Pop>
  )
}
