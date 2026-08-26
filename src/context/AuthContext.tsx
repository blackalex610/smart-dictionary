import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { signInWithGoogle, signOut as supabaseSignOut, toAppUser } from '@/lib/supabase/auth'
import { upsertProfile } from '@/lib/supabase/profiles'
import { readString, removeKey, writeString } from '@/lib/storage'
import type { AppUser } from '@/types/domain'

const GUEST_KEY = 'isGuest'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'guest' }
  | { status: 'authenticated'; user: AppUser; session: Session }

interface AuthValue {
  state: AuthState
  /** Stable key for cache scoping: user id, 'guest' or 'anonymous'. */
  scope: string
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  continueAsGuest: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function isGuestFlagSet(): boolean {
  return readString(GUEST_KEY) === 'true'
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    const apply = (session: Session | null) => {
      if (!active) return
      if (session?.user) {
        removeKey(GUEST_KEY)
        const user = toAppUser(session.user)
        setState({ status: 'authenticated', user, session })
        void upsertProfile(user)
        return
      }
      setState(isGuestFlagSet() ? { status: 'guest' } : { status: 'anonymous' })
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

  const continueAsGuest = useCallback(() => {
    writeString(GUEST_KEY, 'true')
    setState({ status: 'guest' })
  }, [])

  const signIn = useCallback(async () => {
    removeKey(GUEST_KEY)
    await signInWithGoogle()
  }, [])

  const signOut = useCallback(async () => {
    removeKey(GUEST_KEY)
    await supabaseSignOut()
    setState({ status: 'anonymous' })
  }, [])

  const scope =
    state.status === 'authenticated'
      ? state.user.id
      : state.status === 'guest'
        ? 'guest'
        : 'anonymous'

  const value = useMemo<AuthValue>(
    () => ({ state, scope, signIn, signOut, continueAsGuest }),
    [state, scope, signIn, signOut, continueAsGuest],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
