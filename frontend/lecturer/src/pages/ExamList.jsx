import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

export default function ExamList() {
  const [exams,   setExams]   = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    API.get('/exams')
      .then(res => setExams(res.data.exams))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const statusBadge = s => {
    const map = { active:'badge-green', completed:'badge-blue', draft:'badge-gray', archived:'badge-gray' }
    return <span className={map[s] || 'badge-gray'}>{s}</span>
  }

  const updateStatus = async (examId, status) => {
    try {
      await API.put(`/exams/${examId}`, { status })
      setExams(prev => prev.map(e => e.id === examId ? {...e, status} : e))
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">My exams</h1>
            <p className="text-slate-500 mt-1">{exams.length} exam{exams.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => navigate('/exams/create')} className="btn-primary">
            + Create exam
          </button>
        </div>

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : exams.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-medium text-slate-600 mb-3">No exams yet</p>
              <button onClick={() => navigate('/exams/create')} className="btn-primary mx-auto">
                Create your first exam
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Title', 'Scheduled', 'Duration', 'Students', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exams.map(e => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800 text-sm">{e.title}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500">
                      {e.start_time ? new Date(e.start_time).toLocaleString() : 'TBA'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500">{e.duration_mins}m</td>
                    <td className="px-5 py-4 text-sm text-slate-500">{e.student_count}</td>
                    <td className="px-5 py-4">{statusBadge(e.status)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => navigate(`/exams/${e.id}/edit`)}
                          className="text-xs text-primary hover:underline font-medium">Edit</button>
                        {e.status === 'draft' && (
                          <button onClick={() => updateStatus(e.id, 'active')}
                            className="text-xs text-green-600 hover:underline font-medium">Publish</button>
                        )}
                        {e.status === 'active' && (
                          <button onClick={() => updateStatus(e.id, 'completed')}
                            className="text-xs text-slate-400 hover:underline">End</button>
                        )}
                      </div>
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