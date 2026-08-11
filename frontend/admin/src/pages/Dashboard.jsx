import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import API from '../api'

const RISK_BUCKETS = [
  { label: '0–20',   min: 0,  max: 20,  color: '#16a34a' },
  { label: '20–40',  min: 20, max: 40,  color: '#65a30d' },
  { label: '40–60',  min: 40, max: 60,  color: '#d97706' },
  { label: '60–80',  min: 60, max: 80,  color: '#ea580c' },
  { label: '80–100', min: 80, max: 101, color: '#dc2626' },
]

const RESULT_COLORS = {
  pass:    '#16a34a',
  flagged: '#dc2626',
  pending: '#d97706',
  fail:    '#991b1b',
}

function formatDay(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Builds the last N days as YYYY-MM-DD keys, oldest first, so the trend
// chart always shows a full window even for days with zero sessions —
// otherwise a quiet day would just be missing from the x-axis instead of
// showing as a real zero.
function lastNDayKeys(n) {
  const days = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d)
  }
  return days
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [stats,        setStats]        = useState(null)
  const [allSessions,  setAllSessions]  = useState([])
  const [batches,      setBatches]      = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, sessionRes, batchRes] = await Promise.all([
          API.get('/admin/stats'),
          API.get('/lecturer/sessions'),
          API.get('/batches'),
        ])
        setStats(statsRes.data)
        setAllSessions(sessionRes.data.sessions || [])
        setBatches(batchRes.data.batches || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const trendData = useMemo(() => {
    const days = lastNDayKeys(14)
    const counts = {}
    for (const s of allSessions) {
      if (!s.started_at) continue
      const key = s.started_at.slice(0, 10)
      counts[key] = (counts[key] || 0) + 1
    }
    return days.map(d => {
      const key = d.toISOString().slice(0, 10)
      return { date: formatDay(d), sessions: counts[key] || 0 }
    })
  }, [allSessions])

  const riskData = useMemo(() => {
    return RISK_BUCKETS.map(b => ({
      ...b,
      count: allSessions.filter(s => s.risk_score >= b.min && s.risk_score < b.max).length,
    }))
  }, [allSessions])

  const resultData = useMemo(() => {
    const counts = {}
    for (const s of allSessions) counts[s.result] = (counts[s.result] || 0) + 1
    return Object.entries(counts).map(([result, count]) => ({
      name: result, value: count, color: RESULT_COLORS[result] || '#94a3b8',
    }))
  }, [allSessions])

  const sessions = allSessions.slice(0, 6)

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
              { label: 'Sessions',  value: stats.total_sessions,   color: 'text-slate-800', to: '/sessions'           },
              { label: 'Flagged',   value: stats.flagged_sessions, color: 'text-red-600',   to: '/sessions'           },
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

        {/* Charts — sessions trend + result breakdown */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div className="card p-5 col-span-2">
            <h2 className="font-semibold text-slate-800 text-sm mb-1">Sessions, last 14 days</h2>
            <p className="text-xs text-slate-400 mb-4">Proctoring sessions started per day, across every exam</p>
            {allSessions.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-slate-400">No sessions yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sessionsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25}/>
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28}/>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
                  <Area type="monotone" dataKey="sessions" stroke="#2563eb" strokeWidth={2} fill="url(#sessionsFill)"/>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-1">Result breakdown</h2>
            <p className="text-xs text-slate-400 mb-2">All sessions, all time</p>
            {resultData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-slate-400">No data yet</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={resultData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {resultData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1 justify-center">
                  {resultData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-slate-500 capitalize">
                      <span className="w-2 h-2 rounded-full" style={{ background: d.color }}/>
                      {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Chart — risk distribution */}
        <div className="card p-5 mb-8">
          <h2 className="font-semibold text-slate-800 text-sm mb-1">Risk score distribution</h2>
          <p className="text-xs text-slate-400 mb-4">How many sessions fall into each risk band</p>
          {allSessions.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-slate-400">No sessions yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={riskData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28}/>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}/>
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {riskData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">

          {/* Recent sessions */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-800">Recent sessions</h2>
                <p className="text-xs text-slate-400 mt-0.5">Across every lecturer's exams</p>
              </div>
              <button onClick={() => navigate('/sessions')} className="text-xs text-primary hover:underline shrink-0">
                View all
              </button>
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