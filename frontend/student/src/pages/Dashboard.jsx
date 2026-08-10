import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SidebarLayout from '../components/SidebarLayout'
import API from '../api'

const gradeColor = g => (g >= 80 ? '#34C759' : g >= 50 ? '#FF9F0A' : '#FF3B30')

function relativeStart(start_time) {
  if (!start_time) return null
  const diffMs = new Date(start_time).getTime() - Date.now()
  if (diffMs <= 0) return null
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.round(hrs / 24)}d`
}

/* Small inline sparkline for the grade trend — no chart lib needed */
function Sparkline({ values, width = 96, height = 32 }) {
  if (values.length < 2) return null
  const max = 100, min = 0
  const stepX = width / (values.length - 1)
  const toY = v => height - ((v - min) / (max - min)) * height
  const points = values.map((v, i) => [i * stepX, toY(v)])
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === points.length - 1 ? 3 : 2} fill="var(--accent)" opacity={i === points.length - 1 ? 1 : 0.5} />
      ))}
    </svg>
  )
}

export default function Dashboard() {
  const { user }   = useAuth()
  const [exams,    setExams]    = useState([])
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [identityRegistered, setIdentityRegistered] = useState(null) // null = still checking
  const navigate = useNavigate()
  const location = useLocation()
  const [notice, setNotice] = useState(
    location.state?.examBlockedMessage
      ? { type: 'warning', text: location.state.examBlockedMessage }
      : location.state?.examSubmitted
        ? { type: 'success', text: 'Your exam was submitted successfully.' }
        : null
  )

  useEffect(() => {
    // Soft nudge only — this never blocks anything here, it's just a
    // reminder shown until they register. The actual enforcement (exam
    // won't start without it) lives in ExamRoom.jsx.
    API.get('/identity/status')
      .then(res => setIdentityRegistered(res.data.registered))
      .catch(() => setIdentityRegistered(null))
  }, [])

  useEffect(() => {
    // Clear the router state so a page refresh doesn't re-show the banner
    if (location.state?.examBlockedMessage || location.state?.examSubmitted) {
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [])

  useEffect(() => {
    Promise.all([
      API.get('/exams'),
      API.get('/student/results').catch(() => ({ data: { results: [] } })),
    ]).then(([e, r]) => {
      setExams(e.data.exams)
      setResults(r.data.results)
    }).finally(() => setLoading(false))
  }, [])

  // exam_ids the student has already submitted — one attempt per exam, so
  // these must not be re-enterable even if the exam is still "active".
  const submittedExamIds = new Set(results.filter(r => r.completed).map(r => r.exam_id))
  const upcoming = exams.filter(e => e.status === 'active' && !submittedExamIds.has(e.id))
  const graded   = results.filter(r => r.grade != null)

  const avgGrade = useMemo(
    () => (graded.length ? Math.round(graded.reduce((a, r) => a + r.grade, 0) / graded.length) : null),
    [graded]
  )

  const gradeTrend = useMemo(
    () => graded.slice(0, 8).map(r => r.grade).reverse(),
    [graded]
  )

  const statusPill = status => {
    const map = {
      active:    { bg: 'rgba(52,199,89,0.15)', color: '#248A3D', label: 'Live now' },
      draft:     { bg: 'rgba(0,0,0,0.06)',     color: 'var(--ink-soft)', label: 'Not yet open' },
      completed: { bg: 'rgba(10,132,255,0.12)',color: 'var(--accent-deep)', label: 'Completed' },
    }
    const s = map[status] || map.draft
    return <span className="glass-pill" style={{ background: s.bg, color: s.color, border: 'none' }}>{s.label}</span>
  }

  if (loading) {
    return (
      <SidebarLayout>
        <div className="flex items-center justify-center h-96">
          <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      </SidebarLayout>
    )
  }

  return (
    <SidebarLayout>
      <div className="max-w-5xl mx-auto">
        {notice && (
          <div className="glass-panel p-4 mb-5 flex items-center justify-between"
               style={{ background: notice.type === 'success' ? 'rgba(52,199,89,0.1)' : 'rgba(255,159,10,0.12)' }}>
            <p className="text-sm font-medium flex items-center gap-2" style={{ color: notice.type === 'success' ? '#248A3D' : '#B25000' }}>
              <span>{notice.type === 'success' ? '✓' : '⚠'}</span>
              {notice.text}
            </p>
            <button onClick={() => setNotice(null)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--ink-soft)' }}>Dismiss</button>
          </div>
        )}
        {identityRegistered === false && (
          <div className="glass-panel p-4 mb-5 flex items-center justify-between" style={{ background: 'rgba(255,159,10,0.12)' }}>
            <p className="text-sm font-medium flex items-center gap-2" style={{ color: '#B25000' }}>
              <span>⚠</span>
              Verify your identity before your first exam — takes about 30 seconds.
            </p>
            <button onClick={() => navigate('/register-face')} className="text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ background: '#B25000', color: 'white' }}>
              Verify now
            </button>
          </div>
        )}
        <div className="mb-7">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Hey, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-soft)' }}>
            Here’s what’s happening with your exams.
          </p>
        </div>

        {/* Stat cards */}
        <div className={`grid gap-4 mb-7 ${avgGrade != null ? 'grid-cols-4' : 'grid-cols-3'}`}>
          {[
            { label: 'Live now',        value: upcoming.length, accent: '#34C759' },
            { label: 'Total exams',     value: exams.length,    accent: 'var(--accent)' },
            { label: 'Grades released', value: graded.length,   accent: '#AF52DE' },
            ...(avgGrade != null ? [{ label: 'Average grade', value: `${avgGrade}`, accent: gradeColor(avgGrade) }] : []),
          ].map(s => (
            <div key={s.label} className="glass-panel p-5 transition-transform hover:-translate-y-0.5">
              <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--ink-soft)' }}>{s.label}</p>
              <p className="text-3xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Live exam banner */}
        {upcoming.length > 0 && (
          <div className="glass-panel p-5 mb-6 flex items-center justify-between" style={{ background: 'rgba(52,199,89,0.08)' }}>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#34C759' }} />
              <div>
                <p className="font-medium text-sm">{upcoming[0].title} is live</p>
                <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>{upcoming[0].duration_mins} minutes</p>
              </div>
            </div>
            <button onClick={() => navigate(`/exam/${upcoming[0].id}`)} className="glass-btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>
              Enter exam
            </button>
          </div>
        )}

        {/* Exams list */}
        <div className="glass-panel overflow-hidden mb-6">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <h2 className="font-semibold text-[15px]">My exams</h2>
            {exams.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>{exams.length} total</span>
            )}
          </div>
          {exams.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'var(--ink-soft)' }}>
              <p className="text-sm">No exams enrolled yet.</p>
            </div>
          ) : (
            <div>
              {exams.map((e, i) => {
                const relStart = e.status === 'draft' ? relativeStart(e.start_time) : null
                return (
                  <div key={e.id}
                       className="px-5 py-4 flex items-center justify-between transition-colors hover:bg-black/[0.02]"
                       style={{ borderBottom: i < exams.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                    <div>
                      <p className="font-medium text-sm">{e.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                        {e.start_time ? new Date(e.start_time).toLocaleString() : 'Schedule TBA'} · {e.duration_mins} min
                        {relStart && <span style={{ color: 'var(--accent-deep)' }}> · opens {relStart}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {submittedExamIds.has(e.id) ? (
                        <span className="glass-pill" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--ink-soft)', border: 'none' }}>
                          ✓ Submitted
                        </span>
                      ) : (
                        statusPill(e.status)
                      )}
                      {e.status === 'active' && !submittedExamIds.has(e.id) && (
                        <button onClick={() => navigate(`/exam/${e.id}`)} className="glass-btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
                          Enter →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent grades */}
        {graded.length > 0 && (
          <div className="glass-panel overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <h2 className="font-semibold text-[15px]">Recent grades</h2>
              {gradeTrend.length >= 2 && <Sparkline values={gradeTrend} />}
            </div>
            {graded.slice(0, 3).map((r, i) => (
              <div key={i} className="px-5 py-4 flex items-center justify-between transition-colors hover:bg-black/[0.02]"
                   style={{ borderBottom: i < 2 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                <p className="font-medium text-sm">{r.exam_title}</p>
                <span className="text-lg font-semibold" style={{ color: gradeColor(r.grade) }}>{r.grade}/100</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SidebarLayout>
  )
}