import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import SidebarLayout from '../components/SidebarLayout'
import API from '../api'

const gradeColor = g => (g >= 80 ? '#34C759' : g >= 50 ? '#FF9F0A' : '#FF3B30')
const originalityColor = o => (o > 80 ? '#34C759' : o > 60 ? '#FF9F0A' : '#FF3B30')

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Results() {
  const { user }   = useAuth()
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    API.get('/student/results')
      .then(res => setResults(res.data.results || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [])

  const graded  = useMemo(() => results.filter(r => r.grade != null), [results])
  const pending = results.length - graded.length
  const avgGrade = useMemo(
    () => (graded.length ? Math.round(graded.reduce((a, r) => a + r.grade, 0) / graded.length) : null),
    [graded]
  )

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

        <div className="mb-7">
          <h1 className="text-[28px] font-semibold tracking-tight">My results</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-soft)' }}>
            Grades and feedback from your submitted exams.
          </p>
        </div>

        {results.length === 0 ? (
          <div className="glass-panel p-12 text-center">
            <div className="text-5xl mb-4">🎓</div>
            <h2 className="text-lg font-semibold">No results yet</h2>
            <p className="text-sm mt-2" style={{ color: 'var(--ink-soft)' }}>
              Your grades will appear here once your lecturer marks your work.
            </p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className={`grid gap-4 mb-6 ${avgGrade != null ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="glass-panel p-5">
                <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--ink-soft)' }}>Total submitted</p>
                <p className="text-3xl font-semibold" style={{ color: 'var(--accent)' }}>{results.length}</p>
              </div>
              <div className="glass-panel p-5">
                <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--ink-soft)' }}>
                  {pending > 0 ? 'Awaiting grading' : 'Released'}
                </p>
                <p className="text-3xl font-semibold" style={{ color: pending > 0 ? '#FF9F0A' : '#34C759' }}>
                  {pending > 0 ? pending : graded.length}
                </p>
              </div>
              {avgGrade != null && (
                <div className="glass-panel p-5">
                  <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--ink-soft)' }}>Average grade</p>
                  <p className="text-3xl font-semibold" style={{ color: gradeColor(avgGrade) }}>{avgGrade}</p>
                </div>
              )}
            </div>

            {/* Results table */}
            <div className="glass-panel overflow-hidden">
              <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <h2 className="font-semibold text-[15px]">Your grades</h2>
                <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>{results.length} exam{results.length !== 1 ? 's' : ''}</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    {['Exam', 'Submitted', 'Originality', 'Grade', 'Status'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--ink-soft)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="transition-colors hover:bg-black/[0.02]"
                      style={{ borderBottom: i < results.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                      <td className="px-5 py-4 font-medium text-sm">{r.exam_title}</td>
                      <td className="px-5 py-4 text-sm" style={{ color: 'var(--ink-soft)' }}>{formatDate(r.submitted_at)}</td>
                      <td className="px-5 py-4">
                        {r.originality != null ? (
                          <span className="glass-pill" style={{
                            background: `${originalityColor(r.originality)}22`,
                            color: originalityColor(r.originality),
                            border: 'none',
                          }}>
                            {r.originality}%
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.grade != null ? (
                          <span className="text-2xl font-bold" style={{ color: gradeColor(r.grade) }}>{r.grade}/100</span>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Pending</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span className="glass-pill" style={{
                          background: r.grade != null ? 'rgba(52,199,89,0.15)' : 'rgba(255,159,10,0.12)',
                          color: r.grade != null ? '#248A3D' : '#B25000',
                          border: 'none',
                        }}>
                          {r.grade != null ? '✓ Released' : 'Awaiting'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </SidebarLayout>
  )
}