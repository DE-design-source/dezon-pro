import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import PageGuard from './PageGuard'
import useHeaderTabsFit from '../../hooks/useHeaderTabsFit'

export default function AppShell() {
  useHeaderTabsFit()
  return (
    <div className="app-shell">
      <Sidebar />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <PageGuard inline><Outlet /></PageGuard>
      </div>
    </div>
  )
}
