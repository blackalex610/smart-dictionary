import { supabase } from '@/lib/supabase/client'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail: string,
    public readonly errors?: { field: string; code: string }[],
  ) {
    super(detail)
    this.name = 'AppError'
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const REQUEST_TIMEOUT_MS = 10_000

interface ProblemBody {
  code?: string
  detail?: string
  errors?: { field: string; code: string }[]
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AppError('UNAUTHENTICATED', 401, 'Not signed in')
  return { Authorization: `Bearer ${token}` }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': crypto.randomUUID(),
      ...(await authHeaders()),
      ...(init.headers as Record<string, string> | undefined),
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })

    if (response.status === 204) return undefined as T

    const body = (await response.json().catch(() => null)) as ProblemBody | null

    if (!response.ok) {
      throw new AppError(
        body?.code ?? 'INTERNAL',
        response.status,
        body?.detail ?? 'Request failed',
        body?.errors,
      )
    }

    return body as T
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AppError('TIMEOUT', 408, 'The request took too long')
    }
    throw new AppError('NETWORK_ERROR', 0, 'Could not reach the server')
  } finally {
    clearTimeout(timeoutId)
  }
}
