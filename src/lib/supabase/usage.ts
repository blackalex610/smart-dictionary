import { supabase } from './client'
import type { UsageInfo } from '@/types/domain'

export async function getTodayUsage(userId: string): Promise<UsageInfo> {
  const { data, error } = await supabase.rpc('get_today_ai_usage', { p_user_id: userId })
  if (error) return { used: 0, limit: null, isUnlimited: false }
  const row = Array.isArray(data) ? data[0] : data
  const record = (row ?? {}) as Record<string, unknown>
  return {
    used: Number(record.used ?? record.ai_requests ?? 0),
    limit: record.limit_value == null ? null : Number(record.limit_value),
    isUnlimited: Boolean(record.is_unlimited),
  }
}
