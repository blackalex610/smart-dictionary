import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/context/I18nContext'
import { LoginPage } from './LoginPage'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ state: { status: 'anonymous' }, signIn: vi.fn(), signOut: vi.fn() }),
}))

// DEFAULT_LANG is 'bg'; this assertion reads the English string.
beforeEach(() => localStorage.setItem('appSettings', JSON.stringify({ language: 'en' })))
afterEach(() => localStorage.clear())

describe('LoginPage', () => {
  it('does not render a continue-as-guest option', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </I18nProvider>,
    )
    expect(screen.queryByText('Continue as guest')).not.toBeInTheDocument()
  })
})
