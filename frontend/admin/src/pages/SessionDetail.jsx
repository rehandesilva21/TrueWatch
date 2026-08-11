import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

const INCIDENT_STYLES = {
  MULTI_FACE:    { badge: 'bg-red-100 text-red-700',       bar: 'bg-red-500' },
  TAB_SWITCH:    { badge: 'bg-red-100 text-red-700',       bar: 'bg-red-500' },
  AUDIO_WHISPER: { badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  LIP:           { badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  GAZE:          { badge: 'bg-amber-100 text-amber-700',   bar: 'bg-amber-500' },
  HEAD:          { badge: 'bg-amber-100 text-amber-700',   bar: 'bg-amber-500' },
  ABSENT:        { badge: 'bg-amber-100 text-amber-700',   bar: 'bg-amber-500' },
  AUDIO_SPEECH:  { badge: 'bg-blue-100 text-blue-700',     bar: 'bg-blue-500' },
  AUDIO_PAPER:   { badge: 'bg-blue-100 text-blue-700',     bar: 'bg-blue-500' },
}

const incidentColor  = type => INCIDENT_STYLES[type]?.badge || 'bg-slate-100 text-slate-600'
const incidentBarColor = type => INCIDENT_STYLES[type]?.bar   || 'bg-slate-400'

export default function SessionDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const [data,     setData]     = useState(null)
  const [grade,    setGrade]    = useState('')
  const [feedback, setFeedback] = useState('')
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    API.get(`/lecturer/session/${id}`)
      .then(res => {
        setData(res.data)
        if (res.data.grade) {
          setGrade(res.data.grade.grade)
          setFeedback(res.data.grade.feedback || '')
          setSent(true)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const handleSendGrade = async () => {
    if (!grade) return
    setSending(true)
    try {
      await API.post('/lecturer/grade', {
        session_id: parseInt(id),
        grade:      parseInt(grade),
        feedback,
      })
      setSent(true)
    } catch (err) {
      console.error(err)
    } finally {
      setSending(false)
    }
  }

  const handleDownloadDoc = async () => {
    try {
      const res = await API.get(`/plagiarism/download/${id}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = data?.plagiarism_reports?.[0]?.file_name || 'document'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Could not download document')
    }
  }

  const incidentBreakdown = useMemo(() => {
    if (!data?.session?.incident_summary) return []
    const entries = Object.entries(data.session.incident_summary)
    const max = Math.max(...entries.map(([, c]) => c), 1)
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count, pct: Math.round((count / max) * 100) }))
  }, [data])

  if (loading) return (
    <Layout>
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
      </div>
    </Layout>
  )

  if (!data) return <Layout><div className="p-8 text-center text-slate-400">Session not found</div></Layout>

  const { session, student, exam, incidents, plagiarism_reports, answers } = data
  const plag = plagiarism_reports?.[0]

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-8 py-10">

        {/* Back */}
        <button onClick={() => navigate('/sessions')}
          className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-6 transition-colors">
          ← Back to sessions
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">{student.name}</h1>
            <p className="text-slate-500 mt-1">{exam.title}</p>
          </div>
          <div className="flex items-center gap-3">
            {session.auto_score != null && (
              <div className="text-2xl font-bold text-primary">
                Score: {session.auto_score}/100
              </div>
            )}
            <div className={`text-2xl font-bold ${session.risk_score >= 60 ? 'text-red-600' : session.risk_score >= 30 ? 'text-amber-600' : 'text-green-600'}`}>
              Risk: {session.risk_score}/100
            </div>
            <span className={session.result === 'flagged' ? 'badge-red' : session.result === 'pass' ? 'badge-green' : 'badge-amber'}>
              {session.result}
            </span>
          </div>
        </div>

        {/* AI Summary */}
        {session.ai_summary && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <p className="text-xs font-semibold text-blue-600 mb-1 uppercase tracking-wide">AI Summary</p>
            <p className="text-sm text-blue-800">{session.ai_summary}</p>
          </div>
        )}

        {/* Incident timeline — graph + detail, right after AI summary */}
        <div className="card mb-6">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">
              Incident timeline
              <span className="ml-2 text-slate-400 font-normal text-sm">({incidents.length})</span>
            </h2>
          </div>

          {incidents.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">No incidents recorded</p>
          ) : (
            <div className="grid grid-cols-5 divide-x divide-slate-100">

              {/* Graph */}
              <div className="col-span-2 p-5">
                <p className="text-[11px] font-semibold text-slate-400 mb-3 uppercase tracking-wide">By type</p>
                <div className="space-y-2.5">
                  {incidentBreakdown.map(({ type, count, pct }) => (
                    <div key={type}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-600">{type.replace('_', ' ')}</span>
                        <span className="text-xs font-bold text-slate-700">{count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${incidentBarColor(type)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed view */}
              <div className="col-span-3">
                <p className="text-[11px] font-semibold text-slate-400 px-5 pt-5 mb-2 uppercase tracking-wide">Detail</p>
                <div className="max-h-72 overflow-y-auto px-5 pb-5">
                  <div className="space-y-2">
                    {incidents.map(inc => (
                      <div key={inc.id} className="flex items-start gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${incidentColor(inc.type)}`}>
                          {inc.type.replace('_', ' ')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-500 truncate">{inc.details}</p>
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {inc.elapsed_secs}s
                        </span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {Math.round(inc.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-6">

          {/* Left column */}
          <div className="col-span-2 space-y-6">

            {/* Student answers — only scrollable panel */}
            {answers && answers.length > 0 && (
              <div className="card">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white rounded-t-xl z-10">
                  <h2 className="font-semibold text-slate-800">
                    Answers
                    <span className="ml-2 text-slate-400 font-normal text-sm">({answers.length} answered)</span>
                  </h2>
                  {session.auto_score != null && (
                    <span className="badge-blue text-xs">Auto-graded: {session.auto_score}/100</span>
                  )}
                </div>
                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                  {answers.map((a, i) => (
                    <div key={a.id} className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm font-medium text-slate-800">
                          {i + 1}. {a.question_text}
                        </p>
                        {a.question_type === 'mcq' && (
                          <span className={a.is_correct ? 'badge-green text-xs shrink-0' : 'badge-red text-xs shrink-0'}>
                            {a.is_correct ? '✓ Correct' : '✗ Incorrect'}
                          </span>
                        )}
                        {a.question_type === 'essay' && (
                          <span className="badge-gray text-xs shrink-0">Manual grading</span>
                        )}
                      </div>

                      {a.question_type === 'mcq' ? (
                        <div className="space-y-1">
                          {(a.options || []).map((opt, idx) => (
                            <div key={idx}
                              className={`text-xs px-3 py-1.5 rounded-md flex items-center justify-between ${
                                idx === a.correct_answer
                                  ? 'bg-green-50 text-green-700'
                                  : idx === a.selected_option
                                    ? 'bg-red-50 text-red-700'
                                    : 'text-slate-500'
                              }`}>
                              <span>{opt}</span>
                              <span className="flex gap-1.5">
                                {idx === a.selected_option && <span className="font-medium">Student's answer</span>}
                                {idx === a.correct_answer && <span className="font-medium">Correct</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">
                          {a.answer_text || '—'}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {a.marks_awarded}/{a.marks} marks
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plagiarism report */}
            {plag && (
              <div className="card">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800">Plagiarism report</h2>
                  <button onClick={handleDownloadDoc} className="btn-outline text-xs">
                    ↓ Download document
                  </button>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-4 bg-slate-50 rounded-lg">
                      <p className="text-3xl font-bold text-primary">{plag.originality_score}%</p>
                      <p className="text-xs text-slate-400 mt-1">Originality</p>
                    </div>
                    <div className="text-center p-4 bg-slate-50 rounded-lg">
                      <p className={`text-lg font-bold ${plag.risk_level === 'LOW' ? 'text-green-600' : plag.risk_level === 'MEDIUM' ? 'text-amber-600' : 'text-red-600'}`}>
                        {plag.risk_level}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Risk level</p>
                    </div>
                    <div className="text-center p-4 bg-slate-50 rounded-lg">
                      <p className="text-lg font-bold text-slate-800">{plag.file_name?.slice(0, 12)}...</p>
                      <p className="text-xs text-slate-400 mt-1">File</p>
                    </div>
                  </div>
                  {plag.summary && (
                    <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{plag.summary}</p>
                  )}
                  {plag.semantic_matches?.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                        Suspicious passages
                      </p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {plag.semantic_matches.slice(0, 5).map((m, i) => (
                          <div key={i} className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-red-600">Match: {Math.round(m.similarity * 100)}%</span>
                              <span className="text-red-400">{m.source}</span>
                            </div>
                            <p className="text-red-700 line-clamp-2">{m.query_chunk}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">

            {/* Student info */}
            <div className="card p-4">
              <h3 className="font-semibold text-slate-700 mb-3 text-sm">Student</h3>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-semibold">
                  {student.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <p className="font-medium text-slate-800 text-sm">{student.name}</p>
                  <p className="text-xs text-slate-400">{student.email}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Started</span>
                  <span className="font-medium text-slate-700">
                    {session.started_at ? new Date(session.started_at).toLocaleTimeString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Ended</span>
                  <span className="font-medium text-slate-700">
                    {session.ended_at ? new Date(session.ended_at).toLocaleTimeString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Total incidents</span>
                  <span className="font-medium text-slate-700">{session.total_incidents}</span>
                </div>
              </div>
            </div>

            {/* Grade input */}
            <div className="card p-4">
              <h3 className="font-semibold text-slate-700 mb-3 text-sm">
                {sent ? 'Grade sent ✓' : 'Send grade'}
              </h3>
              {sent && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{grade}/100</p>
                  <p className="text-xs text-green-500 mt-1">Grade sent to student</p>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Mark (out of 100)
                  </label>
                  <input
                    type="number" min="0" max="100"
                    className="input text-center text-lg font-bold"
                    placeholder="0–100"
                    value={grade}
                    onChange={e => setGrade(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Feedback (optional)
                  </label>
                  <textarea
                    className="input h-20 resize-none text-xs"
                    placeholder="Comments for the student..."
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleSendGrade}
                  disabled={sending || !grade}
                  className="w-full btn-primary justify-center disabled:opacity-50"
                >
                  {sending
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Sending...</>
                    : sent ? 'Update grade' : 'Send grade to student'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}