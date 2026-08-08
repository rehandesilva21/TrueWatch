import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const { login }    = useAuth()
  const navigate     = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login(email, password)
      if (user.role !== 'student') {
        setError('This account is not a student account.')
        return
      }
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || "That email or password isn't right.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <div className="liquid-bg" />

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-[20px] glass-panel-strong flex items-center justify-center">
            <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>TW</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">TrueWatch</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--ink-soft)' }}>Sign in to enter your exam</p>
        </div>

        <div className="glass-panel p-8">
          {error && (
            <div className="mb-5 px-4 py-3 rounded-2xl text-sm" style={{ background: 'rgba(255, 59, 48, 0.1)', color: '#D70015', border: '1px solid rgba(255,59,48,0.2)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 ml-1" style={{ color: 'var(--ink-soft)' }}>Email</label>
              <input
                type="email" className="glass-input"
                placeholder="you@university.edu"
                value={email} onChange={e => setEmail(e.target.value)} required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 ml-1" style={{ color: 'var(--ink-soft)' }}>Password</label>
              <input
                type="password" className="glass-input"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required
              />
            </div>
            <button type="submit" disabled={loading} className="glass-btn-primary mt-2">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm mt-6" style={{ color: 'var(--ink-soft)' }}>
          Don't have an account? Ask your administrator to create one for you.
        </p>
      </div>
    </div>
  )
}