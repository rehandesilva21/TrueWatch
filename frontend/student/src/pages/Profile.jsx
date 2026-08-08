import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import SidebarLayout from '../components/SidebarLayout'
import API from '../api'

export default function Profile() {
  const { user } = useAuth()
  const [faceRegistered, setFaceRegistered] = useState(null)

  useEffect(() => {
    API.get('/identity/status').then(res => setFaceRegistered(res.data.registered)).catch(() => {})
  }, [])

  const initials = user?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'ST'

  return (
    <SidebarLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-[28px] font-semibold tracking-tight mb-7">Profile</h1>

        <div className="glass-panel p-6 mb-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-semibold shrink-0" style={{ background: 'var(--accent)' }}>
            {initials}
          </div>
          <div>
            <p className="font-semibold text-lg">{user?.name}</p>
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>{user?.email}</p>
          </div>
        </div>

        <div className="glass-panel overflow-hidden mb-5">
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <h2 className="font-semibold text-[15px]">Identity verification</h2>
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {faceRegistered === null ? 'Checking\u2026' : faceRegistered ? 'Face registered' : 'Not registered'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                Used to confirm it\u2019s you during exams
              </p>
            </div>
            <span className="glass-pill" style={{
              background: faceRegistered ? 'rgba(52,199,89,0.15)' : 'rgba(255,159,10,0.15)',
              color: faceRegistered ? '#248A3D' : '#B25000', border: 'none'
            }}>
              {faceRegistered ? 'Active' : 'Setup needed'}
            </span>
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <h2 className="font-semibold text-[15px]">Account details</h2>
          </div>
          {[
            ['Full name', user?.name],
            ['Email', user?.email],
            ['Role', user?.role],
          ].map(([label, value], i) => (
            <div key={label} className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: i < 2 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
              <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>{label}</span>
              <span className="text-sm font-medium capitalize">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </SidebarLayout>
  )
}