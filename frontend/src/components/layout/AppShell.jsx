import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import PageGuard from './PageGuard'
import useHeaderTabsFit from '../../hooks/useHeaderTabsFit'
import { BugReportHost } from '../ui/BugReport'
import { CaptureHost } from '../ui/CaptureTools'
import ViewAsBanner from './ViewAsBanner'

export default function AppShell() {
  useHeaderTabsFit()
  return (
    <div className="app-shell">
      <Sidebar />
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ViewAsBanner />
        <PageGuard inline><Outlet /></PageGuard>
      </div>
      <BugReportHost />
      <CaptureHost />

    </div>
  )
}
