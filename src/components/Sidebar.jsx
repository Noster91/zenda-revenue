import { NavLink, useNavigate } from 'react-router-dom'
import ZendaLogo from './ZendaLogo'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const nav = [
  {
    to: '/', label: 'Dashboard', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    )
  },
  {
    to: '/pods', label: 'PODs', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="3 2"/>
        <circle cx="12" cy="12" r="1" fill="currentColor"/>
      </svg>
    )
  },
  {
    to: '/pod-designer', label: 'Diseñador de PODs', roles: ['admin', 'hr'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    to: '/clientes', label: 'Clientes', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    )
  },
  {
    to: '/maestro-clientes', label: 'Maestro Clientes', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/><path d="M9 21V9"/>
        <circle cx="15" cy="15" r="2" fill="currentColor" opacity="0.4"/>
      </svg>
    )
  },
  {
    to: '/equipo', label: 'Equipo y Costos', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
        <path d="M12 12v9" strokeDasharray="2 2"/>
      </svg>
    )
  },
  {
    to: '/rentabilidad', label: 'Rentabilidad', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    )
  },
  {
    to: '/historico', label: 'Histórico', roles: ['admin'], icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M8 2v4M16 2v4M3 10h18"/>
        <path d="M8 14h2M12 14h2M8 17h2M12 17h2"/>
      </svg>
    )
  },
]

export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate()
  const { session, role } = useAuth()

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    }
  }

  const userEmail = session && session !== 'bypass' ? session.user?.email : null

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full w-64 z-30 flex flex-col
          transition-transform duration-300
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:h-screen lg:flex-shrink-0
        `}
        style={{ background: '#0A0A0B' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: 'var(--bw) solid rgba(255,255,255,0.1)' }}>
          <ZendaLogo size="md" variant="sidebar" />
          <button onClick={onClose} className="lg:hidden text-lg ml-3"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-1">
          {nav.filter(item => item.roles.includes(role)).map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 text-sm transition-all duration-150"
              style={({ isActive }) => ({
                borderRadius:  'var(--r-tag)',
                fontFamily:    'var(--font-body)',
                fontWeight:    isActive ? 600 : 400,
                background:    isActive ? '#59D7A2' : 'transparent',
                color:         isActive ? '#0A0A0B' : 'rgba(255,255,255,0.55)',
              })}
              title={label}
            >
              <span className="flex-shrink-0">{icon}</span>
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Divider + user */}
        <div className="mx-4 mb-2" style={{ height: 'var(--bw)', background: 'rgba(255,255,255,0.1)' }} />
        <div className="px-5 py-4">
          {userEmail ? (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 flex items-center justify-center flex-shrink-0"
                style={{
                  background:   '#59D7A2',
                  borderRadius: 'var(--r-pill)',
                  color:        '#0A0A0B',
                  fontFamily:   'var(--font-mono)',
                  fontSize:     '10px',
                  fontWeight:   700,
                }}>
                {userEmail.split('@')[0].slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', fontWeight: 500 }} className="truncate">
                  {userEmail.split('@')[0]}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }} className="truncate">
                  {userEmail}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--g)' }} />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                En vivo
              </span>
            </div>
          )}
          {isSupabaseConfigured && (
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 transition-all"
              style={{
                fontFamily:   'var(--font-body)',
                fontSize:     '12px',
                color:        'rgba(255,255,255,0.4)',
                background:   'none',
                border:       'none',
                borderRadius: 'var(--r-tag)',
                cursor:       'pointer',
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Cerrar sesión
            </button>
          )}
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px', marginTop: '8px', fontFamily: 'var(--font-mono)' }}>
            Zenda Dashboard v1.0
          </p>
        </div>
      </aside>
    </>
  )
}
