import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Pods from './pages/Pods'
import Clientes from './pages/Clientes'
import Equipo from './pages/Equipo'
import Rentabilidad from './pages/Rentabilidad'
import PodDesigner from './pages/PodDesigner'
import MaestroClientes from './pages/MaestroClientes'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ProtectedRoute allowedRoles={['admin']}><Dashboard /></ProtectedRoute>} />
            <Route path="pods" element={<ProtectedRoute allowedRoles={['admin']}><Pods /></ProtectedRoute>} />
            <Route path="clientes" element={<ProtectedRoute allowedRoles={['admin']}><Clientes /></ProtectedRoute>} />
            <Route path="equipo" element={<ProtectedRoute allowedRoles={['admin']}><Equipo /></ProtectedRoute>} />
            <Route path="rentabilidad" element={<ProtectedRoute allowedRoles={['admin']}><Rentabilidad /></ProtectedRoute>} />
            <Route path="pod-designer" element={<PodDesigner />} />
            <Route path="maestro-clientes" element={<ProtectedRoute allowedRoles={['admin']}><MaestroClientes /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
