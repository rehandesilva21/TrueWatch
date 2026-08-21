import { useState } from 'react'
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

// Shared nav-item list, reused inside both the permanent desktop sidebar
// and the slide-in mobile drawer so the two never drift out of sync.
function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
      {nav.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-all ${
              isActive ? 'text-white shadow-sm' : 'hover:bg-white/50'
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
  )
}

function AccountBlock({ user, initials, onSignOut }) {
  return (
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
        onClick={onSignOut}
        className="w-full mt-1 text-left px-3 py-2 rounded-xl text-sm font-medium hover:bg-white/50 transition-colors"
        style={{ color: '#D70015' }}
      >
        Sign out
      </button>
    </div>
  )
}

export default function SidebarLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'ST'
  const handleSignOut = () => { logout(); navigate('/login') }

  return (
    // Pinned to the viewport — this element never scrolls, so the
    // background and sidebar stay put no matter how long a page's content is.
    <div className="h-screen relative flex overflow-hidden">
      <div className="liquid-bg" />

      {/* Desktop sidebar — unchanged, permanent, md and above only */}
      <aside className="w-64 shrink-0 p-4 hidden md:block h-screen">
        <div className="glass-panel h-[calc(100vh-2rem)] p-4 flex flex-col">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-6 shrink-0">
            <div className="w-9 h-9 rounded-[11px] glass-panel-strong flex items-center justify-center shrink-0">
              <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>TW</span>
            </div>
            <span className="font-semibold tracking-tight">TrueWatch</span>
          </div>
          <NavItems />
          <AccountBlock user={user} initials={initials} onSignOut={handleSignOut} />
        </div>
      </aside>

      {/* Mobile top bar — only rendered below md. Hamburger opens the drawer. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 glass-panel-strong rounded-none">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] glass-panel-strong flex items-center justify-center shrink-0">
            <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>TW</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">TrueWatch</span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/50 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer — slides in from the left, dismissible via backdrop tap */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[80vw] h-full p-4 animate-in slide-in-from-left">
            <div className="glass-panel-strong h-full p-4 flex flex-col">
              <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-[11px] glass-panel-strong flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>TW</span>
                  </div>
                  <span className="font-semibold tracking-tight">TrueWatch</span>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/50 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <NavItems onNavigate={() => setDrawerOpen(false)} />
              <AccountBlock user={user} initials={initials} onSignOut={handleSignOut} />
            </div>
          </div>
        </div>
      )}

      {/* Main content — the only scrollable region on the page.
          pt-16 on mobile clears the fixed top bar; md:pt-6 restores the
          original desktop spacing since the top bar doesn't exist there. */}
      <main className="flex-1 min-w-0 h-screen overflow-y-auto p-4 pt-20 md:p-6 pb-10">
        {children}
      </main>
    </div>
  )
}