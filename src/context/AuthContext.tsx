import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { signInWithGoogle, signOut as supabaseSignOut, toAppUser } from '@/lib/supabase/auth'
import { supabase } from '@/lib/supabase/client'
import { upsertProfile } from '@/lib/supabase/profiles'
import type { AppUser } from '@/types/domain'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AppUser; session: Session }

interface AuthValue {
  state: AuthState
  /** Stable key for cache scoping: user id or 'anonymous'. */
  scope: string
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    const apply = (session: Session | null) => {
      if (!active) return
      if (session?.user) {
        const user = toAppUser(session.user)
        setState({ status: 'authenticated', user, session })
        void upsertProfile(user)
        return
      }
      setState({ status: 'anonymous' })
    }

    void supabase.auth.getSession().then(({ data }) => apply(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async () => {
    await signInWithGoogle()
  }, [])

  const signOut = useCallback(async () => {
    await supabaseSignOut()
    setState({ status: 'anonymous' })
  }, [])

  const scope = state.status === 'authenticated' ? state.user.id : 'anonymous'

  const value = useMemo<AuthValue>(
    () => ({ state, scope, signIn, signOut }),
    [state, scope, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
