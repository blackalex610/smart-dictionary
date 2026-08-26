import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useT } from '@/context/I18nContext'

const THRESHOLD = 200

export function BackToTop() {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > THRESHOLD)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t('back-to-top')}
      className="fixed bottom-[88px] right-6 z-30 flex h-[42px] w-[42px] items-center justify-center rounded-full border border-line bg-surface text-fg-muted shadow-raised transition hover:text-brand animate-fade-in"
    >
      <ArrowUp size={18} />
    </button>
  )
}
