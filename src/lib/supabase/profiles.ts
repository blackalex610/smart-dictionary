import { supabase } from './client'
import type { AppUser, Tier } from '@/types/domain'

export interface Profile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  tier: Tier
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, avatar_url, tier')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return (data as Profile) ?? null
}

/** Fire-and-forget: never block the UI on this. */
export async function upsertProfile(user: AppUser): Promise<void> {
  try {
    await supabase.from('profiles').upsert(
      {
        user_id: user.id,
        display_name: user.name,
        avatar_url: user.avatarUrl,
      },
      { onConflict: 'user_id' },
    )
  } catch {
    /* ignore */
  }
}
