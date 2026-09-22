import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useAppActions } from '@/context/AppActionsContext'
import { useAuth } from '@/context/AuthContext'
import { useT } from '@/context/I18nContext'
import { useRefreshAiUsage } from '@/hooks/useAiUsage'
import { useWords } from '@/hooks/useWords'
import { AiDailyLimitError } from '@/lib/errors'
import { aiChat, type ChatTurn } from '@/lib/supabase/ai'
import { cn } from '@/lib/cn'
import { parseChatReply, type ChatAction } from './actions'
import type { TranslationKey } from '@/i18n'

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  /** Rendered under the bubble when the assistant acted on the app. */
  actionNote?: string
}

const ACTION_NOTES: Record<ChatAction['kind'], TranslationKey> = {
  'start-quiz': 'chat-action-quiz',
  'start-flashcards': 'chat-action-flashcards',
  open: 'chat-action-open',
  'add-word': 'chat-action-add-word',
}

export function ChatWidget() {
  const t = useT()
  const { state } = useAuth()
  const { data: words = [] } = useWords()
  const refreshUsage = useRefreshAiUsage()
  const { dispatch } = useAppActions()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)

  const nextId = useRef(1)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    textareaRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const push = (message: Omit<Message, 'id'>): number => {
    const id = nextId.current++
    setMessages((prev) => [...prev, { ...message, id }])
    return id
  }

  const send = async () => {
    const content = input.trim()
    if (!content || sending) return

    // Captured before the new turn is appended: the endpoint takes the prior
    // exchange as history and the new message separately.
    const history: ChatTurn[] = messages
      .filter((message) => !message.pending)
      .map(({ role, content: text }) => ({ role, content: text }))

    push({ role: 'user', content })
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    if (state.status !== 'authenticated') {
      push({ role: 'assistant', content: t('chat-guest-notice') })
      return
    }

    const pendingId = push({ role: 'assistant', content: t('chat-thinking'), pending: true })
    setSending(true)

    try {
      const data = await aiChat(content, words, history)
      const { text: reply, actions } = parseChatReply(data.response ?? '')
      const [action] = actions

      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingId
            ? {
                ...message,
                content: reply || t('chat-no-response'),
                pending: false,
                actionNote: action ? t(ACTION_NOTES[action.kind]) : undefined,
              }
            : message,
        ),
      )

      if (action) {
        setOpen(false)
        dispatch(action)
      }
    } catch (error) {
      const text = error instanceof AiDailyLimitError ? t('ai-limit-reached') : t('chat-error')
      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingId ? { ...message, content: text, pending: false } : message,
        ),
      )
    } finally {
      setSending(false)
      refreshUsage()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('open-chat')}
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-40 flex h-[54px] w-[54px] items-center justify-center rounded-full bg-brand text-white shadow-pop transition hover:bg-brand-hover"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('open-chat')}
          className="fixed bottom-[88px] right-6 z-40 flex h-[min(560px,calc(100vh-140px))] w-[min(390px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-slide-up"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[15px] font-semibold text-fg">{t('chat-title')}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="rounded-lg p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <X size={17} />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto scrollbar-slim px-4 py-4">
            {messages.length === 0 && (
              <p className="mt-6 text-center text-[13.5px] leading-relaxed text-fg-muted">
                {t('chat-empty')}
              </p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(message.role === 'user' && 'flex flex-col items-end')}
              >
                <div
                  className={cn(
                    'max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
                    message.role === 'user'
                      ? 'ml-auto bg-brand text-white'
                      : 'bg-surface-2 text-fg',
                    message.pending && 'text-fg-subtle',
                  )}
                >
                  {message.content}
                </div>
                {message.actionNote && (
                  <p className="mt-1 text-[12.5px] font-medium text-brand">{message.actionNote}</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-end gap-2 border-t border-line px-3 py-3">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder={t('chat-placeholder')}
              onChange={(event) => {
                setInput(event.target.value)
                const el = event.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              className="max-h-[140px] min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || input.trim() === ''}
              aria-label={t('chat-send')}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-hover disabled:opacity-50"
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
