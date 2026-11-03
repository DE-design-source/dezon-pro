import { reactionEntries } from './reactionUtil'
import './Reaction.css'

/* Hàng cảm xúc dưới bubble: mỗi loại một chip (số lượng, tô nổi chip của mình); bấm chip = thả / bỏ loại đó,
   bấm tổng = xem ai đã thả. reactions = ReactionSummary {counts, total, mine}; chưa ai thả -> không vẽ gì */
export default function ReactionBar({ reactions, onToggle, onShowUsers }) {
  if (!reactions || !reactions.total) return null
  const items = reactionEntries(reactions.counts)
  const mine = reactions.mine || null
  return (
    <div className="ch-react-bar" role="group" aria-label="Cảm xúc">
      {items.map(r => {
        const on = r.code === mine
        /* không có onToggle (chỉ đọc: nhóm giải tán / đang chặn): chip chỉ để xem */
        if (!onToggle) {
          return (
            <span key={r.code} className={'ch-react-chip ro' + (on ? ' mine' : '')} title={`${r.label}: ${r.count}` + (on ? ' (có bạn)' : '')}>
              <span className="ch-react-emoji" aria-hidden="true">{r.emoji}</span>
              <span className="ch-react-count">{r.count}</span>
            </span>
          )
        }
        const tip = `${r.label}: ${r.count}` + (on ? ' (có bạn) - bấm để bỏ' : ' - bấm để thả ' + r.label)
        return (
          <button key={r.code} type="button" className={'ch-react-chip' + (on ? ' mine' : '')} title={tip} aria-pressed={on}
            onClick={e => { e.stopPropagation(); if (onToggle) onToggle(r.code) }}>
            <span className="ch-react-emoji" aria-hidden="true">{r.emoji}</span>
            <span className="ch-react-count">{r.count}</span>
          </button>
        )
      })}
      {onShowUsers && (
        <button type="button" className="ch-react-total" title="Xem ai đã thả cảm xúc" aria-label={`${reactions.total} cảm xúc - xem ai đã thả`}
          onClick={e => { e.stopPropagation(); onShowUsers() }}>
          {reactions.total}
        </button>
      )}
    </div>
  )
}
