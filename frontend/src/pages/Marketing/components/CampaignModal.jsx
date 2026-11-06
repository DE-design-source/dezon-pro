import { useRef, useState } from 'react'
import { GROUP_ORDER, CAMP_STEPS, CAMP_STEP_TITLE, CAMP_TYPES, CAMP_CLIENTS, catalogItem, fmt, monthsBetween, lineTotal } from '../../../data/marketingData'
import { MK_FONT } from './CampaignsTab'
import QuoteBlock from './QuoteBlock'
import DatePicker from '../../../components/ui/DatePicker'

const EMPTY_FORM = { name: '', type: CAMP_TYPES[0], client: CAMP_CLIENTS[0], owner: 'Trần Anh', start: '', end: '', notes: '' }
const STEP_TAB_LABEL = { basic: '1. Thông tin chiến dịch', items: '2. Chọn hạng mục chi phí', quote: '3. Báo giá & xác nhận' }
const pickHead = { fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace", fontSize: 10.5, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }
const muted = { color: 'var(--text-muted)' }

/* Modal "Tạo chiến dịch Marketing" — 3 bước. Luôn được mount, bật/tắt bằng display như bản HTML;
   mỗi lần mở, trang cha đổi `key` để xoá trắng form giống openCampModal(). */
export default function CampaignModal({ open, catalog, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [draftItems, setDraftItems] = useState({})
  const [step, setStep] = useState(0)
  /* Tăng mỗi lần vào bước "items" để ô số lượng dựng lại theo draftItems (renderItemPicker) */
  const [pickerKey, setPickerKey] = useState(0)
  const nameRef = useRef(null)

  const stepName = CAMP_STEPS[step]
  const months = monthsBetween(form.start, form.end)
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  function goStep(idx) {
    setStep(idx)
    if (CAMP_STEPS[idx] === 'items') setPickerKey(k => k + 1)
  }
  function next() {
    if (step === 0 && !form.name.trim()) { nameRef.current.focus(); return }
    if (step < CAMP_STEPS.length - 1) goStep(step + 1)
  }
  function back() { if (step > 0) goStep(step - 1) }

  const draftTotal = Object.keys(draftItems).reduce((sum, id) => {
    const qty = draftItems[id]
    const it = catalogItem(catalog, id)
    return (qty > 0 && it) ? sum + lineTotal(it, qty, months) : sum
  }, 0)

  function save() {
    onSave({
      name: form.name.trim() || 'Chiến dịch chưa đặt tên',
      type: form.type,
      client: form.client,
      owner: form.owner || 'Trần Anh',
      start: form.start,
      end: form.end,
      status: 'draft',
      notes: form.notes,
      items: Object.keys(draftItems).filter(id => draftItems[id] > 0).map(id => ({ id, qty: draftItems[id] })),
    })
  }

  /* Chiến dịch tạm để xem trước báo giá ở bước 3 (renderModalQuoteRecap) */
  const fakeCamp = {
    name: form.name || '(Chưa đặt tên)', type: form.type, client: form.client, owner: form.owner,
    start: form.start, end: form.end, status: 'draft', notes: form.notes,
    items: Object.keys(draftItems).map(id => ({ id, qty: draftItems[id] })),
  }

  const isLast = step === CAMP_STEPS.length - 1

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ display: open ? 'flex' : 'none', position: 'fixed', inset: 0, background: 'rgba(15,18,25,.5)', zIndex: 100, alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--surface)', width: 820, maxWidth: '94vw', maxHeight: '90vh', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 80px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontFamily: MK_FONT, fontWeight: 800, fontSize: 17 }}>Tạo chiến dịch Marketing</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Khởi tạo → chọn hạng mục chi phí vào gói → xác nhận báo giá.</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, flex: 'none' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 24px 0', borderBottom: '1px solid var(--border)' }}>
          {CAMP_STEPS.map((s, i) => {
            const active = s === stepName
            /* Bản HTML chỉ đổi nền + màu chữ khi chuyển bước; độ đậm chữ giữ theo markup ban đầu (tab 1: 700, còn lại: 600) */
            return (
              <button key={s} onClick={() => goStep(i)} style={{ border: 'none', cursor: 'pointer', padding: '8px 14px', borderRadius: '8px 8px 0 0', background: active ? 'var(--marketing-tint)' : 'none', color: active ? 'var(--marketing)' : 'var(--text-muted)', fontWeight: i === 0 ? 700 : 600, fontSize: 12.5, fontFamily: 'inherit' }}>{STEP_TAB_LABEL[s]}</button>
            )
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px' }}>
          {/* Bước 1: Thông tin cơ bản */}
          <div style={{ display: stepName === 'basic' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
            <div className="mk-field"><label>Tên chiến dịch *</label><input ref={nameRef} type="text" placeholder="VD: Ra mắt Riverside Giai đoạn 3" value={form.name} onChange={set('name')} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="mk-field"><label>Loại chiến dịch</label>
                <select value={form.type} onChange={set('type')}>
                  {CAMP_TYPES.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="mk-field"><label>Dự án / khách hàng liên quan</label>
                <select value={form.client} onChange={set('client')}>
                  {CAMP_CLIENTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div className="mk-field"><label>Người phụ trách</label><input type="text" value={form.owner} onChange={set('owner')} /></div>
              <div className="mk-field"><label>Bắt đầu</label><DatePicker value={form.start} max={form.end || undefined} ariaLabel="Bắt đầu" onChange={d => setForm(f => ({ ...f, start: d }))} /></div>
              <div className="mk-field"><label>Kết thúc</label><DatePicker value={form.end} min={form.start || undefined} ariaLabel="Kết thúc" onChange={d => setForm(f => ({ ...f, end: d }))} /></div>
            </div>
            <div className="mk-field"><label>Ghi chú</label><textarea rows={3} placeholder="Mục tiêu chiến dịch, KPI kỳ vọng..." value={form.notes} onChange={set('notes')} /></div>
          </div>

          {/* Bước 2: Chọn hạng mục chi phí */}
          <div style={{ display: stepName === 'items' ? 'flex' : 'none', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Nhập số lượng cho hạng mục muốn đưa vào gói (0 = không chọn). Hạng mục theo "tháng"/"người-tháng" sẽ tự nhân theo số tháng chiến dịch chạy; hạng mục "lần"/"sự kiện" tính theo số lượng đã nhập.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {GROUP_ORDER.map(g => {
                const items = catalog.filter(c => c.group === g)
                return (
                  <div className="mk-grp-card" key={g}>
                    <div className="mk-grp-head" style={{ background: 'var(--surface-alt)', fontSize: 12.5 }}>{g}. {items[0].groupLabel}</div>
                    <div className="mk-pick-row" style={pickHead}>
                      <span>Hạng mục</span><span>Đơn vị</span><span>Đơn giá</span><span>SL</span><span>Thành tiền</span>
                    </div>
                    {items.map(it => (
                      <div className="mk-pick-row" key={it.id}>
                        <span style={{ fontSize: 13 }}>{it.name}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{it.unit}</span>
                        <span className="mono" style={{ fontSize: 12 }}>{fmt(it.price)}</span>
                        <input
                          key={pickerKey}
                          className="mk-qty-input" type="number" min="0" step="1"
                          defaultValue={draftItems[it.id] || 0}
                          onInput={e => {
                            const qty = Math.max(0, parseInt(e.target.value, 10) || 0)
                            setDraftItems(d => ({ ...d, [it.id]: qty }))
                          }}
                        />
                        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--marketing)' }}>{fmt(lineTotal(it, draftItems[it.id] || 0, months))}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bước 3: Báo giá & xác nhận */}
          <div style={{ display: stepName === 'quote' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="mk-grp-card" style={{ marginBottom: 14 }}>
                <div className="mk-grp-head" style={{ background: 'var(--marketing-tint)', color: 'var(--marketing)' }}>{fakeCamp.name}</div>
                <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 12.5 }}>
                  <div><span style={muted}>Loại:</span> {fakeCamp.type}</div>
                  <div><span style={muted}>Dự án/KH:</span> {fakeCamp.client}</div>
                  <div><span style={muted}>Phụ trách:</span> {fakeCamp.owner}</div>
                  <div><span style={muted}>Thời gian:</span> {fakeCamp.start || '—'} → {fakeCamp.end || '—'} ({months} tháng)</div>
                </div>
              </div>
              <QuoteBlock catalog={catalog} camp={fakeCamp} vat={false} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderTop: '1px solid var(--border)', gap: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Bước {step + 1}/3 — {CAMP_STEP_TITLE[stepName]}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: stepName === 'items' ? 'block' : 'none' }}>Tạm tính: {fmt(draftTotal)}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={back} style={{ display: step === 0 ? 'none' : 'inline-block', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Quay lại</button>
              <button onClick={next} style={{ display: isLast ? 'none' : 'inline-block', border: 'none', background: 'var(--marketing)', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Tiếp theo</button>
              <button onClick={save} style={{ display: isLast ? 'inline-block' : 'none', border: 'none', background: 'var(--marketing)', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Lưu chiến dịch &amp; xuất báo giá</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
