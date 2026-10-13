import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  client: SupabaseClient
  status: AuthStatus
  session: Session | null
  user: User | null
  signOut: () => Promise<{ error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children, client }: { children: ReactNode; client: SupabaseClient }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let isMounted = true
    const restoreSession = async () => {
      const { data, error } = await client.auth.getSession()
      if (!isMounted) return
      setSession(error ? null : data.session)
      setStatus(error || data.session === null ? 'unauthenticated' : 'authenticated')
    }

    void restoreSession()
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return
      setSession(nextSession)
      setStatus(nextSession === null ? 'unauthenticated' : 'authenticated')
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [client])

  const value = useMemo<AuthContextValue>(() => ({
    client,
    status,
    session,
    user: session?.user ?? null,
    signOut: async () => {
      const { error } = await client.auth.signOut()
      return error ? { error: error.message } : {}
    },
  }), [client, session, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) throw new Error('useAuth debe usarse dentro de AuthProvider.')
  return context
}
