import { useEffect, useState } from 'react'
import { getLiveKnowledge, saveLiveKnowledge } from '../customerApi'

/* Thẻ "Kiến thức bán hàng" trong tab Cấu hình AI: bảng giá, gói dịch vụ, chính sách, câu trả lời mẫu của công ty để AI
   gợi ý cho nhân viên khi Live (CdLiveCoach) dùng đúng số liệu, không tự bịa. Lưu theo công ty (company_settings kdLiveKnowledge),
   chỉ quản trị sửa được. API: customerApi getLiveKnowledge / saveLiveKnowledge. */

const SAMPLE = `Ví dụ:
- Phí thiết kế nhà phố: ... đ/m² sàn (gồm kiến trúc, kết cấu, điện nước, 3D ngoại thất)
- Gói thi công trọn gói: phần thô ... đ/m², hoàn thiện ... đ/m²
- Thời gian thiết kế: ... ngày; thi công nhà 3 tầng: ... tháng
- Thanh toán thiết kế: 50% khi ký, 50% khi bàn giao
- Khách hỏi "sao đắt hơn chỗ khác?": nhấn mạnh ...
- Ưu đãi: ký thi công được giảm ...% phí thiết kế`

function atLabel(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  const p = n => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear()
}

export default function LiveKnowledgeCard() {
  const [cfg, setCfg] = useState(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    getLiveKnowledge().then(r => { if (live) { setCfg(r); setText((r && r.text) || '') } }, e => { if (live) setErr((e && e.message) || 'Không tải được kiến thức bán hàng') })
    return () => { live = false }
  }, [])

  if (!cfg) return err ? <div className="kd-aic-card"><span className="kd-aic-card-t">Kiến thức bán hàng</span><div className="kd-aic-warn">{err}</div></div> : null
  const canEdit = !!cfg.canEdit
  const max = Number(cfg.maxLength) || 8000
  const len = text.length
  const over = len > max
  const dirty = text !== (cfg.text || '')
  const save = async () => {
    if (!canEdit || saving || over || !dirty) return
    setSaving(true); setErr(''); setMsg('')
    try {
      const r = await saveLiveKnowledge(text.trim())
      setCfg(r); setText((r && r.text) || ''); setMsg('Đã lưu')
    } catch (e) {
      setErr((e && e.message) || 'Không lưu được')
    } finally { setSaving(false) }
  }

  return (
    <div className="kd-aic-card">
      <div className="kd-aic-card-h">
        <span className="kd-aic-card-t">Kiến thức bán hàng (AI gợi ý khi Live)</span>
        {dirty && <span className="kd-aic-chip dirty">Chưa lưu</span>}
      </div>
      <div className="kd-aic-mut">
        Bảng giá, gói dịch vụ, chính sách, câu trả lời mẫu của công ty. Khi nhân viên bấm Live nói chuyện với khách, AI dựa vào đây
        để gợi ý câu trả lời đúng số liệu; không có thì AI không đưa ra con số, chỉ gợi ý hẹn gửi báo giá.
        {cfg.updatedAt ? ' Cập nhật lúc ' + atLabel(cfg.updatedAt) + (cfg.updatedBy ? ' bởi ' + cfg.updatedBy : '') + '.' : ''}
      </div>
      {!cfg.aiEnabled && <div className="kd-aic-warn">Máy chủ chưa cấu hình khoá AI nên chưa gợi ý được khi Live.</div>}
      <textarea className="kd-aic-ta" value={text} readOnly={!canEdit || saving} spellCheck={false} placeholder={SAMPLE}
        onChange={e => { setText(e.target.value); setMsg('') }} />
      <div className="kd-aic-row between">
        <span className={'kd-aic-count' + (over ? ' over' : '')}>{len.toLocaleString('vi-VN')} / {max.toLocaleString('vi-VN')} ký tự{over ? ' - quá giới hạn' : ''}</span>
        {canEdit && (
          <span className="kd-aic-row">
            {msg && <span className="kd-aic-mut">{msg}</span>}
            <button type="button" className="kd-aic-btn" disabled={saving || !dirty} onClick={() => setText(cfg.text || '')}>Huỷ thay đổi</button>
            <button type="button" className="kd-aic-btn primary" disabled={saving || !dirty || over} onClick={save}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
          </span>
        )}
      </div>
      {err && <div className="kd-aic-warn">{err}</div>}
    </div>
  )
}
