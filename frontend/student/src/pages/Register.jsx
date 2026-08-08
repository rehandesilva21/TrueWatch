import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import API from '../api'

export default function Register() {
  const [form,    setForm]    = useState({ name: '', email: '', password: '', confirm: '' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await API.post('/auth/register', {
        name:     form.name,
        email:    form.email,
        password: form.password,
      })
      navigate('/login')
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center">
              <span className="text-white text-sm font-bold">TW</span>
            </div>
            <span className="text-2xl font-bold text-slate-800">TrueWatch</span>
          </div>
          <p className="text-slate-500 text-sm">Create your student account</p>
        </div>

        <div className="card p-8">
          <h1 className="text-lg font-semibold text-slate-800 mb-1">Create account</h1>
          <p className="text-slate-400 text-sm mb-6">Register to access your exams</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { label: 'Full name',        key: 'name',     type: 'text',     placeholder: 'Your full name' },
              { label: 'Email address',    key: 'email',    type: 'email',    placeholder: 'you@university.edu' },
              { label: 'Password',         key: 'password', type: 'password', placeholder: '••••••••' },
              { label: 'Confirm password', key: 'confirm',  type: 'password', placeholder: '••••••••' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{f.label}</label>
                <input
                  type={f.type}
                  className="input"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  required
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primaryDark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Creating account...</>
                : 'Create account'
              }
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-primary font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}