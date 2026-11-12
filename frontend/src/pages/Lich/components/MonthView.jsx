import { CAL_DOW_SHORT, MONTH_CELLS } from '../../../data/lichData'

/* Lưới Tháng — giống #calMonthGridWrap trong lich.html (dữ liệu tĩnh) */
export default function MonthView({ hidden, onGotoDay }) {
  return (
    <div className="lc-cal-mo" style={{ display: hidden ? 'none' : 'flex' }}>
      <div className="lc-cal-mo-head">
        {CAL_DOW_SHORT.map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="lc-cal-month-grid" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridTemplateRows: 'repeat(5,1fr)', overflowY: 'auto' }}>
        {MONTH_CELLS.map((c, i) => (
          <div
            key={i}
            className={`lc-cal-month-cell${c.muted ? ' muted' : ''}${c.today ? ' today' : ''}${i % 7 === 0 || i % 7 === 6 ? ' weekend' : ''}`}
            onClick={c.gotoday != null ? () => onGotoDay(c.gotoday) : undefined}
          >
            <div className="lc-cmc-date">{c.d}</div>
            {(c.chips || c.more) && (
              <div className="lc-cmc-events">
                {(c.chips || []).map(ch => <div key={ch.label} className="lc-cmc-chip" style={{ '--chip-c': ch.color }}>{ch.label}</div>)}
                {c.more && <div className="lc-cmc-more">{c.more}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
