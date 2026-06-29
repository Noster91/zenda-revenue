import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Si Supabase no está configurado, forzamos session a "bypass"
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : 'bypass')

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // role: leído desde user_metadata. Default 'admin' para no romper usuarios existentes.
  const role = (session && session !== 'bypass')
    ? (session.user?.user_metadata?.role ?? 'admin')
    : 'admin'

  return (
    <AuthContext.Provider value={{ session, role }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
