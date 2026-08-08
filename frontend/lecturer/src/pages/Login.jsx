import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login(email, password)
      if (user.role !== 'lecturer') {
        setError('Access denied. Admins use the admin portal; students use the student portal.')
        return
      }
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-md bg-slate-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold">TW</span>
            </div>
            <span className="text-lg font-semibold text-slate-900 tracking-tight">TrueWatch</span>
          </div>
          <p className="text-slate-500 text-sm">Lecturer portal</p>
        </div>

        <div className="card p-8">
          <h1 className="text-base font-semibold text-slate-900 mb-1">Sign in</h1>
          <p className="text-slate-400 text-sm mb-6">Access your proctoring dashboard</p>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
              <input type="email" className="input" placeholder="lecturer@university.edu"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Password</label>
              <input type="password" className="input" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Signing in…</>
                : 'Sign in to TrueWatch'
              }
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-5">
          Student? Use the <a href="http://localhost:5173" className="text-primary hover:underline">student portal</a>.{' '}
          Admin? Use the <a href="http://localhost:5175" className="text-primary hover:underline">admin portal</a>.
        </p>
      </div>
    </div>
  )
}
