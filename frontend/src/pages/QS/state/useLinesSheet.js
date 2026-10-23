/* Mặt tiền "sheet" cho SheetBody / SheetGrid: giữ đúng giao diện của useSheetHistory cũ
   {groups, commit, patch, undo, redo, jumpTo, canUndo, canRedo, labels} nhưng dữ liệu thật là store.lines (Line của server).
   scope: {node: '3.2.6.1'} cho Bóc tách (dòng có nhom = node hoặc bắt đầu bằng node + '.', PUB/boc.js:680)
          {hm: hmNode}      cho Chi phí / Dự án / Mua hàng ('' = mọi dòng).
   groups = các tầng theo floorsList (cur.tangTuTao rồi tầng có trong dòng, "CHƯA PHÂN TẦNG" khi có dòng chưa gán tầng,
   PUB/boc.js:141-148), mỗi nhóm {id, name, collapsed, rows}. rows LÀ Line của server (giữ nguyên khoá), có thêm `fmt`
   (định dạng ô từ projData.btFmt, đổi sang dạng {b,i,u,wrap,color,bg,align} bằng lib btToFmt_).
   wrap = 'Xuống dòng trong ô' của bản gốc (mặc định TẮT); 'nowrap' của clone không bao giờ được lưu (0-F-B R2).
   commit(label, fn): fn nhận groups trả groups mới; mặt tiền so trước/sau rồi ghi:
     ô đổi -> updateLine qua tkFieldsFor_ / editProfit_ (khoá cột COLS: giaNCC -> donGiaVon, donGia -> donGiaBan, ...)
     đổi chỗ / đổi tầng -> moveLine (1 dòng, port tkMoveLine_) hoặc reorderLines (nhiều dòng)
     dòng mới (không có lineId) -> addLine; dòng mất -> deleteLines (nhiều dòng thì hỏi "Không hoàn tác được")
     fmt -> projData.btFmt.
   Hoàn tác (D12): chỉ vá trường + đổi chỗ, theo dự án, tối đa 100 bước; thêm / xoá dòng không hoàn tác được. */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useQsStore, getState, updateLine, addLine, deleteLines, moveLine, reorderLines, histOf, setHist, lineOf_, toast, DEFAULT_NODE, histRunAddDel } from './store'
import { projDataSet_ } from './projData'
import { tkFieldsFor_, editProfit_ } from '../lib/calc.js'
import { nodeName } from '../lib/tree.js'
import { floorsList, CHUA_PHAN_TANG as NO_TANG, btToFmt_, fmtToBt_ } from '../lib/sheetModel.js'

/* Khoá Line ghi thẳng được (không qua bảng cột). Cột dẫn xuất / id / stt / tang không nằm đây. */
const NUM_FIELDS = { soLuong: 1, donGiaVon: 1, chietKhau: 1, lnPct: 1, donGiaBan: 1, ckKhach: 1, giamGiaNcc: 1 }
const TXT_FIELDS = { ten: 1, maSP: 1, thuongHieu: 1, ncc: 1, moTa: 1, kichThuoc: 1, hinhAnh: 1, dvt: 1, khuVuc: 1, maBanVe: 1,
  trangThai: 1, ghiChu: 1, nhom: 1, loai: 1, hangMuc: 1 }
const PROFIT = { markup: 1, margin: 1, lnVnd: 1 }

/* floorsList + ánh xạ btFmt dùng bản port đã kiểm golden ở lib (requests/0-F-B.txt R1) */
export { floorsList }
export const inScope = (l, mode, code) => {
  if (!code) return true
  const c = String(l.nhom || '')
  return c === code || c.indexOf(code + '.') === 0
}
const tangOfGroup = g => (g.id === NO_TANG || g.name === NO_TANG ? '' : String(g.name || g.id || ''))

const rowCache = new WeakMap()   // Line -> {src, row} (giữ tham chiếu ổn định khi btFmt không đổi)
function rowOf(l, fmtSrc) {
  const c = rowCache.get(l)
  if (c && c.src === fmtSrc) return c.row
  let row = l
  if (fmtSrc) {
    const fmt = {}
    Object.keys(fmtSrc).forEach(k => { const v = btToFmt_(fmtSrc[k]); if (v && Object.keys(v).length) fmt[k] = v })
    if (Object.keys(fmt).length) row = { ...l, fmt }
  }
  rowCache.set(l, { src: fmtSrc, row })
  return row
}

const collapsedStore = {}   // trạng thái gập nhóm theo dự án + phạm vi (giữ qua lần mount)
const NONE = {}             // hằng rỗng: groups giữ nguyên tham chiếu giữa các lần render

/* Biến 1 ô đổi thành trường Line; trả {fields} | {msg} | null */
function fieldsFor(line, key, val) {
  if (PROFIT[key]) {
    const r = editProfit_(line, key, val)
    return r && r.fields ? { fields: r.fields } : (r && r.msg ? { msg: r.msg } : null)
  }
  const f = tkFieldsFor_(line, key, val)
  if (f) return { fields: f }
  if (NUM_FIELDS[key]) return { fields: { [key]: Number(val) || 0 } }
  if (TXT_FIELDS[key]) return { fields: { [key]: val == null ? '' : String(val) } }
  if (key === 'extra' && val && typeof val === 'object') return { fields: { extra: val } }
  return null
}

function flatScope(groups) {
  const seq = []
  ;(groups || []).forEach(g => (g.rows || []).forEach(r => { if (r && r.lineId) seq.push({ id: r.lineId, tang: tangOfGroup(g), row: r, g }) }))
  return seq
}
const sameSeq = (a, b) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.tang === b[i].tang)

/* Tìm 1 dòng duy nhất bị kéo: bỏ nó ra thì 2 thứ tự trùng nhau */
function singleMove(oldSeq, newSeq) {
  const cands = newSeq.filter((x, i) => !oldSeq[i] || oldSeq[i].id !== x.id || oldSeq[i].tang !== x.tang)
  for (let k = 0; k < cands.length; k++) {
    const id = cands[k].id
    const a = oldSeq.filter(x => x.id !== id)
    const b = newSeq.filter(x => x.id !== id)
    if (sameSeq(a, b)) {
      const i = newSeq.findIndex(x => x.id === id)
      const me = newSeq[i]
      const next = newSeq.slice(i + 1).filter(x => x.tang === me.tang)[0]
      if (next) return { id, floor: me.tang, target: next.id, before: true }
      const prev = newSeq.slice(0, i).filter(x => x.tang === me.tang).pop()
      return prev ? { id, floor: me.tang, target: prev.id, before: false } : { id, floor: me.tang, target: '', before: true }
    }
  }
  return null
}

/* Nhiều dòng đổi chỗ: các vị trí của dòng trong phạm vi được điền lại theo thứ tự mới, dòng ngoài phạm vi giữ nguyên chỗ */
function slotFill(all, newSeq) {
  const inSet = {}; newSeq.forEach(x => { inSet[x.id] = x })
  let k = 0
  return all.map(l => {
    if (!inSet[l.lineId]) return l
    const x = newSeq[k++]
    const src = all.filter(z => z.lineId === x.id)[0] || l
    return (src.tang || '') === x.tang ? src : { ...src, tang: x.tang }
  })
}

async function runMoves(entryMoves, dir) {
  const S = getState()
  const want = {}
  entryMoves.forEach(m => { want[m.lineId] = dir === 'undo' ? m.old : m.new })
  const arr = S.lines.map(l => (want[l.lineId] ? { ...l, tang: want[l.lineId].tang, stt: want[l.lineId].stt } : l))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => ((Number(a.l.stt) || 0) - (Number(b.l.stt) || 0)) || (a.i - b.i))
    .map(x => x.l)
  return reorderLines(arr)
}

export function useLinesSheet(scope) {
  scope = scope || {}
  const mode = Object.prototype.hasOwnProperty.call(scope, 'node') ? 'node' : 'hm'
  const code = String((mode === 'node' ? scope.node : scope.hm) || '')
  const lines = useQsStore(s => s.lines)
  const cur = useQsStore(s => s.cur)
  const btFmt = useQsStore(s => (s.projData && s.projData.btFmt) || null)
  const hist = useQsStore(s => (s.cur ? s.hist[s.cur.maDA] : null))
  const maDA = cur ? cur.maDA : ''
  const cKey = maDA + '|' + mode + '|' + code
  const [, setCv] = useState(0)
  const collapsed = collapsedStore[cKey] || NONE

  const groups = useMemo(() => {
    const floors = floorsList(cur, lines)
    const rows = lines.filter(l => inScope(l, mode, code))
    return floors.map(f => ({
      id: f, name: f, collapsed: !!collapsed[f],
      rows: rows.filter(l => ((l.tang || '').trim() || NO_TANG) === f).map(l => rowOf(l, btFmt ? btFmt[l.lineId] : null)),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, cur, btFmt, mode, code, collapsed])

  const ref = useRef(groups)
  ref.current = groups

  const setCollapsedFrom = useCallback(after => {
    const before = collapsedStore[cKey] || {}
    const next = {}
    ;(after || []).forEach(g => { if (g && g.collapsed) next[g.id] = true })
    const changed = Object.keys({ ...before, ...next }).some(k => !!before[k] !== !!next[k])
    if (changed) { collapsedStore[cKey] = next; setCv(v => v + 1) }
  }, [cKey])

  const apply = useCallback(async (label, before, after, opts) => {
    setCollapsedFrom(after)
    const S = getState()
    if (!S.cur) return
    const ma = S.cur.maDA
    const oldSeq = flatScope(before)
    const newSeq = flatScope(after)
    const oldById = {}; oldSeq.forEach(x => { oldById[x.id] = x })
    const newById = {}; newSeq.forEach(x => { newById[x.id] = x })

    /* 1) ô đổi */
    const patches = []
    const fmtPrev = (S.projData && S.projData.btFmt) || {}   // định dạng ô trước khi đổi (để hoàn tác)
    const fmtAll = { ...fmtPrev }
    let fmtChanged = false
    newSeq.forEach(x => {
      const o = oldById[x.id]; if (!o) return
      const a = o.row; const b = x.row
      if (a === b) return
      const base = lineOf_(x.id) || a
      let fields = {}
      Object.keys({ ...a, ...b }).forEach(k => {
        if (k === 'fmt' || k === 'lineId' || k.charAt(0) === '_') return
        if (a[k] === b[k]) return
        const r = fieldsFor({ ...base, ...fields }, k, b[k])
        if (r && r.msg) toast(r.msg)
        else if (r && r.fields) fields = { ...fields, ...r.fields }
      })
      Object.keys(fields).forEach(f => {
        if (base[f] === fields[f]) { delete fields[f]; return }
        patches.push({ lineId: x.id, field: f, old: base[f], new: fields[f] })
      })
      if (Object.keys(fields).length) updateLine(x.id, fields)
      if (a.fmt !== b.fmt) {
        const prevAll = fmtAll[x.id] || {}
        const nf = {}
        Object.keys({ ...(b.fmt || {}), ...prevAll }).forEach(ck => {
          const o = fmtToBt_((b.fmt || {})[ck])
          if (Object.keys(o).length) nf[ck] = o
        })
        if (Object.keys(nf).length) fmtAll[x.id] = nf; else delete fmtAll[x.id]
        fmtChanged = true
      }
    })
    if (fmtChanged) projDataSet_('btFmt', fmtAll)

    /* 2) dòng bị bỏ */
    const removed = oldSeq.filter(x => !newById[x.id]).map(x => x.id)

    /* 3) đổi chỗ / đổi tầng (chỉ xét các dòng có ở cả hai) */
    const oKeep = oldSeq.filter(x => newById[x.id])
    const nKeep = newSeq.filter(x => oldById[x.id])
    let moves = []
    if (!sameSeq(oKeep, nKeep)) {
      const one = singleMove(oKeep, nKeep)
      if (one) moves = await moveLine(one.id, one.floor, one.target, one.before)
      else moves = await reorderLines(slotFill(getState().lines, nKeep))
    }

    /* 4) ghi lịch sử: vá trường + đổi chỗ + định dạng ô (màu chữ / nền, đậm, căn lề… lưu ở projData.btFmt) */
    const fmtStep = fmtChanged ? { before: fmtPrev, after: fmtAll } : null
    if (opts.record && (patches.length || moves.length || fmtStep)) {
      const h = histOf(ma)
      const past = h.past.slice()
      const last = past[past.length - 1]
      if (opts.merge && last && last.label === label) {
        const merged = last.patches.slice()
        patches.forEach(p => {
          const i = merged.findIndex(q => q.lineId === p.lineId && q.field === p.field)
          if (i >= 0) merged[i] = { ...merged[i], new: p.new }; else merged.push(p)
        })
        const fm = fmtStep ? { before: last.fmt ? last.fmt.before : fmtStep.before, after: fmtStep.after } : last.fmt
        past[past.length - 1] = { ...last, patches: merged, moves: last.moves.concat(moves), fmt: fm }
      } else past.push({ label, patches, moves, fmt: fmtStep })
      setHist(ma, { past, future: [] })
    }

    /* 5) xoá (nhiều dòng thì hỏi), 6) dòng mới */
    if (removed.length) await deleteLines(removed)
    const added = []
    ;(after || []).forEach(g => (g.rows || []).forEach((r, i) => {
      if (r && (!r.lineId || (!oldById[r.lineId] && !lineOf_(r.lineId)))) added.push({ r, g, next: (g.rows || []).slice(i + 1).filter(z => z && z.lineId && oldById[z.lineId])[0] })
    }))
    for (const a of added) {
      const tang = tangOfGroup(a.g)
      const nd = a.r.nhom || (mode === 'node' ? code : '') || getState().node || DEFAULT_NODE
      /* Dòng mới mang khoá cột (giaNCC, donGia...) hoặc khoá Line: đổi qua cùng bảng cột như khi sửa ô,
         bỏ mọi khoá riêng của bảng clone (id, values...) để payload chỉ còn trường Line / sản phẩm */
      let f = {}
      Object.keys(a.r).forEach(k => {
        if (k === 'fmt' || k === 'lineId' || k === 'stt' || k === 'tang' || k.charAt(0) === '_' || a.r[k] === undefined) return
        const r = fieldsFor({ soLuong: 1, donGiaVon: 0, chietKhau: 0, lnPct: 0, donGiaBan: 0, ckKhach: 0, ...f }, k, a.r[k])
        if (r && r.fields) f = { ...f, ...r.fields }
      })
      const sl = Number(f.soLuong) || 1
      const prod = { ...f, ma: f.maSP || a.r.ma || '', ten: f.ten || 'Hạng mục mới', dvt: f.dvt || 'Cái',
        nhom: nd, hangMuc: nodeName(nd), loai: nodeName(nd), tang }
      delete prod.maSP; delete prod.soLuong
      const l = await addLine(prod, sl, { ...prod, maSP: prod.ma, lineId: undefined, soLuong: sl })
      if (l && a.next) await moveLine(l.lineId, tang, a.next.lineId, true)
    }
  }, [mode, code, setCollapsedFrom])

  const commit = useCallback((label, fn, merge) => {
    const before = ref.current
    const after = fn(before)
    if (after === before) return Promise.resolve()
    return apply(label, before, after, { record: true, merge: !!merge })
  }, [apply])

  /* Không ghi lịch sử: gập / mở nhóm (và nếu có đổi dữ liệu thì vẫn lưu, chỉ không hoàn tác được) */
  const patch = useCallback(fn => {
    const before = ref.current
    const after = fn(before)
    if (after === before) return Promise.resolve()
    return apply('', before, after, { record: false })
  }, [apply])

  const step = useCallback(async dir => {
    const S = getState(); if (!S.cur) return
    const ma = S.cur.maDA
    const h = histOf(ma)
    const from = dir === 'undo' ? h.past : h.future
    if (!from.length) return
    const e = dir === 'undo' ? from[from.length - 1] : from[0]
    const by = {}
    e.patches.forEach(p => { by[p.lineId] = { ...(by[p.lineId] || {}), [p.field]: dir === 'undo' ? p.old : p.new } })
    if (dir === 'undo') setHist(ma, { past: h.past.slice(0, -1), future: [e, ...h.future] })
    else setHist(ma, { past: [...h.past, e], future: h.future.slice(1) })
    Object.keys(by).forEach(id => { if (lineOf_(id)) updateLine(id, by[id]) })
    if (e.moves && e.moves.length) await runMoves(e.moves, dir)
    /* bước thêm / xoá dòng: xoá lại hoặc thêm lại dòng; cập nhật bước (mã dòng mới / bản chụp) vào đúng chỗ trong lịch sử */
    if (e.view) e.view[dir]()
    if (e.fmt) projDataSet_('btFmt', dir === 'undo' ? e.fmt.before : e.fmt.after)
    if (e.added || e.removed) {
      const ne = await histRunAddDel(e, dir)
      const h2 = histOf(ma)
      if (dir === 'undo' && h2.future.length) setHist(ma, { past: h2.past, future: [ne, ...h2.future.slice(1)] })
      else if (dir === 'redo' && h2.past.length) setHist(ma, { past: [...h2.past.slice(0, -1), ne], future: h2.future })
    }
  }, [])
  const undo = useCallback(() => step('undo'), [step])
  const redo = useCallback(() => step('redo'), [step])
  /* Quay về trạng thái ngay trước bước thứ i */
  const jumpTo = useCallback(async i => {
    const S = getState(); if (!S.cur) return
    let n = histOf(S.cur.maDA).past.length - i
    while (n-- > 0) await step('undo')
  }, [step])

  const past = hist ? hist.past : []
  const future = hist ? hist.future : []
  return {
    groups, commit, patch, undo, redo, jumpTo,
    canUndo: past.length > 0, canRedo: future.length > 0,
    labels: past.map(p => p.label),
  }
}
