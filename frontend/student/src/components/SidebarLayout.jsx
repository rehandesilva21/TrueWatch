import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/',            label: 'Overview',   icon: 'home' },
  { to: '/exams',        label: 'My exams',   icon: 'calendar' },
  { to: '/results',      label: 'Past exams', icon: 'clock' },
  { to: '/profile',      label: 'Profile',    icon: 'user' },
  { to: '/settings',     label: 'Settings',   icon: 'gear' },
]

const icons = {
  home:     <path d="M3 10.5L12 3l9 7.5M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="3" strokeWidth="1.8"/><path d="M3.5 9.5h17M8 3v4M16 3v4" strokeWidth="1.8" strokeLinecap="round"/></>,
  clock:    <><circle cx="12" cy="12" r="8.5" strokeWidth="1.8"/><path d="M12 7.5V12l3 2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></>,
  user:     <><circle cx="12" cy="8" r="3.5" strokeWidth="1.8"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" strokeWidth="1.8" strokeLinecap="round"/></>,
  gear:     <><circle cx="12" cy="12" r="3" strokeWidth="1.8"/><path d="M19.4 13.5a7.9 7.9 0 000-3l2-1.5-2-3.4-2.3.9a7.9 7.9 0 00-2.6-1.5L14 2.5h-4l-.5 2.5a7.9 7.9 0 00-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.9 7.9 0 000 3l-2 1.5 2 3.4 2.3-.9a7.9 7.9 0 002.6 1.5l.5 2.5h4l.5-2.5a7.9 7.9 0 002.6-1.5l2.3.9 2-3.4-2-1.5z" strokeWidth="1.5" strokeLinejoin="round"/></>,
}

export default function SidebarLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'ST'

  return (
    // Pinned to the viewport — this element never scrolls, so the
    // background and sidebar stay put no matter how long a page's content is.
    <div className="h-screen relative flex overflow-hidden">
      <div className="liquid-bg" />

      {/* Sidebar — fixed height, no internal scroll of its own */}
      <aside className="w-64 shrink-0 p-4 hidden md:block h-screen">
        <div className="glass-panel h-[calc(100vh-2rem)] p-4 flex flex-col">

          <div className="flex items-center gap-2.5 px-2 py-2 mb-6 shrink-0">
            <div className="w-9 h-9 rounded-[11px] glass-panel-strong flex items-center justify-center shrink-0">
              <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>TW</span>
            </div>
            <span className="font-semibold tracking-tight">TrueWatch</span>
          </div>

          <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
            {nav.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-all ${
                    isActive
                      ? 'text-white shadow-sm'
                      : 'hover:bg-white/50'
                  }`
                }
                style={({ isActive }) => isActive ? { background: 'var(--accent)' } : { color: 'var(--ink)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="shrink-0">
                  {icons[item.icon]}
                </svg>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t pt-3 mt-3 shrink-0" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ background: 'var(--accent)' }}>
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs truncate" style={{ color: 'var(--ink-soft)' }}>{user?.email}</p>
              </div>
            </div>
            <button
              onClick={() => { logout(); navigate('/login') }}
              className="w-full mt-1 text-left px-3 py-2 rounded-xl text-sm font-medium hover:bg-white/50 transition-colors"
              style={{ color: '#D70015' }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content — the only scrollable region on the page */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto p-4 md:p-6 pb-10">
        {children}
      </main>
    </div>
  )
}