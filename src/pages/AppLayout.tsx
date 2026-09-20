import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Moon, Sun } from 'lucide-react'
import { BackToTop } from '@/components/ui/BackToTop'
import { LogoMark } from '@/components/ui/Logo'
import { ChatWidget } from '@/features/chat/ChatWidget'
import { GuestImportPrompt } from '@/features/data/GuestImportPrompt'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { useTheme } from '@/context/ThemeContext'
import { cn } from '@/lib/cn'
import type { TranslationKey } from '@/i18n'

const NAV: { to: string; key: TranslationKey; end?: boolean }[] = [
  { to: '/app', key: 'nav-dictionary', end: true },
  { to: '/app/flashcards', key: 'nav-flashcards' },
  { to: '/app/tests', key: 'nav-tests' },
  { to: '/app/settings', key: 'nav-settings' },
]

function UserMenu() {
  const t = useT()
  const { state, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const user = state.status === 'authenticated' ? state.user : null
  const label = user?.name ?? t('guest')
  const initial = (label || 'A').trim().charAt(0).toUpperCase()
  const avatar = user?.avatarUrl && !avatarFailed ? user.avatarUrl : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-full pl-0.5 pr-1 transition hover:bg-surface-2"
        aria-label={t('account-menu')}
        aria-expanded={open}
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            onError={() => setAvatarFailed(true)}
            className="h-[34px] w-[34px] rounded-full object-cover"
          />
        ) : (
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#B0B4BB] text-[15px] font-semibold text-white">
            {initial}
          </span>
        )}
        <ChevronDown size={16} className="text-fg-subtle" />
      </button>

      {open && (
        <div className="absolute right-0 top-[46px] z-40 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1.5 shadow-pop animate-slide-up">
          <div className="border-b border-line px-3.5 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-semibold text-fg">{label}</p>
            {user?.email && <p className="truncate text-xs text-fg-subtle">{user.email}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              toggleTheme()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-fg transition hover:bg-surface-2"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {t('toggle-theme')}
          </button>
          <button
            type="button"
            onClick={async () => {
              setOpen(false)
              await signOut()
              navigate('/')
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-fg transition hover:bg-surface-2"
          >
            <LogOut size={16} />
            {t('sign-out')}
          </button>
        </div>
      )}
    </div>
  )
}

export function AppLayout() {
  const t = useT()

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="relative mx-auto flex h-[68px] max-w-[1440px] items-center justify-between px-8">
          <NavLink to="/app" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-[19px] font-bold tracking-[-0.01em] text-fg">
              {t('app-name')}
            </span>
          </NavLink>

          <nav className="absolute left-1/2 top-0 hidden h-full -translate-x-1/2 items-center gap-10 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full items-center text-[15px] font-medium transition-colors',
                    isActive ? 'text-brand' : 'text-fg-muted hover:text-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {t(item.key)}
                    {isActive && (
                      <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-t-full bg-brand" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              aria-label={t('notifications')}
            >
              <Bell size={20} />
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-8 pb-10">
        <Outlet />
      </main>

      <BackToTop />
      <ChatWidget />
      <GuestImportPrompt />
    </div>
  )
}
