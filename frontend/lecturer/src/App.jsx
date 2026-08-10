import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login       from './pages/Login'
import Dashboard   from './pages/Dashboard'
import LiveMonitor from './pages/LiveMonitor'
import Sessions    from './pages/Sessions'
import SessionDetail from './pages/SessionDetail'
import CreateExam  from './pages/CreateExam'
import ExamList    from './pages/ExamList'
import Results     from './pages/Results'
import PlagiarismCorpus from './pages/PlagiarismCorpus'
import Users       from './pages/Users'
import Batches     from './pages/Batches'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"/>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return user.role === 'admin' ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"          element={<Login />} />
      <Route path="/"               element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/live"           element={<PrivateRoute><LiveMonitor /></PrivateRoute>} />
      <Route path="/sessions"       element={<PrivateRoute><Sessions /></PrivateRoute>} />
      <Route path="/sessions/:id"   element={<PrivateRoute><SessionDetail /></PrivateRoute>} />
      <Route path="/exams"          element={<PrivateRoute><ExamList /></PrivateRoute>} />
      <Route path="/exams/create"   element={<PrivateRoute><CreateExam /></PrivateRoute>} />
      <Route path="/exams/:id/edit" element={<PrivateRoute><CreateExam /></PrivateRoute>} />
      <Route path="/results"        element={<PrivateRoute><Results /></PrivateRoute>} />
      <Route path="/corpus"         element={<PrivateRoute><PlagiarismCorpus /></PrivateRoute>} />
      <Route path="/users"          element={<AdminRoute><Users /></AdminRoute>} />
      <Route path="/batches"        element={<AdminRoute><Batches /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}