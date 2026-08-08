import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Layout from '../components/Layout'
import API from '../api'

const RESULT_COLORS = {
  pass:    '#16a34a', // green-600
  flagged: '#dc2626', // red-600
  pending: '#d97706', // amber-600
  fail:    '#dc2626', // red-600
}

/* ---------- Doughnut chart (pure SVG, no deps) ---------- */
function Doughnut({ segments, size = 132, thickness = 16 }) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {total === 0 ? null : segments.map(s => {
          if (s.value === 0) return null
          const dash = (s.value / total) * c
          const circle = (
            <circle
              key={s.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          )
          offset += dash
          return circle
        })}
      </svg>
      <div className="space-y-2">
        {total === 0 && <p className="text-xs text-slate-400">No sessions yet</p>}
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-slate-500 capitalize">{s.label}</span>
            <span className="font-semibold text-slate-700">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Line/area chart (pure SVG, no deps) ---------- */
function TrendChart({ values, width = 320, height = 96 }) {
  if (!values || values.length < 2) {
    return <div className="h-24 flex items-center justify-center text-xs text-slate-400">Not enough data yet</div>
  }
  const max = Math.max(...values, 100)
  const min = 0
  const stepX = width / (values.length - 1)
  const toY = v => height - ((v - min) / (max - min || 1)) * height

  const points = values.map((v, i) => [i * stepX, toY(v)])
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#trendFill)" />
      <path d={linePath} fill="none" stroke="var(--color-primary, #6366f1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 3.5 : 2.5}
          fill="white" stroke="var(--color-primary, #6366f1)" strokeWidth="2" />
      ))}
    </svg>
  )
}

export default function Dashboard() {
  const { user }        = useAuth()
  const navigate         = useNavigate()
  const [stats,     setStats]      = useState(null)
  const [exams,     setExams]      = useState([])
  const [sessions,  setSessions]   = useState([])
  const [allSessions, setAllSessions] = useState([])
  const [loading,   setLoading]    = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const [examRes, sessionRes] = await Promise.all([
          API.get('/exams'),
          API.get('/lecturer/sessions'),
        ])
        const allSess = sessionRes.data.sessions

        setExams(examRes.data.exams.slice(0, 5))
        setSessions(allSess.slice(0, 5))
        setAllSessions(allSess)

        setStats({
          total_exams:    examRes.data.exams.length,
          total_sessions: allSess.length,
          flagged:        allSess.filter(x => x.result === 'flagged').length,
          avg_risk:       allSess.length
            ? Math.round(allSess.reduce((a, b) => a + (b.risk_score || 0), 0) / allSess.length)
            : 0,
        })
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

  const resultSegments = useMemo(() => {
    const counts = { pass: 0, flagged: 0, pending: 0, fail: 0 }
    allSessions.forEach(s => { if (counts[s.result] != null) counts[s.result]++ })
    return Object.entries(counts).map(([label, value]) => ({ label, value, color: RESULT_COLORS[label] }))
  }, [allSessions])

  const riskTrend = useMemo(() => {
    // oldest -> newest, most recent 12 sessions
    return allSessions.slice(0, 12).map(s => s.risk_score || 0).reverse()
  }, [allSessions])

  const statusBadge = s => {
    const map = { active:'badge-green', completed:'badge-blue', draft:'badge-gray', archived:'badge-gray' }
    return <span className={map[s] || 'badge-gray'}>{s}</span>
  }

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
      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">
              Welcome back, {user?.name?.split(' ')[0]}
            </h1>
            <p className="text-slate-500 text-sm mt-1">Here's your proctoring overview.</p>
          </div>
          <button
            onClick={() => navigate('/exams/create')}
            className="btn-primary"
          >
            + Create exam
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'My exams',       value: stats.total_exams,    color: 'text-primary'    },
              { label: 'Total sessions', value: stats.total_sessions, color: 'text-slate-800'  },
              { label: 'Flagged',        value: stats.flagged,        color: 'text-red-600'    },
              { label: 'Avg risk score', value: stats.avg_risk,       color: 'text-amber-600'  },
            ].map(s => (
              <div key={s.label} className="card p-5 hover:shadow-sm transition-shadow">
                <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">{s.label}</p>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-2 gap-6 mb-6">

          {/* Results breakdown — doughnut */}
          <div className="card p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-4">Results breakdown</h2>
            <Doughnut segments={resultSegments} />
          </div>

          {/* Risk trend — line/area */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-slate-800 text-sm">Risk score trend</h2>
              <span className="text-[11px] text-slate-400">last {riskTrend.length} sessions</span>
            </div>
            <div className="mt-3">
              <TrendChart values={riskTrend} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">

          {/* Recent exams */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Recent exams</h2>
              <button onClick={() => navigate('/exams')} className="text-xs text-primary hover:underline">
                View all
              </button>
            </div>
            {exams.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <p className="text-sm">No exams yet</p>
                <button onClick={() => navigate('/exams/create')} className="btn-primary mt-3 mx-auto text-xs">
                  Create first exam
                </button>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Title', 'Students', 'Status'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exams.map(e => (
                    <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/exams/${e.id}/edit`)}>
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">{e.title}</td>
                      <td className="px-5 py-3 text-sm text-slate-500">{e.student_count}</td>
                      <td className="px-5 py-3">{statusBadge(e.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent sessions */}
          <div className="card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Recent sessions</h2>
              <button onClick={() => navigate('/sessions')} className="text-xs text-primary hover:underline">
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
                    <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/sessions/${s.id}`)}>
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
        </div>
      </div>
    </Layout>
  )
}