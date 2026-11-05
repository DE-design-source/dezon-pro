import { useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import { TREE, nodeName, customGroups } from '../../lib/tree.js'
import { pad2 } from '../../lib/format.js'
import { bgNodeCnt_, bgSelCodes_, bgLines_, bgPTRows_ } from '../../lib/quote.js'
import { bgSelToggle_, bgSelAll_, useQuoteUi } from './quoteState'

/* Nút chọn hạng mục đã bóc in từ trang 2 (bgNodeBtn_ PUB/baogia.js:951-956) + bảng chọn (bgTreePop_ / bgTreeRender_ 957-1010).
   ctx = ngữ cảnh lib/quote.js của tab (cur, lines, phanTho, bgNodes ...); small = nút gọn ở thẻ "Bảng báo giá chi tiết". */
function bgTreeNodes_(cur) {
  const out = TREE.filter(t => t[0] !== 'X').map(t => ({ code: t[0], name: t[1], lvl: t[2] }))
  customGroups(cur).forEach(nm => { out.push({ code: nm, name: nm, lvl: 1 }) })
  return out
}

export default function NodePicker({ ctx, small }) {
  const [anchor, setAnchor] = useState(null)
  const q = useQuoteUi()
  const c = { ...ctx, bgNodes: q.bgNodes }
  const sel = bgSelCodes_(c)
  const n = bgLines_(c).length + bgPTRows_(c)        // kèm số dòng phần thô sẽ xuất
  const lbl = sel.length ? (sel.length === 1 ? (sel[0] + '.' + (nodeName(sel[0]) || '')) : (sel.length + ' hạng mục')) : 'Tất cả hạng mục đã bóc'
  const list = bgTreeNodes_(c.cur).filter(t => bgNodeCnt_(t.code, c) > 0)   // chỉ hạng mục đã bóc
  const close = () => setAnchor(null)
  return (
    <>
      <button type="button" className={`qsq-nodebtn${sel.length ? ' on' : ''}${small ? ' sm' : ''}`}
        title="Chọn hạng mục đã bóc sẽ in từ trang 2 (tờ bìa trang 1 luôn có)"
        onClick={e => setAnchor(anchor ? null : e.currentTarget)}>
        <Icon name="layers" size={14} /><span>{lbl}</span><b>[{pad2(n)}]</b> ▾
      </button>
      {anchor && (
        <Pop anchor={anchor} width={360} onClose={close}>
          <PopHead title="Trang 2 trở đi: hạng mục đã bóc" sub={sel.length ? sel.length + ' mục đã tích' : 'chưa tích = in tất cả'} onClose={close} />
          <div className="qsq-pop-tools">
            <span>Trang 1 luôn là tờ bìa</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="qs-qt-btn" onClick={() => bgSelAll_(bgTreeNodes_(c.cur).filter(t => bgNodeCnt_(t.code, c)).map(t => t.code))}>Chọn tất cả</button>
            <button type="button" className="qs-qt-btn" onClick={() => bgSelAll_([])}>Bỏ chọn</button>
          </div>
          <div className="qs-tk-bgtb qsq-pop-b">
            {list.length ? list.map(t => {
              const on = !!q.bgNodes[t.code]
              return (
                <div key={t.code} className={`qs-tk-bgti${on ? ' on' : ''}`} style={{ paddingLeft: 9 + (Math.max(1, t.lvl) - 1) * 14 }} onClick={() => bgSelToggle_(t.code)}>
                  <span className="nm">{t.code + '.' + t.name}</span>
                  <span className="cn">[{pad2(bgNodeCnt_(t.code, c))}]</span>
                  <span className={`rd${on ? ' on' : ''}`} />
                </div>
              )
            }) : <div className="qsq-pop-empty">Chưa bóc hạng mục nào — báo giá chỉ có tờ bìa.</div>}
          </div>
          <div className="qsq-pop-f">
            <span>{pad2(bgLines_(c).length)} dòng sẽ lên báo giá</span>
            <button type="button" className="qsc-btn blue" onClick={close}>Xong</button>
          </div>
        </Pop>
      )}
    </>
  )
}
