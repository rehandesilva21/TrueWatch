import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import API from '../api'

const emptyForm = { name: '', email: '', password: '', role: 'student', batch_id: '' }

export default function Users() {
  const [searchParams] = useSearchParams()
  const [users,    setUsers]    = useState([])
  const [batches,  setBatches]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [roleFilter, setRoleFilter] = useState(searchParams.get('role') || '')
  const [showForm,  setShowForm]  = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form,      setForm]      = useState(emptyForm)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      API.get('/admin/users', { params: roleFilter ? { role: roleFilter } : {} }),
      API.get('/batches'),
    ]).then(([uRes, bRes]) => {
      setUsers(uRes.data.users || [])
      setBatches(bRes.data.batches || [])
    }).catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(load, [roleFilter])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  const openEdit = u => {
    setEditingId(u.id)
    setForm({ name: u.name, email: u.email, password: '', role: u.role, batch_id: u.batch_id || '' })
    setError('')
    setShowForm(true)
  }

  const submit = async e => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name, role: form.role,
        batch_id: form.batch_id ? parseInt(form.batch_id) : null,
      }
      if (editingId) {
        if (form.password) payload.password = form.password
        await API.put(`/admin/users/${editingId}`, payload)
      } else {
        await API.post('/admin/users', { ...payload, email: form.email, password: form.password })
      }
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async u => {
    try {
      await API.put(`/admin/users/${u.id}`, { is_active: !u.is_active })
      load()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Users</h1>
            <p className="text-slate-500 mt-1">
              Create student and lecturer accounts. Students don't self-register — this is the only way
              a student gets an account and gets assigned to a batch.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select className="input w-auto" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              <option value="student">Students</option>
              <option value="lecturer">Lecturers</option>
              <option value="admin">Admins</option>
            </select>
            <button onClick={openCreate} className="btn-primary">+ New user</button>
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/30" onClick={() => setShowForm(false)}>
            <div className="card p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-slate-800 mb-4">{editingId ? 'Edit user' : 'New user'}</h2>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-3">{error}</div>
              )}
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Name</label>
                  <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
                  <input type="email" value={form.email} disabled={!!editingId}
                    onChange={e => setForm({...form, email: e.target.value})}
                    className={`input ${editingId ? 'opacity-60' : ''}`} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Password {editingId && <span className="font-normal text-slate-400">(leave blank to keep current)</span>}
                  </label>
                  <input type="password" className="input" value={form.password}
                    onChange={e => setForm({...form, password: e.target.value})}
                    required={!editingId} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Role</label>
                    <select className="input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                      <option value="student">Student</option>
                      <option value="lecturer">Lecturer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Batch {form.role !== 'student' && <span className="font-normal text-slate-400">(students only)</span>}
                    </label>
                    <select className="input" value={form.batch_id} disabled={form.role !== 'student'}
                      onChange={e => setForm({...form, batch_id: e.target.value})}>
                      <option value="">No batch</option>
                      {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="btn-outline flex-1 justify-center">Cancel</button>
                  <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                    {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create user'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">No users found.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Name', 'Email', 'Role', 'Batch', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-slate-800">{u.name}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs capitalize ${
                        u.role === 'admin' ? 'badge-purple' : u.role === 'lecturer' ? 'badge-blue' : 'badge-gray'
                      }`}>{u.role}</span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{u.batch_name || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={u.is_active ? 'badge-green text-xs' : 'badge-red text-xs'}>
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openEdit(u)} className="btn-outline text-xs px-3 py-1.5">Edit</button>
                        <button onClick={() => toggleActive(u)} className="btn-danger text-xs px-3 py-1.5">
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
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
