import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getTodayUsage } from '@/lib/supabase/usage'
import type { UsageInfo } from '@/types/domain'

/** Guests never reach the Edge Function, so they have no server-side quota. */
const GUEST_USAGE: UsageInfo = { used: 0, limit: 0, isUnlimited: false }

export function useAiUsage() {
  const { scope, state } = useAuth()

  return useQuery({
    queryKey: ['ai-usage', scope],
    queryFn: (): Promise<UsageInfo> =>
      state.status === 'authenticated' ? getTodayUsage(state.user.id) : Promise.resolve(GUEST_USAGE),
    enabled: state.status === 'authenticated',
    staleTime: 15_000,
  })
}

/** Call after anything that spends quota; the meter refetches. */
export function useRefreshAiUsage() {
  const { scope } = useAuth()
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ai-usage', scope] })
  }, [queryClient, scope])
}

export function isQuotaExhausted(usage: UsageInfo | undefined): boolean {
  if (!usage || usage.isUnlimited) return false
  if (usage.limit == null) return false
  return usage.used >= usage.limit
}
