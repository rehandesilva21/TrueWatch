import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login    from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users    from './pages/Users'
import Batches  from './pages/Batches'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"   element={<Login />} />
      <Route path="/"        element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/users"   element={<PrivateRoute><Users /></PrivateRoute>} />
      <Route path="/batches" element={<PrivateRoute><Batches /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
