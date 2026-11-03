import { useEffect } from 'react'
import * as L from '../state/chatLogic'
import { colorFor, initials } from './shared'

/* Hộp "Đã xem bởi": tính lại mỗi lần render từ receipts nên tự cập nhật theo receipt.update */
export default function ReadByDialog({ seq, receipts, meId, nameOf, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { read, delivered } = L.readByLists(seq, receipts, meId)
  const row = uid => (
    <div key={uid} className="ch-ct-row ch-readby-row">
      <span className="ch-ct-av" style={{ width: 32, height: 32, background: colorFor(uid), fontSize: 11 }}>{initials(nameOf(uid))}</span>
      <div className="ch-ct-main"><b>{nameOf(uid)}</b></div>
    </div>
  )

  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ch-ct-modal-box ch-dialog ch-readby">
        <div className="ch-ct-modal-head">
          <h3>Người đã xem</h3>
          <button className="ch-ct-x" onClick={onClose} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        <div className="ch-readby-sec">Đã xem ({read.length})</div>
        {read.length ? read.map(row) : <div className="ch-readby-empty">Chưa ai xem</div>}
        <div className="ch-readby-sec">Đã nhận ({delivered.length})</div>
        {delivered.length ? delivered.map(row) : <div className="ch-readby-empty">Không có</div>}
      </div>
    </div>
  )
}
