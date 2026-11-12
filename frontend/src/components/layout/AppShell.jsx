import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import useHeaderTabsFit from '../../hooks/useHeaderTabsFit'
import { BugReportHost } from '../ui/BugReport'

export default function AppShell() {
  useHeaderTabsFit()
  return (
    <div className="app-shell">
      <Sidebar />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
      <BugReportHost />

    </div>
  )
}
