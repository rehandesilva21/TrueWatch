import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import API from '../api'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [stats,    setStats]    = useState(null)
  const [sessions, setSessions] = useState([])
  const [batches,  setBatches]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, sessionRes, batchRes] = await Promise.all([
          API.get('/admin/stats'),
          API.get('/lecturer/sessions'),
          API.get('/batches'),
        ])
        setStats(statsRes.data)
        setSessions(sessionRes.data.sessions.slice(0, 6))
        setBatches(batchRes.data.batches.slice(0, 6))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const resultBadge = r => {
    const map = { flagged:'badge-red', pass:'badge-green', pending:'badge-amber', fail:'badge-red' }
    return <span className={map[r] || 'badge-gray'}>{r}</span>
  }

  if (loading) return (
    <Layout>
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
      </div>
    </Layout>
  )

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Welcome back, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="text-slate-500 mt-1">System-wide overview across every lecturer, batch, and exam.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/batches')} className="btn-outline">+ New batch</button>
            <button onClick={() => navigate('/users')} className="btn-primary">+ New user</button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {[
              { label: 'Students',  value: stats.total_students,   color: 'text-slate-800', to: '/users?role=student'  },
              { label: 'Lecturers', value: stats.total_lecturers,  color: 'text-slate-800', to: '/users?role=lecturer' },
              { label: 'Batches',   value: stats.total_batches,    color: 'text-primary',   to: '/batches'             },
              { label: 'Exams',     value: stats.total_exams,      color: 'text-slate-800', to: null                  },
              { label: 'Sessions',  value: stats.total_sessions,   color: 'text-slate-800', to: null                  },
              { label: 'Flagged',   value: stats.flagged_sessions, color: 'text-red-600',   to: null                  },
            ].map(s => (
              <div key={s.label}
                onClick={() => s.to && navigate(s.to)}
                className={`card p-5 text-left ${s.to ? 'hover:border-primary/40 transition-colors cursor-pointer' : ''}`}>
                <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">{s.label}</p>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">

          {/* Recent sessions */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Recent sessions</h2>
              <p className="text-xs text-slate-400 mt-0.5">Across every lecturer's exams</p>
            </div>
            {sessions.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No sessions yet</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Student', 'Risk', 'Result'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id} className="border-b border-slate-50">
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">{s.student_name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-sm font-semibold ${s.risk_score > 50 ? 'text-red-600' : s.risk_score > 20 ? 'text-amber-600' : 'text-green-600'}`}>
                          {s.risk_score}/100
                        </span>
                      </td>
                      <td className="px-5 py-3">{resultBadge(s.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Batches summary */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Batches</h2>
              <button onClick={() => navigate('/batches')} className="text-xs text-primary hover:underline">
                Manage batches
              </button>
            </div>
            {batches.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <p className="text-sm">No batches yet.</p>
                <button onClick={() => navigate('/batches')} className="btn-primary mt-3 mx-auto text-xs">
                  Create first batch
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {batches.map(b => (
                  <button key={b.id} onClick={() => navigate('/batches')}
                    className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{b.name}</span>
                    <span className="badge-blue text-xs">{b.student_count} student{b.student_count !== 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
