import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Minimal stroke-based icons (no icon library dependency) — each is a
// small inline SVG sized to match the 18px nav row height.
const Icon = {
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.4"/>
      <rect x="11" y="2.5" width="6.5" height="4.5" rx="1.4"/>
      <rect x="11" y="9" width="6.5" height="8.5" rx="1.4"/>
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.4"/>
    </svg>
  ),
  live: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="2.6"/>
      <path d="M5.5 5.5a6.5 6.5 0 0 0 0 9M14.5 5.5a6.5 6.5 0 0 1 0 9" strokeLinecap="round"/>
      <path d="M3 3a10 10 0 0 0 0 14M17 3a10 10 0 0 1 0 14" strokeLinecap="round" opacity=".5"/>
    </svg>
  ),
  sessions: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 3.5h9L16 6.5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" strokeLinejoin="round"/>
      <path d="M7 9h6M7 12h6M7 15h3.5" strokeLinecap="round"/>
    </svg>
  ),
  exams: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="2.5" width="14" height="15" rx="1.4"/>
      <path d="M6.5 6.5h7M6.5 10h7M6.5 13.5h4.5" strokeLinecap="round"/>
    </svg>
  ),
  results: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 16.5V11M10 16.5V6M16 16.5v-7.5" strokeLinecap="round"/>
      <path d="M3 16.5h14" strokeLinecap="round"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7.2" cy="6.5" r="2.7"/>
      <path d="M2.3 16.2c.7-2.8 2.6-4.3 4.9-4.3s4.2 1.5 4.9 4.3" strokeLinecap="round"/>
      <circle cx="14.3" cy="6" r="2.1"/>
      <path d="M13 11.9c1.9.2 3.3 1.6 3.9 3.9" strokeLinecap="round"/>
    </svg>
  ),
  batches: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 2.5 17.5 6.5 10 10.5 2.5 6.5 10 2.5Z" strokeLinejoin="round"/>
      <path d="M2.5 10.5 10 14.5l7.5-4M2.5 14.5 10 18.5l7.5-4" strokeLinejoin="round"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 17H4.8A1.8 1.8 0 0 1 3 15.2V4.8A1.8 1.8 0 0 1 4.8 3H8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M13.5 14 17.5 10 13.5 6M7.5 10h10" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
}

const nav = [
  { to: '/',         label: 'Dashboard',    icon: Icon.dashboard },
  { to: '/live',     label: 'Live monitor', icon: Icon.live      },
  { to: '/sessions', label: 'Sessions',     icon: Icon.sessions  },
  { to: '/exams',    label: 'Exams',        icon: Icon.exams     },
  { to: '/results',  label: 'Results',      icon: Icon.results   },
]

const adminNav = [
  { to: '/users',   label: 'Users',   icon: Icon.users   },
  { to: '/batches', label: 'Batches', icon: Icon.batches },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate          = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }
  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'LT'
  const items = user?.role === 'admin' ? [...nav, ...adminNav] : nav

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex">

      {/* ── Sidebar ────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-slate-200/80 bg-white">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-100">
          <div className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center">
            <span className="text-white text-[11px] font-bold">TW</span>
          </div>
          <span className="text-[15px] font-semibold text-slate-900 tracking-tight">TrueWatch</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {items.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <span className="w-[18px] h-[18px] shrink-0">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 shrink-0 rounded-full bg-slate-900 flex items-center justify-center text-white text-[11px] font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-slate-800 truncate">{user?.name}</p>
              <p className="text-[11px] text-slate-400 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <span className="w-4 h-4 block">{Icon.logout}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Page content ───────────────────────────────────── */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
