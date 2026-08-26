import { Link, Navigate, useLocation } from 'react-router-dom'
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

export function AuthCallbackPage() {
  const t = useT()
  const { state } = useAuth()
  const location = useLocation()

  if (state.status === 'authenticated') return <Navigate to="/app" replace />
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-[28px] font-bold text-fg">404</h1>
      <Link to="/app" className="text-[15px] font-medium text-brand hover:text-brand-hover">
        {t('app-name')}
      </Link>
    </div>
  )
}
