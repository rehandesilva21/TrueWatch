import { useState, useEffect, useRef } from 'react'
import Layout from '../components/Layout'
import API from '../api'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PlagiarismCorpus() {
  const [files,     setFiles]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const fileInputRef = useRef(null)

  const load = () => {
    setLoading(true)
    API.get('/plagiarism/corpus')
      .then(res => setFiles(res.data.files || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleUpload = async e => {
    const selected = Array.from(e.target.files || [])
    if (selected.length === 0) return
    setUploading(true)
    setError('')
    try {
      // Sequential, not Promise.all — the endpoint writes one file at a
      // time and this keeps the progress/error state simple to reason
      // about for what's normally a handful of files at once.
      for (const file of selected) {
        const formData = new FormData()
        formData.append('file', file)
        await API.post('/plagiarism/corpus', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-8 py-10">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Plagiarism corpus</h1>
          <p className="text-slate-500 mt-1">
            Reference documents every student submission is checked against — textbook
            excerpts, model answers, past top submissions, or anything else students
            shouldn't be copying from. Every checked submission is also added here
            automatically, so cross-student copying gets caught once at least one
            other student has submitted.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>
        )}

        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-slate-800 mb-3 text-sm">Add reference documents</h2>
          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer transition-colors ${
            uploading ? 'border-slate-200 bg-slate-50 cursor-wait' : 'border-slate-300 hover:border-primary hover:bg-primaryLight'
          }`}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.txt"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
            <span className="text-sm font-medium text-slate-700">
              {uploading ? 'Uploading...' : 'Click to choose files'}
            </span>
            <span className="text-xs text-slate-400">PDF, DOCX, or TXT — multiple files at once is fine</span>
          </label>
        </div>

        <div className="card">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">
              Current corpus
              <span className="ml-2 text-slate-400 font-normal">({files.length} document{files.length !== 1 ? 's' : ''})</span>
            </h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : files.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              No reference documents yet — every check against an empty corpus reports 100% originality
              since there's nothing to compare against. Upload something above to get started.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['File', 'Size'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.name} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm text-slate-700 break-all">{f.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-400">{formatSize(f.size)}</td>
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
