import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { AppLayout } from '@/pages/AppLayout'
import { DictionaryPage } from '@/pages/DictionaryPage'
import { LoginPage } from '@/pages/LoginPage'
import { AuthCallbackPage, NotFoundPage, ProtectedRoute, RouteErrorPage } from '@/pages/misc'

// The dictionary is the landing view; the other sections load on first visit.
const FlashcardsPage = lazy(() =>
  import('@/pages/FlashcardsPage').then((m) => ({ default: m.FlashcardsPage })),
)
const TestsPage = lazy(() => import('@/pages/TestsPage').then((m) => ({ default: m.TestsPage })))
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-fg-muted">
          <Spinner />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      {
        // Keeps the header and navigation on screen when one view crashes.
        errorElement: <RouteErrorPage inline />,
        children: [
          { index: true, element: <DictionaryPage /> },
          {
            path: 'flashcards',
            element: (
              <Lazy>
                <FlashcardsPage />
              </Lazy>
            ),
          },
          {
            path: 'tests',
            element: (
              <Lazy>
                <TestsPage />
              </Lazy>
            ),
          },
          {
            path: 'settings',
            element: (
              <Lazy>
                <SettingsPage />
              </Lazy>
            ),
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
