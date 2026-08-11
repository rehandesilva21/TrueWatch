import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

export default function Results() {
  const [sessions, setSessions] = useState([])
  const [exams,    setExams]    = useState([])
  const [filter,   setFilter]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [rechecking, setRechecking] = useState(false)
  const [recheckMsg,  setRecheckMsg]  = useState('')
  const navigate = useNavigate()

  const downloadDoc = async (sessionId, fileName) => {
    try {
      const res = await API.get(`/plagiarism/download/${sessionId}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = fileName || 'document'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Could not download document')
    }
  }

  const loadSessions = () => {
    API.get('/lecturer/sessions')
      .then(res => setSessions(res.data.sessions))
      .catch(console.error)
  }

  useEffect(() => {
    Promise.all([API.get('/lecturer/sessions'), API.get('/exams')])
      .then(([sRes, eRes]) => {
        setSessions(sRes.data.sessions)
        setExams(eRes.data.exams)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter
    ? sessions.filter(s => s.exam_id === parseInt(filter))
    : sessions

  const ungraded = filtered.filter(s => s.grade == null && s.result !== 'pending')

  const recheckPlagiarism = async () => {
    if (!filter) return
    setRechecking(true)
    setRecheckMsg('')
    try {
      const res = await API.post(`/exams/${filter}/plagiarism/recheck`)
      const { updated, skipped } = res.data
      setRecheckMsg(
        skipped?.length > 0
          ? `Re-checked ${updated} submission${updated !== 1 ? 's' : ''}, ${skipped.length} skipped (file missing or unreadable).`
          : `Re-checked ${updated} submission${updated !== 1 ? 's' : ''} — scores updated below.`
      )
      loadSessions()
    } catch (err) {
      console.error(err)
      setRecheckMsg(err.response?.data?.error || 'Re-check failed')
    } finally {
      setRechecking(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Sessions</h1>
            <p className="text-slate-500 mt-1">
              Every proctoring session across every lecturer's exams.
              {ungraded.length > 0 && (
                <span className="text-amber-600 font-medium"> {ungraded.length} awaiting grade.</span>
              )}
            </p>
          </div>
          <select className="input w-auto" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All exams</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>

        {filter && (
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={recheckPlagiarism}
              disabled={rechecking}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {rechecking ? 'Re-checking...' : '↻ Re-check plagiarism for this exam'}
            </button>
            {recheckMsg && <p className="text-xs text-slate-500">{recheckMsg}</p>}
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">No submissions yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Student', 'Exam', 'Document', 'Originality', 'Risk', 'Grade', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-slate-800">{s.student_name}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500">{s.exam_title}</td>
                    <td className="px-5 py-4">
                      {s.file_name
                        ? <button
                            onClick={() => downloadDoc(s.id, s.file_name)}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <span className="text-slate-400">▤</span> {s.file_name.slice(0, 20)}
                          </button>
                        : <span className="text-slate-400 text-xs">No upload</span>
                      }
                    </td>
                    <td className="px-5 py-4">
                      {s.originality != null
                        ? <span className={`text-sm font-semibold ${s.originality > 80 ? 'text-green-600' : s.originality > 60 ? 'text-amber-600' : 'text-red-600'}`}>
                            {s.originality}%
                          </span>
                        : <span className="text-slate-400 text-xs">—</span>
                      }
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-semibold ${s.risk_score >= 60 ? 'text-red-600' : s.risk_score >= 30 ? 'text-amber-600' : 'text-green-600'}`}>
                        {s.risk_score}/100
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {s.grade != null
                        ? <span className="text-primary font-bold">{s.grade}/100</span>
                        : <span className="badge-amber text-xs">Pending</span>
                      }
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => navigate(`/sessions/${s.id}`)}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {s.grade != null ? 'View' : 'Grade →'}
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