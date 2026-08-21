import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SidebarLayout from '../components/SidebarLayout'
import API from '../api'

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-11 h-6 rounded-full relative transition-colors shrink-0"
      style={{ background: checked ? 'var(--accent)' : 'rgba(0,0,0,0.15)' }}
    >
      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
           style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }} />
    </button>
  )
}

export default function Settings() {
  const [notifications, setNotifications] = useState(true)
  const [soundAlerts,   setSoundAlerts]   = useState(true)
  const [identityRegistered, setIdentityRegistered] = useState(null) // null = checking
  const navigate = useNavigate()

  useEffect(() => {
    API.get('/identity/status')
      .then(res => setIdentityRegistered(res.data.registered))
      .catch(() => setIdentityRegistered(null))
  }, [])

  const rows = [
    { label: 'Exam notifications', desc: 'Get notified before your exams start', value: notifications, set: setNotifications },
    { label: 'Sound alerts',       desc: 'Play a sound for proctoring warnings', value: soundAlerts,   set: setSoundAlerts },
  ]

  return (
    <SidebarLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-[28px] font-semibold tracking-tight mb-7">Settings</h1>

        <div className="glass-panel overflow-hidden mb-5">
          <div className="px-5 py-4 flex flex-wrap gap-3 items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Identity verification</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {identityRegistered === null
                  ? 'Checking...'
                  : identityRegistered
                    ? 'Your reference photo is on file — used to confirm it’s you during exams.'
                    : 'Not verified yet — required before you can start an exam.'}
              </p>
            </div>
            {identityRegistered !== null && (
              <button
                onClick={() => navigate('/register-face')}
                className={`shrink-0 ${identityRegistered ? 'text-xs font-medium px-3 py-1.5 rounded-full' : 'text-xs font-semibold px-3 py-1.5 rounded-full'}`}
                style={identityRegistered
                  ? { background: 'rgba(0,0,0,0.06)', color: 'var(--ink-soft)' }
                  : { background: '#B25000', color: 'white' }}
              >
                {identityRegistered ? 'Re-verify' : 'Verify now'}
              </button>
            )}
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.label} className="px-5 py-4 flex items-center justify-between"
                 style={{ borderBottom: i < rows.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
              <div>
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>{r.desc}</p>
              </div>
              <Toggle checked={r.value} onChange={r.set} />
            </div>
          ))}
        </div>
      </div>
    </SidebarLayout>
  )
}