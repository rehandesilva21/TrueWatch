import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/',        label: 'Dashboard' },
  { to: '/users',   label: 'Users'     },
  { to: '/batches', label: 'Batches'   },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'AD'

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <div className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">TW</span>
            </div>
            <span className="text-base font-bold text-slate-800">TrueWatch</span>
            <span className="badge-purple text-xs">Admin</span>
          </div>
          <nav className="flex items-center gap-1">
            {nav.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-primary font-medium'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
            <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
              {initials}
            </div>
            <span className="text-sm text-slate-600 font-medium">{user?.name}</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-slate-600 text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
      {/* Page content */}
      <main>{children}</main>
    </div>
  )
}
