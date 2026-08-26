import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/pages/AppLayout'
import { DictionaryPage } from '@/pages/DictionaryPage'
import { FlashcardsPage } from '@/pages/FlashcardsPage'
import { LoginPage } from '@/pages/LoginPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TestsPage } from '@/pages/TestsPage'
import { AuthCallbackPage, NotFoundPage, ProtectedRoute } from '@/pages/misc'

export const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DictionaryPage /> },
      { path: 'flashcards', element: <FlashcardsPage /> },
      { path: 'tests', element: <TestsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
