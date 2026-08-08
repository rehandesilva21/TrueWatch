import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login    from './pages/Login'
import Dashboard from './pages/Dashboard'
import ExamRoom  from './pages/ExamRoom'
import Results   from './pages/Results'
import FaceRegistration from './pages/FaceRegistration'
import Calibration      from './pages/Calibration'
import Profile  from './pages/Profile'
import Settings from './pages/Settings'

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
      <Route path="/login"    element={<Login />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/exam/:examId" element={<PrivateRoute><ExamRoom /></PrivateRoute>} />
      <Route path="/results"      element={<PrivateRoute><Results /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
      <Route path="/register-face" element={<PrivateRoute><FaceRegistration /></PrivateRoute>} />
      <Route path="/calibration"   element={<PrivateRoute><Calibration /></PrivateRoute>} />
      <Route path="/profile"       element={<PrivateRoute><Profile /></PrivateRoute>} />
      <Route path="/settings"      element={<PrivateRoute><Settings /></PrivateRoute>} />
    </Routes>
  )
}