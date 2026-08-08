import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

export default function CreateExam() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const isEdit    = !!id

  // NOTE: exam_type / assignment_type / question_type must stay lowercase
  // here — the backend's ExamType/AssignmentType Python enums are defined
  // with lowercase values ('mcq' | 'document', 'individual' | 'batch') and
  // do `ExamType(value)` on whatever the client sends. Sending 'MCQ' or
  // 'INDIVIDUAL' fails that lookup and the API returns 400.
  const [form, setForm] = useState({
    title: '', exam_type: 'mcq', assignment_type: 'individual', batch_id: null,
    description: '', duration_mins: 60,
    start_time: '', end_time: '', status: 'draft',
  })
  const [questions, setQuestions] = useState([])
  const [students,  setStudents]  = useState([])
  const [enrolled,  setEnrolled]  = useState([])
  const [enrolledDetail, setEnrolledDetail] = useState([])
  const [batches,   setBatches]   = useState([])
  const [syncingBatch, setSyncingBatch] = useState(false)
  const [newQ,      setNewQ]      = useState({
    question_text: '', question_type: 'mcq',
    options: ['', '', '', ''], correct_answer: 0, marks: 5,
  })
  const [tab,     setTab]     = useState('details')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (isEdit) {
      Promise.all([
        API.get(`/exams/${id}`),
        API.get(`/exams/${id}/questions`),
        API.get(`/exams/${id}/students`),
      ]).then(([eRes, qRes, sRes]) => {
        const e = eRes.data
        setForm({
          title:           e.title           || '',
          exam_type:       e.exam_type       || 'mcq',
          assignment_type: e.assignment_type || 'individual',
          batch_id:        e.batch_id        || null,
          description:     e.description     || '',
          duration_mins:   e.duration_mins   || 60,
          start_time:      e.start_time      ? e.start_time.slice(0, 16) : '',
          end_time:        e.end_time        ? e.end_time.slice(0,   16) : '',
          status:          e.status          || 'draft',
        })
        setQuestions(qRes.data.questions || [])
        setEnrolled(sRes.data.students.map(s => s.student.id))
        setEnrolledDetail(sRes.data.students)
      }).catch(console.error)
        .finally(() => setLoading(false))
    }
    API.get('/lecturer/students')
      .then(res => setStudents(res.data.students || []))
      .catch(() => {})
    API.get('/batches')
      .then(res => setBatches(res.data.batches || []))
      .catch(() => {})
  }, [id])

  const apiErrorMessage = err =>
    err?.response?.data?.error || 'Something went wrong. Please try again.'

  const saveExam = async () => {
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        await API.put(`/exams/${id}`, form)
      } else {
        const res = await API.post('/exams', form)
        navigate(`/exams/${res.data.exam.id}/edit`)
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const addQuestion = async () => {
    if (!newQ.question_text.trim()) return
    setError(null)
    try {
      const res = await API.post(`/exams/${id}/questions`, newQ)
      setQuestions(prev => [...prev, res.data.question])
      setNewQ({ question_text: '', question_type: 'mcq', options: ['','','',''], correct_answer: 0, marks: 5 })
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    }
  }

  const deleteQuestion = async qId => {
    try {
      await API.delete(`/exams/${id}/questions/${qId}`)
      setQuestions(prev => prev.filter(q => q.id !== qId))
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    }
  }

  const enrollStudents = async () => {
    setError(null)
    try {
      await API.post(`/exams/${id}/enroll`, { student_ids: enrolled })
      const sRes = await API.get(`/exams/${id}/students`)
      setEnrolledDetail(sRes.data.students)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    }
  }

  const assignBatch = async () => {
    if (!form.batch_id) return
    setSyncingBatch(true)
    setError(null)
    try {
      // Persist the exam's assignment first, then sync — a lecturer can
      // click this again later (e.g. after new students join the batch)
      // to pick up anyone who wasn't enrolled yet.
      await API.put(`/exams/${id}`, { ...form, assignment_type: 'batch', batch_id: form.batch_id })
      await API.post(`/exams/${id}/enroll-batch`)
      const sRes = await API.get(`/exams/${id}/students`)
      setEnrolled(sRes.data.students.map(s => s.student.id))
      setEnrolledDetail(sRes.data.students)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    } finally {
      setSyncingBatch(false)
    }
  }

  const publishExam = async () => {
    setForm(prev => ({ ...prev, status: 'active' }))
    setSaving(true)
    setError(null)
    try {
      await API.put(`/exams/${id}`, { ...form, status: 'active' })
      setSaved(true)
    } catch (err) {
      console.error(err)
      setError(apiErrorMessage(err))
    } finally {
      setSaving(false)
    }
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
      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">
              {isEdit ? 'Edit exam' : 'Create exam'}
            </h1>
            <p className="text-slate-500 mt-1">{form.title || 'Untitled exam'}</p>
          </div>
          <div className="flex gap-3">
            {isEdit && form.status !== 'active' && (
              <button onClick={publishExam} className="btn-primary">
                🚀 Publish exam
              </button>
            )}
            {isEdit && form.status === 'active' && (
              <span className="badge-green px-3 py-2">Live</span>
            )}
            <button onClick={saveExam} disabled={saving} className="btn-outline">
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start justify-between gap-3">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-400 hover:text-red-600 shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6 w-fit">
          {['details', ...(form.exam_type === 'document' ? [] : ['questions']), 'students'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t} {t === 'questions' && questions.length > 0 && `(${questions.length})`}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {tab === 'details' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Exam title</label>
                <input className="input" placeholder="e.g. Software Engineering Final 2026"
                  value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Duration (minutes)</label>
                <input className="input" type="number" min="15"
                  value={form.duration_mins} onChange={e => setForm({...form, duration_mins: parseInt(e.target.value)})} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Exam type</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled={isEdit}
                  onClick={() => setForm({...form, exam_type: 'mcq'})}
                  className={`text-left p-3 rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    form.exam_type === 'mcq' ? 'border-primary bg-primaryLight' : 'border-slate-200'
                  }`}>
                  <p className="text-sm font-medium text-slate-800">MCQ / Online exam</p>
                  <p className="text-xs text-slate-500 mt-0.5">Students answer in-browser. Full behavioral monitoring — camera, mic, gaze/head tracking, continuous identity verification.</p>
                </button>
                <button type="button" disabled={isEdit}
                  onClick={() => { setForm({...form, exam_type: 'document'}); if (tab === 'questions') setTab('details') }}
                  className={`text-left p-3 rounded-xl border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    form.exam_type === 'document' ? 'border-primary bg-primaryLight' : 'border-slate-200'
                  }`}>
                  <p className="text-sm font-medium text-slate-800">Document / Paper exam</p>
                  <p className="text-xs text-slate-500 mt-0.5">Students upload a PDF/DOCX. No webcam or behavioral monitoring — checked for originality (plagiarism) only.</p>
                </button>
              </div>
              {isEdit && (
                <p className="text-xs text-slate-400 mt-1.5">Exam type can't be changed after the exam is created.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Description / Instructions</label>
              <textarea className="input h-24 resize-none" placeholder="Instructions for students..."
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Start date & time</label>
                <input className="input" type="datetime-local"
                  value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">End date & time</label>
                <input className="input" type="datetime-local"
                  value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})} />
              </div>
            </div>
            <div className="pt-2">
              <button onClick={saveExam} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create exam'}
              </button>
            </div>
          </div>
        )}

        {/* Questions tab */}
        {tab === 'questions' && (
          <div className="space-y-4">
            {!isEdit && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                Save the exam details first before adding questions.
              </div>
            )}

            {/* Existing questions */}
            {questions.map((q, i) => (
              <div key={q.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-400">Q{i + 1}</span>
                      <span className="badge-gray text-xs">{q.question_type}</span>
                      <span className="badge-blue text-xs">{q.marks} marks</span>
                    </div>
                    <p className="text-sm text-slate-800">{q.question_text}</p>
                    {q.question_type === 'mcq' && q.options && (
                      <div className="mt-2 space-y-1">
                        {q.options.map((opt, oi) => (
                          <p key={oi} className={`text-xs px-2 py-1 rounded ${oi === q.correct_answer ? 'bg-green-50 text-green-700' : 'text-slate-500'}`}>
                            {oi === q.correct_answer ? '✓' : '○'} {opt}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => deleteQuestion(q.id)} className="btn-danger text-xs px-2 py-1">
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {/* Add new question */}
            {isEdit && (
              <div className="card p-5">
                <h3 className="font-semibold text-slate-700 mb-4 text-sm">Add question</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-500 mb-1.5">Question text</label>
                      <textarea className="input h-20 resize-none" placeholder="Enter your question..."
                        value={newQ.question_text}
                        onChange={e => setNewQ({...newQ, question_text: e.target.value})} />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Type</label>
                        <select className="input" value={newQ.question_type}
                          onChange={e => setNewQ({...newQ, question_type: e.target.value})}>
                          <option value="mcq">MCQ</option>
                          <option value="essay">Essay</option>
                          <option value="upload">Upload</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">Marks</label>
                        <input type="number" className="input" min="1"
                          value={newQ.marks}
                          onChange={e => setNewQ({...newQ, marks: parseInt(e.target.value)})} />
                      </div>
                    </div>
                  </div>

                  {newQ.question_type === 'mcq' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-2">Options</label>
                      <div className="space-y-2">
                        {newQ.options.map((opt, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="radio" name="correct"
                              checked={newQ.correct_answer === i}
                              onChange={() => setNewQ({...newQ, correct_answer: i})}
                              className="text-primary"
                            />
                            <input className="input text-sm" placeholder={`Option ${i + 1}`}
                              value={opt}
                              onChange={e => {
                                const opts = [...newQ.options]
                                opts[i] = e.target.value
                                setNewQ({...newQ, options: opts})
                              }} />
                          </div>
                        ))}
                        <p className="text-xs text-slate-400">Select the radio button next to the correct answer</p>
                      </div>
                    </div>
                  )}

                  <button onClick={addQuestion} className="btn-primary">
                    + Add question
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Students tab */}
        {tab === 'students' && (
          <div className="space-y-4">
            <div className="card p-4">
              <label className="block text-xs font-medium text-slate-500 mb-2">Assign this exam to</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button"
                  onClick={() => setForm({...form, assignment_type: 'individual'})}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    form.assignment_type === 'individual' ? 'border-primary bg-primaryLight' : 'border-slate-200'
                  }`}>
                  <p className="text-sm font-medium text-slate-800">Individual students</p>
                  <p className="text-xs text-slate-500 mt-0.5">Pick specific students one by one.</p>
                </button>
                <button type="button"
                  onClick={() => setForm({...form, assignment_type: 'batch'})}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    form.assignment_type === 'batch' ? 'border-primary bg-primaryLight' : 'border-slate-200'
                  }`}>
                  <p className="text-sm font-medium text-slate-800">Whole batch</p>
                  <p className="text-xs text-slate-500 mt-0.5">Assign to every student in a batch/class at once.</p>
                </button>
              </div>
            </div>

            {form.assignment_type === 'batch' ? (
              <div className="card">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-800">
                    Batch
                    <span className="ml-2 text-slate-400 font-normal text-sm">({enrolledDetail.length} students enrolled)</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <select className="input w-auto" value={form.batch_id || ''}
                      onChange={e => setForm({...form, batch_id: e.target.value ? parseInt(e.target.value) : null})}>
                      <option value="">Select a batch...</option>
                      {batches.map(b => (
                        <option key={b.id} value={b.id}>{b.name} ({b.student_count})</option>
                      ))}
                    </select>
                    <button onClick={assignBatch} disabled={!form.batch_id || syncingBatch} className="btn-primary text-xs disabled:opacity-50">
                      {syncingBatch ? 'Syncing...' : 'Assign batch'}
                    </button>
                  </div>
                </div>
                {batches.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <p className="text-sm">No batches exist yet.</p>
                    <p className="text-xs mt-1">Ask an admin to create one and assign students to it.</p>
                  </div>
                ) : enrolledDetail.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <p className="text-sm">No students enrolled yet.</p>
                    <p className="text-xs mt-1">Pick a batch above and click "Assign batch".</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {['Name', 'Email', 'Status'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enrolledDetail.map(({ student, enrollment }) => (
                        <tr key={student.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-5 py-3 text-sm font-medium text-slate-800">{student.name}</td>
                          <td className="px-5 py-3 text-sm text-slate-500">{student.email}</td>
                          <td className="px-5 py-3">
                            <span className="badge-gray text-xs capitalize">{enrollment}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <div className="card">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-semibold text-slate-800">
                    Enroll students
                    <span className="ml-2 text-slate-400 font-normal text-sm">({enrolled.length} selected)</span>
                  </h2>
                  <button onClick={enrollStudents} className="btn-primary text-xs">
                    Save enrollment
                  </button>
                </div>
                {students.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <p className="text-sm">No students exist yet.</p>
                    <p className="text-xs mt-1">Ask an admin to create student accounts.</p>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {['', 'Name', 'Email', 'Batch'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map(s => (
                        <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <input
                              type="checkbox"
                              checked={enrolled.includes(s.id)}
                              onChange={e => setEnrolled(prev =>
                                e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id)
                              )}
                              className="rounded border-slate-300 text-primary"
                            />
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center text-white text-xs font-semibold">
                                {s.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                              </div>
                              <span className="text-sm font-medium text-slate-800">{s.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-500">{s.email}</td>
                          <td className="px-5 py-3 text-sm text-slate-500">{s.batch_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}