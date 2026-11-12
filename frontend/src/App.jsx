import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import AppShell from './components/layout/AppShell'
import AppGate from './components/layout/AppGate'
import PageGuard from './components/layout/PageGuard'
import Dashboard from './pages/Dashboard/Dashboard'
import Chat from './pages/Chat/Chat'
import Marketing from './pages/Marketing/Marketing'
import KinhDoanh from './pages/KinhDoanh/KinhDoanh'
import DuAn from './pages/DuAn/DuAn'
import QuanLyThietKe from './pages/QuanLyThietKe/QuanLyThietKe'
import Gantt from './pages/Gantt/Gantt'
import NhiemVu from './pages/NhiemVu/NhiemVu'
import ChamCong from './pages/ChamCong/ChamCong'
import ChamCongMobile from './pages/ChamCongMobile/ChamCongMobile'
import TaiChinh from './pages/TaiChinh/TaiChinh'
import QS from './pages/QS/QS'
import QSPro from './pages/QSPro/QSPro'
import BIM from './pages/BIM/BIM'
import MuaHang from './pages/MuaHang/MuaHang'
import Wiki from './pages/Wiki/Wiki'
import Lich from './pages/Lich/Lich'
import BanLamViec from './pages/BanLamViec/BanLamViec'
import SanXuat from './pages/SanXuat/SanXuat'
import IT from './pages/IT/IT'
import RD from './pages/RD/RD'
import CaiDat from './pages/CaiDat/CaiDat'

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        {/* Một đăng nhập cho mọi trang (AppGate); quyền từng trang kiểm trong AppShell / QSPro theo data/navigation.js */}
        <Route element={<AppGate />}>
          {/* QS Pro (trang ngoài) phủ kín màn hình, nằm ngoài AppShell nên không có sidebar */}
          <Route path="qs-pro" element={<PageGuard><QSPro /></PageGuard>} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            {/* link mời vào nhóm chat (API.md "Quản trị nhóm" - đường dẫn tham gia) */}
            <Route path="chat/join/:token" element={<Chat />} />
            {/* xác nhận đăng nhập bằng mã QR: /chat/qr#<mã> (API.md "Đăng nhập bằng QR") */}
            <Route path="chat/qr" element={<Chat />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="kinh-doanh" element={<KinhDoanh />} />
            <Route path="du-an" element={<DuAn />} />
            <Route path="quan-ly-thiet-ke" element={<QuanLyThietKe />} />
            <Route path="gantt" element={<Gantt />} />
            <Route path="nhiem-vu" element={<NhiemVu />} />
            <Route path="cham-cong" element={<ChamCong />} />
            <Route path="cham-cong-mobile" element={<ChamCongMobile />} />
            <Route path="tai-chinh" element={<TaiChinh />} />
            <Route path="qs" element={<QS />} />
            <Route path="bim" element={<BIM />} />
            <Route path="mua-hang" element={<MuaHang />} />
            <Route path="wiki" element={<Wiki />} />
            <Route path="lich" element={<Lich />} />
            <Route path="ban-lam-viec" element={<BanLamViec />} />
            <Route path="san-xuat" element={<SanXuat />} />
            <Route path="it" element={<IT />} />
            <Route path="rd" element={<RD />} />
            <Route path="cai-dat" element={<CaiDat />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </ThemeProvider>
  )
}
