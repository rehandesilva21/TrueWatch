import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

export default function Sessions() {
  const [sessions, setSessions] = useState([])
  const [exams,    setExams]    = useState([])
  const [examFilter, setExamFilter] = useState('')
  const [loading,  setLoading]  = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetch = async () => {
      try {
        const [sRes, eRes] = await Promise.all([
          API.get('/lecturer/sessions'),
          API.get('/exams'),
        ])
        setSessions(sRes.data.sessions)
        setExams(eRes.data.exams)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

  const filtered = examFilter
    ? sessions.filter(s => s.exam_id === parseInt(examFilter))
    : sessions

  const riskColor = r =>
    r >= 60 ? 'text-red-600' : r >= 30 ? 'text-amber-600' : 'text-green-600'

  const resultBadge = r => {
    const map = { flagged:'badge-red', pass:'badge-green', pending:'badge-amber', fail:'badge-red' }
    return <span className={map[r] || 'badge-gray'}>{r}</span>
  }

  const plagBadge = r => {
    if (!r) return <span className="text-slate-400 text-xs">—</span>
    const map = { LOW:'badge-green', MEDIUM:'badge-amber', HIGH:'badge-red', CRITICAL:'badge-red' }
    return <span className={map[r] || 'badge-gray'}>{r}</span>
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Sessions</h1>
            <p className="text-slate-500 mt-1">{filtered.length} session{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <select
            className="input w-auto"
            value={examFilter}
            onChange={e => setExamFilter(e.target.value)}
          >
            <option value="">All exams</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <p>No sessions found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Student', 'Exam', 'Started', 'Risk', 'Answers', 'Plagiarism', 'Grade', 'Result', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-slate-800">{s.student_name}</p>
                      <p className="text-xs text-slate-400">{s.student_email}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{s.exam_title}</td>
                    <td className="px-5 py-4 text-sm text-slate-500">
                      {s.started_at ? new Date(s.started_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`font-bold text-sm ${riskColor(s.risk_score)}`}>
                        {s.risk_score}/100
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {s.auto_score != null
                        ? <span className="text-sm font-semibold text-slate-700">{s.auto_score}/100</span>
                        : <span className="text-slate-400 text-xs">No MCQ</span>
                      }
                    </td>
                    <td className="px-5 py-4">
                      {s.originality != null
                        ? <div>
                            {plagBadge(s.plag_risk)}
                            <p className="text-xs text-slate-400 mt-0.5">{s.originality}% original</p>
                          </div>
                        : <span className="text-slate-400 text-xs">No upload</span>
                      }
                    </td>
                    <td className="px-5 py-4">
                      {s.grade != null
                        ? <span className="text-lg font-bold text-primary">{s.grade}/100</span>
                        : <span className="text-slate-400 text-xs">Not graded</span>
                      }
                    </td>
                    <td className="px-5 py-4">{resultBadge(s.result)}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => navigate(`/sessions/${s.id}`)}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  )
}