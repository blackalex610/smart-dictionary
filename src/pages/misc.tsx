import { useEffect, useState } from 'react'
import { isRouteErrorResponse, Link, Navigate, useLocation, useRouteError } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth()

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner />
      </div>
    )
  }
  if (state.status === 'anonymous') return <Navigate to="/" replace />
  return <>{children}</>
}

/** How long the code exchange may take before we give up and go back. */
const CALLBACK_TIMEOUT_MS = 15_000

/** True when the provider redirected back with `error=` (denied, expired, ...). */
function hasOAuthError(search: string, hash: string): boolean {
  const params = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  return params.has('error') || fragment.has('error') || params.has('error_description')
}

export function AuthCallbackPage() {
  const t = useT()
  const { state } = useAuth()
  const location = useLocation()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), CALLBACK_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  if (state.status === 'authenticated') return <Navigate to="/app" replace />
  if (hasOAuthError(location.search, location.hash) || (timedOut && state.status !== 'loading')) {
    return <Navigate to="/" replace state={{ authError: 'denied' }} />
  }
  if (state.status === 'anonymous' && !location.hash && !location.search) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-fg-muted">
      <Spinner />
      <p className="text-sm">{t('loading')}</p>
    </div>
  )
}

export function NotFoundPage() {
  const t = useT()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-[28px] font-bold text-fg">404</h1>
      <p className="text-[15px] text-fg-muted">{t('not-found-body')}</p>
      <Link to="/app" className="text-[15px] font-medium text-brand hover:text-brand-hover">
        {t('app-name')}
      </Link>
    </main>
  )
}

/**
 * Router-level error boundary. Logs the failure for diagnosis and shows a
 * recovery screen instead of React Router's developer error page.
 */
export function RouteErrorPage({ inline = false }: { inline?: boolean }) {
  const t = useT()
  const error = useRouteError()

  useEffect(() => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'route_error',
        path: window.location.pathname,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : undefined,
      }),
    )
  }, [error])

  // A 404 thrown by the router gets the not-found page, not an error screen.
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />

  // Inside the app layout the page already has a <main>; do not nest another.
  const Container = inline ? 'section' : 'main'
  return (
    <Container
      className={
        inline
          ? 'flex flex-col items-center justify-center gap-3 px-6 py-20 text-center'
          : 'flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center'
      }
    >
      <h1 className="text-[24px] font-bold text-fg">{t('error-page-title')}</h1>
      <p className="max-w-sm text-[15px] text-fg-muted">{t('error-page-body')}</p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-[10px] bg-brand px-4 py-2 text-[14.5px] font-semibold text-white transition hover:bg-brand-hover"
        >
          {t('reload')}
        </button>
        <Link
          to="/app"
          reloadDocument
          className="rounded-[10px] border border-line px-4 py-2 text-[14.5px] font-medium text-fg transition hover:bg-surface-2"
        >
          {t('app-name')}
        </Link>
      </div>
    </Container>
  )
}
