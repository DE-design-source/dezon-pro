export const NAV_MAIN = [
  {
    path: '/',
    label: 'Newsfeed',
    perm: 'newsfeed',
    badge: null,
    icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  },
  {
    path: '/chat',
    label: 'Chat',
    perm: 'chat',
    badge: null, // số thật = tổng tin chưa đọc của Dezon Chat, Sidebar tự lấy từ chatStore
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  },
  {
    path: '/marketing',
    label: 'Marketing',
    perm: 'marketing',
    badge: null,
    icon: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  },
  {
    path: '/kinh-doanh',
    label: 'Kinh doanh',
    perm: 'kinhdoanh',
    badge: null,
    icon: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  },
  {
    path: '/quan-ly-thiet-ke',
    label: 'Quản lý thiết kế',
    perm: 'thietke',
    badge: null,
    icon: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/>',
  },
  {
    path: '/du-an',
    label: 'Quản lý dự án',
    perm: 'thicong',
    badge: null,
    icon: '<rect x="3" y="5" width="12" height="3" rx="1"/><rect x="3" y="11" width="17" height="3" rx="1"/><rect x="3" y="17" width="8" height="3" rx="1"/>',
  },
  {
    path: '/cham-cong',
    label: 'HR',
    perm: 'hr',
    badge: null,
    icon: '<path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.3"/>',
  },
  {
    path: '/tai-chinh',
    label: 'Tài chính',
    perm: 'taichinh',
    badge: null,
    icon: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>',
  },
  {
    path: '/qs',
    label: 'QS',
    perm: 'qs', // hiện khi được ít nhất 1 tab QS
    badge: null,
    icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
  },
  {
    path: '/bim',
    label: 'BIM',
    perm: 'bim',
    badge: null,
    icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  },
  {
    path: '/mua-hang',
    label: 'Mua hàng',
    perm: 'muahang', // chung quyền với tab Mua hàng của QS
    badge: null,
    icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  },
  {
    path: '/san-xuat',
    label: 'Sản xuất',
    perm: 'sanxuat',
    badge: null,
    icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  },
  {
    path: '/it',
    label: 'IT',
    perm: 'it',
    badge: null,
    icon: '<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  },
  {
    path: '/rd',
    label: 'R&D',
    perm: 'rd',
    badge: null,
    icon: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.05V17h6v-.25c0-.85.4-1.55 1-2.05A7 7 0 0 0 12 2z"/>',
  },
]

export const NAV_BOTTOM = [
  {
    path: '/ban-lam-viec',
    label: 'Bàn làm việc',
    perm: 'banlamviec',
    badge: null,
    icon: '<rect x="2" y="7" width="20" height="13" rx="2.5"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M2 13h20"/>',
  },
  {
    path: '/lich',
    label: 'Lịch',
    perm: 'lich',
    badge: null,
    icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  },
  {
    path: '/wiki',
    label: 'Wiki',
    perm: 'wiki',
    badge: null,
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  },
  {
    path: '/cai-dat',
    label: 'Cài đặt',
    perm: null, // luôn hiện: tài khoản, đăng xuất
    badge: null,
    icon: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  },
]

/* Quyền của route không có trên thanh bên (mảng = được 1 trong số đó): Gantt mở từ Bàn làm việc, Nhiệm vụ mở từ Lịch */
const EXTRA_PERMS = {
  '/gantt': ['thicong', 'banlamviec'],
  '/nhiem-vu': ['banlamviec', 'lich'],
  '/cham-cong-mobile': 'hr',
  '/qs-pro': 'qs',
}
const PATH_PERMS = {}
NAV_MAIN.concat(NAV_BOTTOM).forEach(it => { PATH_PERMS[it.path] = it.perm })
Object.assign(PATH_PERMS, EXTRA_PERMS)

/* Quyền cần để vào 1 đường dẫn (services/workSession.js canPage); null = ai đăng nhập cũng vào được.
   Đường dẫn con (/chat/join/:token, /chat/qr) theo đoạn đầu */
export function permOfPath(pathname) {
  const seg = String(pathname || '').split('/').filter(Boolean)[0]
  const p = seg ? '/' + seg : '/'
  return p in PATH_PERMS ? PATH_PERMS[p] : null
}
