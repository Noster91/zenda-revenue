import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// allowedRoles: si se pasa, el usuario debe tener uno de esos roles.
// Usuarios sin el rol son redirigidos a /pod-designer (única vista disponible para hr).
export default function ProtectedRoute({ children, allowedRoles }) {
  const { session, role } = useAuth()

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-[#59D7A2] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/pod-designer" replace />
  }

  return children
}
