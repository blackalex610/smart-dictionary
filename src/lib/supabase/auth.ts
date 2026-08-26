import { supabase } from './client'
import type { AppUser } from '@/types/domain'
import type { Session, User } from '@supabase/supabase-js'

export const OAUTH_REDIRECT =
  import.meta.env.VITE_OAUTH_REDIRECT_URL || `${window.location.origin}/auth/callback`

export function toAppUser(user: User): AppUser {
  const meta = user.user_metadata ?? {}
  return {
    id: user.id,
    email: user.email ?? null,
    name: (meta.full_name as string) ?? (meta.name as string) ?? user.email ?? null,
    avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
  }
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: OAUTH_REDIRECT },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
