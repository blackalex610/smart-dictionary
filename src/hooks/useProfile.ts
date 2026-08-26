import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { getProfile, type Profile } from '@/lib/supabase/profiles'

export function useProfile() {
  const { scope, state } = useAuth()
  const userId = state.status === 'authenticated' ? state.user.id : null

  return useQuery({
    queryKey: ['profile', scope],
    queryFn: (): Promise<Profile | null> => (userId ? getProfile(userId) : Promise.resolve(null)),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  })
}
