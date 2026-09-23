import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BookMarked, Brain, Layers, Sparkles } from 'lucide-react'
import { LogoMark } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import type { TranslationKey } from '@/i18n'

const FEATURES: { icon: typeof BookMarked; key: TranslationKey }[] = [
  { icon: BookMarked, key: 'nav-dictionary' },
  { icon: Layers, key: 'nav-flashcards' },
  { icon: Brain, key: 'nav-tests' },
  { icon: Sparkles, key: 'open-chat' },
]

export function LoginPage() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { state, signIn, continueAsGuest } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() =>
    (location.state as { authError?: string } | null)?.authError ? t('err-sign-in-denied') : null,
  )

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner />
      </div>
    )
  }

  if (state.status === 'authenticated' || state.status === 'guest') {
    return <Navigate to="/app" replace />
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-card">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10 rounded-xl" />
          <span className="text-[22px] font-bold tracking-[-0.01em] text-fg">{t('app-name')}</span>
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">{t('login-tagline')}</p>

        <ul className="mt-6 grid grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, key }) => (
            <li
              key={key}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[14px] text-fg"
            >
              <Icon size={17} className="text-brand" />
              {t(key)}
            </li>
          ))}
        </ul>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-error-soft px-3 py-2 text-[13.5px] text-error"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              // Success navigates away to Google; we only get here on failure.
              await signIn()
            } catch {
              setError(t(navigator.onLine === false ? 'err-offline' : 'err-sign-in'))
            } finally {
              setBusy(false)
            }
          }}
          className="mt-7 flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] bg-brand text-[15.5px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? <Spinner /> : null}
          {t('sign-in-google')}
        </button>

        <button
          type="button"
          onClick={() => {
            continueAsGuest()
            navigate('/app')
          }}
          className="mt-3 flex h-[48px] w-full items-center justify-center rounded-[10px] border border-line text-[14.5px] font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          {t('continue-as-guest')}
        </button>
      </div>
    </main>
  )
}
