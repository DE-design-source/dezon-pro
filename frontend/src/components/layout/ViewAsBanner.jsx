import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useWorkSession } from '../../services/workSession'
import * as qsStore from '../../pages/QS/state/store'
import * as qsApi from '../../pages/QS/api/qsApi'
import { writeViewAs, isAbort } from '../../pages/QS/api/http'
import './ViewAsBanner.css'

/* Dải "Đang xem dữ liệu của <công ty> · Thoát chế độ xem" cho quản trị hệ thống đang "Xem dữ liệu" 1 công ty (qs_viewAs).
   Hiện ở mọi trang (AppShell, QS Pro). Trang QS / Cài đặt dùng store QS (setViewAs tự nạp lại);
   trang khác đã tải dữ liệu theo header x-view-company cũ nên bỏ chế độ xem rồi tải lại trang.
   Trang Cài đặt đã có dải riêng trong mục Công ty / Admin -> hide để khỏi hiện 2 dải. */
export default function ViewAsBanner({ hide }) {
  const { me } = useWorkSession()
  const viewAs = qsStore.useQsStore(s => s.viewAs)
  const loc = useLocation()
  const [name, setName] = useState('')
  const on = !!(me && me.role === 'super' && viewAs)
  useEffect(() => {
    if (!on) { setName(''); return undefined }
    const ac = new AbortController()
    qsApi.listCongTy(ac.signal).then(list => {
      const c = (list || []).filter(x => String(x.id) === String(viewAs))[0]
      setName(c ? (c.ten || c.ma || '') : '')
    }, e => { if (!isAbort(e)) setName('') })
    return () => ac.abort()
  }, [on, viewAs])
  if (!on || hide) return null

  function exit() {
    if (/^\/(qs|cai-dat)/.test(loc.pathname)) { qsStore.setViewAs(null); return }
    writeViewAs('')
    window.location.reload()
  }
  return (
    <div className="va-bar" role="status">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      <span>Đang xem dữ liệu của <b>{name || 'công ty đã chọn'}</b></span>
      <button type="button" className="va-bar-x" onClick={exit}>Thoát chế độ xem</button>
    </div>
  )
}
