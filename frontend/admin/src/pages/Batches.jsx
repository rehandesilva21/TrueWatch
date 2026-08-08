import { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import API from '../api'

export default function Batches() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [creating,    setCreating]    = useState(false)
  const [error,       setError]       = useState('')
  const [expanded,    setExpanded]    = useState(null) // batch id currently showing its student list
  const [batchStudents, setBatchStudents] = useState([])

  const load = () => {
    setLoading(true)
    API.get('/batches')
      .then(res => setBatches(res.data.batches || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const createBatch = async e => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError('')
    try {
      await API.post('/batches', { name, description })
      setName('')
      setDescription('')
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create batch')
    } finally {
      setCreating(false)
    }
  }

  const deleteBatch = async id => {
    if (!confirm('Delete this batch? Students in it will become unassigned, and any exam pointed at it will switch to individual assignment.')) return
    try {
      await API.delete(`/batches/${id}`)
      if (expanded === id) setExpanded(null)
      load()
    } catch (err) {
      console.error(err)
    }
  }

  const toggleExpand = async b => {
    if (expanded === b.id) { setExpanded(null); return }
    setExpanded(b.id)
    try {
      const res = await API.get(`/batches/${b.id}/students`)
      setBatchStudents(res.data.students || [])
    } catch (err) {
      console.error(err)
      setBatchStudents([])
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Batches</h1>
          <p className="text-slate-500 mt-1">
            Create batches (classes/cohorts) so lecturers can assign an exam to a whole group at once.
            Assign students to a batch from the Users page.
          </p>
        </div>

        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-slate-800 mb-3 text-sm">New batch</h2>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-3">{error}</div>
          )}
          <form onSubmit={createBatch} className="grid grid-cols-3 gap-3 items-end">
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Batch name</label>
              <input className="input" placeholder="e.g. SE Year 3 Batch 12"
                value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Description (optional)</label>
              <input className="input" placeholder="e.g. Semester 2, 2026"
                value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <button type="submit" disabled={creating} className="btn-primary justify-center">
              {creating ? 'Creating...' : '+ Create batch'}
            </button>
          </form>
        </div>

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : batches.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">No batches yet — create one above.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {batches.map(b => (
                <div key={b.id}>
                  <div className="px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{b.name}</p>
                      {b.description && <p className="text-xs text-slate-400 mt-0.5">{b.description}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="badge-blue text-xs">{b.student_count} student{b.student_count !== 1 ? 's' : ''}</span>
                      <button onClick={() => toggleExpand(b)} className="btn-outline text-xs px-3 py-1.5">
                        {expanded === b.id ? 'Hide' : 'View students'}
                      </button>
                      <button onClick={() => deleteBatch(b.id)} className="btn-danger text-xs px-3 py-1.5">
                        Delete
                      </button>
                    </div>
                  </div>
                  {expanded === b.id && (
                    <div className="px-5 pb-4">
                      {batchStudents.length === 0 ? (
                        <p className="text-xs text-slate-400">No students assigned to this batch yet. Assign them from the Users page.</p>
                      ) : (
                        <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
                          {batchStudents.map(s => (
                            <div key={s.id} className="flex items-center justify-between text-xs">
                              <span className="text-slate-700 font-medium">{s.name}</span>
                              <span className="text-slate-400">{s.email}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
