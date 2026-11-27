import { useEffect, useMemo, useRef, useState } from 'react'
import './AssetsTab.css'
import { listAssets, createAsset, updateAsset, deleteAsset } from '../api'
import { ASSET_STATUS } from '../../../data/itData'

/* Thiết bị & tài sản CNTT: dữ liệu thật qua REST /api/v1/it/assets (chỉ người có quyền IT). */

const STATUS_KEYS = Object.keys(ASSET_STATUS)
const EMPTY = { name: '', type: '', owner: '', status: 'active', note: '' }
const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim()
const errMsg = e => (e && e.forbidden ? 'Bạn không có quyền IT để quản lý thiết bị' : (e && e.message) || 'Có lỗi xảy ra, thử lại sau')

function ServerIcon() {
  return <svg {...iconProps}><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
}

function StatusSelect({ value, onChange, disabled, id }) {
  const [label, color, bg] = ASSET_STATUS[value] || ASSET_STATUS.active
  return (
    <select id={id} className="it-as-status" style={{ color, background: bg }} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} title="Đổi trạng thái" aria-label={'Trạng thái: ' + label}>
      {STATUS_KEYS.map(k => <option key={k} value={k}>{ASSET_STATUS[k][0]}</option>)}
    </select>
  )
}

/* Ô nhập của form thêm / sửa: tên, loại (gợi ý datalist), người dùng, trạng thái, ghi chú */
function AssetFields({ draft, set, listId, autoFocus }) {
  return (
    <>
      <label className="it-as-field it-as-f-name">
        <span>Tên thiết bị <b>*</b></span>
        <input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="VD: Laptop Dell Latitude 5440" autoFocus={autoFocus} maxLength={200} aria-label="Tên thiết bị" />
      </label>
      <label className="it-as-field">
        <span>Loại</span>
        <input value={draft.type} onChange={e => set({ type: e.target.value })} list={listId} placeholder="VD: Laptop" maxLength={100} aria-label="Loại" />
      </label>
      <label className="it-as-field">
        <span>Người / vị trí sử dụng</span>
        <input value={draft.owner} onChange={e => set({ owner: e.target.value })} placeholder="VD: Phòng Kế toán" maxLength={200} aria-label="Người / vị trí sử dụng" />
      </label>
      <label className="it-as-field">
        <span>Trạng thái</span>
        <StatusSelect value={draft.status} onChange={v => set({ status: v })} />
      </label>
      <label className="it-as-field it-as-f-note">
        <span>Ghi chú</span>
        <input value={draft.note} onChange={e => set({ note: e.target.value })} placeholder="Số serial, cấu hình, ngày mua..." maxLength={500} aria-label="Ghi chú" />
      </label>
    </>
  )
}

const bodyOf = d => ({ name: d.name.trim(), type: d.type.trim(), owner: d.owner.trim(), status: d.status, note: d.note.trim() })

/* canCreate / canEdit / canDelete: phân quyền 3 cấp (N21, module it, tab thietbi) */
export default function AssetsTab({ canManage, canCreate = true, canEdit = true, canDelete = true }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(!!canManage)
  const [loadErr, setLoadErr] = useState('')
  const [msg, setMsg] = useState(null) // {text, kind: 'err' | 'ok'}
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const [edit, setEdit] = useState(EMPTY)
  const [busyId, setBusyId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const msgTimer = useRef(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false; clearTimeout(msgTimer.current) }, [])

  function flash(text, kind = 'err') {
    clearTimeout(msgTimer.current)
    setMsg({ text, kind })
    if (kind === 'ok') msgTimer.current = setTimeout(() => alive.current && setMsg(null), 2600)
  }

  function load() {
    setLoading(true)
    setLoadErr('')
    listAssets()
      .then(list => { if (alive.current) setAssets(list) })
      .catch(e => { if (alive.current) setLoadErr(errMsg(e)) })
      .finally(() => { if (alive.current) setLoading(false) })
  }

  useEffect(() => { if (canManage) load() }, [canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => [...new Set(assets.map(a => (a.type || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [assets])
  const counts = useMemo(() => {
    const c = { all: assets.length }
    STATUS_KEYS.forEach(k => { c[k] = 0 })
    assets.forEach(a => { c[a.status] = (c[a.status] || 0) + 1 })
    return c
  }, [assets])
  const shown = useMemo(() => {
    const nq = norm(q)
    return assets.filter(a => (filter === 'all' || a.status === filter) && (!nq || norm(`${a.name} ${a.type} ${a.owner}`).includes(nq)))
  }, [assets, q, filter])

  if (!canManage) {
    return (
      <div className="it-card it-section-card it-as">
        <div className="it-section-head">
          <div className="it-section-icon"><ServerIcon /></div>
          <h3>Thiết bị & tài sản CNTT</h3>
        </div>
        <div className="it-as-state">Chỉ phòng IT quản lý thiết bị</div>
      </div>
    )
  }

  function openAdd() {
    setDraft(EMPTY)
    setAdding(true)
    setMsg(null)
  }

  async function submitAdd(e) {
    e.preventDefault()
    if (!draft.name.trim()) { flash('Nhập tên thiết bị'); return }
    setSaving(true)
    try {
      const a = await createAsset(bodyOf(draft))
      if (!alive.current) return
      setAssets(prev => [a, ...prev])
      setAdding(false)
      setDraft(EMPTY)
      if (filter !== 'all' && filter !== a.status) setFilter('all')
      flash(`Đã thêm "${a.name}"`, 'ok')
    } catch (err) {
      if (alive.current) flash('Không thêm được thiết bị: ' + errMsg(err))
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  function startEdit(a) {
    setConfirmId(null)
    setEditId(a.id)
    setEdit({ name: a.name || '', type: a.type || '', owner: a.owner || '', status: a.status || 'active', note: a.note || '' })
  }

  async function saveEdit(e) {
    e && e.preventDefault()
    if (!edit.name.trim()) { flash('Tên thiết bị không được để trống'); return }
    const id = editId
    setBusyId(id)
    try {
      const a = await updateAsset(id, bodyOf(edit))
      if (!alive.current) return
      setAssets(prev => prev.map(x => (x.id === id ? a : x)))
      setEditId(null)
      flash('Đã lưu thay đổi', 'ok')
    } catch (err) {
      if (alive.current) flash('Không lưu được: ' + errMsg(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  async function changeStatus(a, status) {
    if (status === a.status) return
    setBusyId(a.id)
    try {
      const out = await updateAsset(a.id, { status })
      if (!alive.current) return
      setAssets(prev => prev.map(x => (x.id === a.id ? out : x)))
      flash(`"${out.name}": ${ASSET_STATUS[out.status]?.[0] || out.status}`, 'ok')
    } catch (err) {
      if (alive.current) flash('Không đổi được trạng thái: ' + errMsg(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  async function doDelete(a) {
    setBusyId(a.id)
    try {
      await deleteAsset(a.id)
      if (!alive.current) return
      setAssets(prev => prev.filter(x => x.id !== a.id))
      setConfirmId(null)
      flash(`Đã xoá "${a.name}"`, 'ok')
    } catch (err) {
      if (alive.current) flash('Không xoá được: ' + errMsg(err))
    } finally {
      if (alive.current) setBusyId(null)
    }
  }

  const brokenN = (counts.broken || 0) + (counts.maintenance || 0)
  const meta = loading && !assets.length ? 'Đang tải…' : `Đang theo dõi ${assets.length} thiết bị${brokenN ? ` · ${brokenN} cần xử lý` : ''}`

  return (
    <div className="it-card it-section-card it-as">
      <datalist id="it-as-types">{types.map(t => <option key={t} value={t} />)}</datalist>
      <div className="it-section-head">
        <div className="it-section-icon"><ServerIcon /></div>
        <h3>Thiết bị & tài sản CNTT</h3>
        <span style={{ flex: 1 }} />
        <span className="it-section-meta">{meta}</span>
      </div>

      <div className="it-as-toolbar">
        <div className="it-as-search">
          <svg {...iconProps} width="13" height="13"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo tên, loại, người dùng…" aria-label="Tìm thiết bị" />
          {q && <button type="button" className="it-as-clear" onClick={() => setQ('')} aria-label="Xoá tìm kiếm">×</button>}
        </div>
        <div className="it-as-chips" role="group" aria-label="Lọc theo trạng thái">
          <button type="button" className={`it-as-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>Tất cả <em>{counts.all}</em></button>
          {STATUS_KEYS.map(k => (
            <button key={k} type="button" className={`it-as-chip${filter === k ? ' on' : ''}`} style={{ '--c': ASSET_STATUS[k][1] }} onClick={() => setFilter(filter === k ? 'all' : k)}>
              <i />{ASSET_STATUS[k][0]} <em>{counts[k] || 0}</em>
            </button>
          ))}
        </div>
        {canCreate && (
          <button type="button" className="it-as-add" onClick={openAdd} disabled={adding}>
            <svg {...iconProps} width="13" height="13" strokeWidth="2.6"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Thêm thiết bị
          </button>
        )}
      </div>

      {msg && (
        <div className={`it-as-msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Đóng">×</button>
        </div>
      )}

      {adding && (
        <form className="it-as-form" onSubmit={submitAdd}>
          <div className="it-as-form-title">Thêm thiết bị mới</div>
          <div className="it-as-grid">
            <AssetFields draft={draft} set={p => setDraft(d => ({ ...d, ...p }))} listId="it-as-types" autoFocus />
          </div>
          <div className="it-as-actions">
            <button type="button" className="it-as-btn" onClick={() => setAdding(false)} disabled={saving}>Huỷ</button>
            <button type="submit" className="it-as-btn primary" disabled={saving || !draft.name.trim()}>{saving ? 'Đang lưu…' : 'Thêm'}</button>
          </div>
        </form>
      )}

      {loading && !assets.length ? (
        <div className="it-as-state">Đang tải danh sách thiết bị…</div>
      ) : loadErr ? (
        <div className="it-as-state err">
          <div>Không tải được danh sách thiết bị: {loadErr}</div>
          <button type="button" className="it-as-btn" onClick={load}>Thử lại</button>
        </div>
      ) : !assets.length ? (
        <div className="it-as-state">
          <div>Chưa có thiết bị nào.</div>
          {!adding && canCreate && <button type="button" className="it-as-btn primary" onClick={openAdd}>Thêm thiết bị đầu tiên</button>}
        </div>
      ) : !shown.length ? (
        <div className="it-as-state">
          <div>Không có thiết bị khớp bộ lọc.</div>
          <button type="button" className="it-as-btn" onClick={() => { setQ(''); setFilter('all') }}>Bỏ lọc</button>
        </div>
      ) : (
        <div className="it-table-wrap">
          <table className="it-table it-as-table">
            <thead>
              <tr><th>Thiết bị</th><th>Loại</th><th>Người / vị trí sử dụng</th><th>Trạng thái</th><th className="it-as-th-act"><span className="it-as-sr">Thao tác</span></th></tr>
            </thead>
            <tbody>
              {shown.map(a => {
                const busy = busyId === a.id
                if (editId === a.id) {
                  return (
                    <tr key={a.id} className="it-as-editing">
                      <td colSpan={5}>
                        <form className="it-as-form inline" onSubmit={saveEdit} onKeyDown={e => { if (e.key === 'Escape') setEditId(null) }}>
                          <div className="it-as-grid">
                            <AssetFields draft={edit} set={p => setEdit(d => ({ ...d, ...p }))} listId="it-as-types" autoFocus />
                          </div>
                          <div className="it-as-actions">
                            <button type="button" className="it-as-btn" onClick={() => setEditId(null)} disabled={busy}>Huỷ</button>
                            <button type="submit" className="it-as-btn primary" disabled={busy || !edit.name.trim()}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )
                }
                return (
                  <tr key={a.id} className={busy ? 'it-as-busy' : undefined}>
                    <td data-label="Thiết bị" className="it-as-name">
                      <b>{a.name}</b>
                      {a.note && <small>{a.note}</small>}
                    </td>
                    <td data-label="Loại">{a.type || <span className="it-as-nil">-</span>}</td>
                    <td data-label="Người / vị trí">{a.owner || <span className="it-as-nil">-</span>}</td>
                    <td data-label="Trạng thái"><StatusSelect value={a.status} disabled={busy || !canEdit} onChange={v => changeStatus(a, v)} /></td>
                    <td className="it-as-act">
                      {confirmId === a.id ? (
                        <span className="it-as-confirm">
                          <span>Xoá thiết bị này?</span>
                          <button type="button" className="it-as-btn danger" onClick={() => doDelete(a)} disabled={busy}>{busy ? 'Đang xoá…' : 'Xoá'}</button>
                          <button type="button" className="it-as-btn" onClick={() => setConfirmId(null)} disabled={busy}>Huỷ</button>
                        </span>
                      ) : (
                        <span className="it-as-icons">
                          {canEdit && (
                            <button type="button" className="it-as-ic" title="Sửa" aria-label={'Sửa ' + a.name} onClick={() => startEdit(a)} disabled={busy}>
                              <svg {...iconProps} width="13" height="13"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" className="it-as-ic del" title="Xoá" aria-label={'Xoá ' + a.name} onClick={() => { setEditId(null); setConfirmId(a.id) }} disabled={busy}>
                              <svg {...iconProps} width="13" height="13"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
