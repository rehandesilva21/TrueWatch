import { useState } from 'react'
import SidebarLayout from '../components/SidebarLayout'

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

  const rows = [
    { label: 'Exam notifications', desc: 'Get notified before your exams start', value: notifications, set: setNotifications },
    { label: 'Sound alerts',       desc: 'Play a sound for proctoring warnings', value: soundAlerts,   set: setSoundAlerts },
  ]

  return (
    <SidebarLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-[28px] font-semibold tracking-tight mb-7">Settings</h1>

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