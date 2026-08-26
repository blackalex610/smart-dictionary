import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  tone: ToastTone
  action?: { label: string; onClick: () => void }
}

interface ToastValue {
  push: (message: string, tone?: ToastTone, action?: Toast['action']) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback<ToastValue['push']>(
    (message, tone = 'success', action) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, message, tone, action }])
      window.setTimeout(() => dismiss(id), 4000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone]
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-pop animate-slide-up',
                toast.tone === 'error' ? 'border-error/30' : 'border-line',
              )}
            >
              <Icon
                className={cn(
                  'shrink-0',
                  toast.tone === 'success' && 'text-success',
                  toast.tone === 'error' && 'text-error',
                  toast.tone === 'info' && 'text-brand',
                )}
                size={18}
              />
              <span className="flex-1 text-fg">{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="shrink-0 text-sm font-semibold text-brand hover:text-brand-hover"
                  onClick={() => {
                    toast.action?.onClick()
                    dismiss(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-md p-1 text-fg-subtle transition hover:bg-surface-2 hover:text-fg"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
