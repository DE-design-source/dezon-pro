import { useState } from 'react'
import QsIcon from '../common/QsIcon'
import { setHas, normSet, countSet, clipSet } from './accessUtil'
import './admin.css'
import '../congty/congty.css'

/* Ma trận phân quyền 3 cấp (N21): nhóm = module (thu gọn được), dòng = tab, cột = thao tác.
   Props:
   - catalog: {actions: [{key, label}], modules: [{key, label, tabs: [{key, label, actions}]}]} (GET /api/v1/access/catalog)
   - value: tập quyền {module: {tab: [thao tác]}} | null (null = "Theo mặc định cũ", chưa đặt riêng)
   - onChange(next | null)
   - ceiling: tập quyền tối đa được tích (quyền người cấp / trần công ty); null = không giới hạn
   - fallback: tập quyền đang áp dụng khi value = null (chỉ hiển thị)
   - allowDefault: cho chọn "Theo mặc định cũ"; defaultText: mô tả chế độ đó
   - readOnly */
export default function AccessMatrix({ catalog, value, onChange, ceiling = null, fallback = null, allowDefault = true, defaultText = '', readOnly = false }) {
  const [open, setOpen] = useState({})
  if (!catalog) return null
  const custom = value != null
  const shown = custom ? value : (fallback || {})
  const edit = custom && !readOnly
  const acts = catalog.actions
  const sup = (t, a) => t.actions.indexOf(a) >= 0
  const inCeil = (m, t, a) => !ceiling || setHas(ceiling, m, t, a)
  const ok = (m, t, a) => sup(t, a) && inCeil(m.key, t.key, a)
  // Ô tích được của 1 nhóm: [[module, tab, action]...]
  const cellsOf = (mods, tabFilter, actFilter) => {
    const out = []
    mods.forEach(m => m.tabs.forEach(t => {
      if (tabFilter && tabFilter !== t.key) return
      acts.forEach(a => { if ((!actFilter || actFilter === a.key) && ok(m, t, a.key)) out.push([m.key, t.key, a.key]) })
    }))
    return out
  }
  const stateOf = cells => {
    const n = cells.filter(c => setHas(shown, c[0], c[1], c[2])).length
    return !cells.length ? 'dis' : n === cells.length ? 'on' : n ? 'mixed' : 'off'
  }

  /* Bật / tắt nhiều ô: bật thao tác khác "Xem" thì bật luôn "Xem" của tab; tắt "Xem" thì bỏ hết tab đó */
  function apply(cells, on) {
    if (!edit) return
    const next = JSON.parse(JSON.stringify(value || {}))
    const add = (m, t, a) => {
      next[m] = next[m] || {}
      const l = next[m][t] = next[m][t] || []
      if (l.indexOf(a) < 0) l.push(a)
    }
    cells.forEach(([m, t, a]) => {
      if (on) {
        add(m, t, a)
        if (a !== 'view' && inCeil(m, t, 'view')) add(m, t, 'view')
      } else if (next[m] && next[m][t]) {
        if (a === 'view') delete next[m][t]
        else next[m][t] = next[m][t].filter(x => x !== a)
      }
    })
    onChange(normSet(next, catalog))
  }
  const toggle = cells => apply(cells, stateOf(cells) !== 'on')

  const all = cellsOf(catalog.modules)
  const total = all.length
  const onN = countSet(ceiling ? clipSet(shown, ceiling, catalog) : normSet(shown, catalog))
  const over = custom && ceiling ? countSet(normSet(value, catalog)) - countSet(clipSet(value, ceiling, catalog)) : 0
  const allOpen = catalog.modules.every(m => open[m.key])
  const allSt = stateOf(all)

  return (
    <div className={`qsa-am${edit ? '' : ' ro'}`}>
      <div className="qsa-am-bar">
        {allowDefault && !readOnly ? (
          <div className="qsco-seg qsa-am-mode" role="radiogroup">
            <button type="button" role="radio" aria-checked={!custom} className={`qsco-seg-b${custom ? '' : ' on'}`}
              onClick={() => { if (custom) onChange(null) }}>Theo mặc định cũ</button>
            <button type="button" role="radio" aria-checked={custom} className={`qsco-seg-b${custom ? ' on' : ''}`}
              onClick={() => { if (!custom) onChange(clipSet(fallback || {}, ceiling, catalog)) }}>Tuỳ chỉnh</button>
          </div>
        ) : null}
        <span className={`qsco-cnt${onN ? '' : ' zero'}`} title="Số ô quyền đang bật / số ô được phép">{onN} / {total}</span>
        <span className="qsco-f-sp" />
        <button type="button" className="qsco-all" onClick={() => {
          const o = {}; if (!allOpen) catalog.modules.forEach(m => { o[m.key] = true }); setOpen(o)
        }}>{allOpen ? 'Thu gọn' : 'Mở hết'}</button>
        {edit ? <button type="button" className="qsco-all qsa-am-all" onClick={() => apply(all, allSt !== 'on')}>{allSt === 'on' ? 'Bỏ hết' : 'Chọn hết'}</button> : null}
      </div>
      {!custom && defaultText ? (
        <div className="qsa-am-note"><QsIcon name="lock" size={13} /><span>{defaultText}</span></div>
      ) : null}
      {over > 0 ? <div className="qsa-am-note warn"><QsIcon name="lock" size={13} /><span>{over} quyền vượt phạm vi được cấp (ô viền cam) — sẽ bị bỏ khi lưu.</span></div> : null}

      <div className="qsa-am-scroll">
        <div className="qsa-am-grid" role="table" aria-label="Ma trận phân quyền">
          <div className="qsa-am-row qsa-am-head" role="row">
            <span className="qsa-am-lbl" role="columnheader">Phân hệ / Tab</span>
            {acts.map(a => {
              const cells = cellsOf(catalog.modules, null, a.key)
              return (
                <span key={a.key} className="qsa-am-c" role="columnheader">
                  {edit && cells.length ? <button type="button" className="qsa-am-hb" title={'Bật / tắt "' + a.label + '" cho mọi phân hệ'} onClick={() => toggle(cells)}>{a.label}</button> : a.label}
                </span>
              )
            })}
            <span className="qsa-am-c" role="columnheader">Tất cả</span>
          </div>

          {catalog.modules.map(m => {
            const mc = cellsOf([m])
            const isOpen = !!open[m.key]
            const out = !mc.length
            const on = mc.filter(c => setHas(shown, c[0], c[1], c[2])).length
            return (
              <div key={m.key} className={`qsa-am-grp${isOpen ? ' open' : ''}${out ? ' out' : ''}`} role="rowgroup">
                <div className="qsa-am-row qsa-am-mod" role="row">
                  <button type="button" className="qsa-am-lbl qsa-am-tg" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [m.key]: !o[m.key] }))}>
                    <QsIcon name={isOpen ? 'up' : 'down'} size={12} />
                    <b>{m.label}</b>
                    {out ? <i className="qsa-am-out">Ngoài phạm vi</i> : <i className={`qsa-am-n${on ? ' on' : ''}`}>{on}/{mc.length}</i>}
                  </button>
                  {acts.map(a => <Cell key={a.key} st={stateOf(cellsOf([m], null, a.key))} edit={edit} title={m.label + ' · ' + a.label + ' (mọi tab)'} onClick={() => toggle(cellsOf([m], null, a.key))} />)}
                  <Cell st={stateOf(mc)} edit={edit} title={m.label + ' · mọi thao tác'} onClick={() => toggle(mc)} />
                </div>
                {isOpen ? m.tabs.map(t => {
                  const rc = cellsOf([m], t.key)
                  return (
                    <div key={t.key} className="qsa-am-row qsa-am-tab" role="row">
                      <span className="qsa-am-lbl" role="rowheader" title={m.label + ' > ' + t.label}>{t.label}</span>
                      {acts.map(a => {
                        if (!sup(t, a.key)) return <span key={a.key} className="qsa-am-c qsa-am-na" role="cell" aria-label="Không áp dụng">·</span>
                        const has = setHas(shown, m.key, t.key, a.key)
                        const inC = inCeil(m.key, t.key, a.key)
                        const st = !inC ? (has && custom ? 'over' : 'dis') : has ? 'on' : 'off'
                        return <Cell key={a.key} st={st} edit={edit} title={m.label + ' > ' + t.label + ' · ' + a.label + (inC ? '' : ' — ngoài phạm vi được cấp')}
                          onClick={() => apply([[m.key, t.key, a.key]], !has)} />
                      })}
                      <Cell st={stateOf(rc)} edit={edit} title={t.label + ' · mọi thao tác'} onClick={() => toggle(rc)} />
                    </div>
                  )
                }) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* Ô tích: on / off / mixed / dis (ngoài phạm vi) / over (đã tích nhưng vượt phạm vi - chỉ bỏ được) */
function Cell({ st, edit, title, onClick }) {
  const can = edit && (st !== 'dis')
  return (
    <span className="qsa-am-c" role="cell">
      <button type="button" className={`qsa-am-ck ${st}`} role="checkbox" aria-checked={st === 'on' || st === 'over' ? 'true' : st === 'mixed' ? 'mixed' : 'false'}
        disabled={!can} title={title} onClick={onClick}>
        {st === 'on' || st === 'over' ? <QsIcon name="check" size={11} /> : null}
      </button>
    </span>
  )
}
