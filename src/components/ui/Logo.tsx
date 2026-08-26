import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand',
        className,
      )}
      aria-hidden="true"
    >
      <svg width="19" height="19" viewBox="0 0 20 20" fill="none" role="presentation">
        <path
          d="M3 4.4c0-.66.54-1.2 1.2-1.2h2.9A2.9 2.9 0 0 1 10 6.1v9.3a2.2 2.2 0 0 0-1.8-1.1H4.2A1.2 1.2 0 0 1 3 13.1V4.4Z"
          fill="#fff"
        />
        <path
          d="M17 4.4c0-.66-.54-1.2-1.2-1.2h-2.9A2.9 2.9 0 0 0 10 6.1v9.3a2.2 2.2 0 0 1 1.8-1.1h4A1.2 1.2 0 0 0 17 13.1V4.4Z"
          fill="#fff"
        />
      </svg>
    </span>
  )
}
