import { useEffect } from 'react'
import BulkBar from '../breakdown/sheet/BulkBar'
import * as bocAct from '../breakdown/sheet/bocActions'
import { getState } from '../../state/store'
import { deleteLines } from '../../state/qsGuard'
import { floorsList, CHUA_PHAN_TANG } from '../../lib/sheetModel.js'
import { cpLabel_, cellSortVal_ } from '../../lib/columns.js'
import { tkFieldsFor_ } from '../../lib/calc.js'
import { applyEditsRec } from './costActions'
import { tickClear_, tickSet_ } from '../../state/tickSel'
import { qsToast as toast } from '../common/dialogs'

function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return } } catch (e) { /* dự phòng bên dưới */ }
  const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'
  document.body.appendChild(a); a.select(); try { document.execCommand('copy') } catch (x) { /* bỏ qua */ } a.remove()
}

/* Thanh "dòng đã chọn" của Chi phí / Dự án (tkSelBar_ PUB/boc.js:999-1017: Bóc tách · Chi phí · Dự án dùng chung 1 thanh và 1 bộ tick).
   Dùng lại BulkBar của Bóc tách; ghi qua applyEditsRec (1 bước hoàn tác). Esc = bỏ chọn như boc.js:1340.
   Props: maDA, lines (dòng đã tick), keys (cột đang hiện, cho "Sao chép"), shownIds (dòng đang hiện, cho "Chọn tất cả") */
export default function TickBar({ maDA, lines, keys, shownIds }) {
  const on = lines.length > 0
  useEffect(() => {
    if (!on) return undefined
    const onKey = ev => { if (ev.key === 'Escape') tickClear_() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [on])
  if (!on) return null
  const S = getState()
  const floors = floorsList(S.cur, S.lines).filter(f => f !== CHUA_PHAN_TANG)
  const act = {
    applyFields: (edits, nhan) => applyEditsRec(edits, nhan),
    bulkEdit: (ls, k, val, nhan) => applyEditsRec(ls.map(l => {
      if (k === 'tang') return { id: l.lineId, fields: { tang: String(val) } }
      const f = tkFieldsFor_(l, k, val); return f ? { id: l.lineId, fields: f } : null
    }).filter(Boolean), 'Đã đặt “' + nhan + '”'),
    bulkSheet: (ids, v) => bocAct.bulkSheet(ids, v),
    bulkCopy: ls => {
      const ks = keys.filter(k => k !== 'hinhAnh' && k !== 'taiLieu')
      const rows = ls.map(l => ks.map(k => { const v = cellSortVal_(l, k); return v == null ? '' : String(v) }).join('\t'))
      copyText([ks.map(cpLabel_).join('\t')].concat(rows).join('\n'))
      toast('Đã sao chép ' + rows.length + ' dòng')
    },
    dupRows: ids => bocAct.dupRows(ids),
    selectAll: () => tickSet_(maDA, shownIds),
    delRows: async ids => { const n = await deleteLines(ids, { confirm: true }); if (n) tickClear_() },
  }
  return <BulkBar lines={lines} floors={floors} sheetCo={false} act={act} onClear={tickClear_} />
}
