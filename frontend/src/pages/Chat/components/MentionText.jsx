import { MENTION_ALL_ID, splitMentions } from './mentionUtil'
import './Mention.css'

/* Nội dung tin văn bản có @nhắc tên: đoạn được nhắc tô đậm, nhắc tới mình / @Tất cả tô nổi hơn.
   Dựng bằng node React (không dùng HTML thô) */
export default function MentionText({ text, mentions, meId }) {
  if (!Array.isArray(mentions) || !mentions.length) return text
  return splitMentions(text, mentions).map((p, i) => {
    if (!p.mention) return p.text
    const self = p.mention.user_id === MENTION_ALL_ID || p.mention.user_id === meId
    return <span key={i} className={'ch-mention' + (self ? ' me' : '')}>{p.text}</span>
  })
}
