import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  className?: string
  children: React.ReactNode
}

export function Modal({ open, onClose, labelledBy, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    }, 0)
    return () => {
      // The autofocus is deferred a tick so the panel is in the document by
      // the time it runs; a modal closed within that tick must cancel it,
      // or it steals focus back from whatever the app moved to.
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      // Backdrop only: it carries no semantics of its own (the real dialog is
      // the child below with role="dialog"). Click-to-dismiss here is a mouse
      // convenience; Escape and the explicit close control already cover
      // keyboard/AT users, so this does not need to be a focusable control.
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-pop animate-slide-up',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
