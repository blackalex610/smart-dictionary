import { useRef } from 'react'
import { useDialogFocus } from '@/hooks/useDialogFocus'
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
  useDialogFocus(open, panelRef, onClose)

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
        tabIndex={-1}
        className={cn(
          'max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-pop animate-slide-up focus:outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
