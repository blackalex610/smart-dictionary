import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { VIEW_ROUTES, type ChatAction } from '@/features/chat/actions'

type ActionKind = ChatAction['kind']
type Handler = (action: ChatAction) => void

interface AppActionsValue {
  /** Routes to the view the action targets and hands it to that view's handler. */
  dispatch: (action: ChatAction) => void
  register: (kind: ActionKind, handler: Handler) => () => void
}

const AppActionsContext = createContext<AppActionsValue | null>(null)

const ROUTE_FOR: Record<Exclude<ActionKind, 'open'>, string> = {
  'start-quiz': VIEW_ROUTES.tests,
  'start-flashcards': VIEW_ROUTES.flashcards,
  'add-word': VIEW_ROUTES.dictionary,
}

/**
 * Lets the chat assistant drive the rest of the app. An action is parked, the
 * user is sent to the matching view, and that view's handler runs as soon as it
 * has registered — which may be before or after the navigation completes.
 */
export function AppActionsProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const pendingRef = useRef<ChatAction | null>(null)
  const handlersRef = useRef(new Map<ActionKind, Handler>())

  const drain = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    const handler = handlersRef.current.get(pending.kind)
    if (!handler) return
    pendingRef.current = null
    handler(pending)
  }, [])

  const register = useCallback(
    (kind: ActionKind, handler: Handler) => {
      handlersRef.current.set(kind, handler)
      queueMicrotask(drain)
      return () => {
        if (handlersRef.current.get(kind) === handler) handlersRef.current.delete(kind)
      }
    },
    [drain],
  )

  const dispatch = useCallback(
    (action: ChatAction) => {
      if (action.kind === 'open') {
        navigate(VIEW_ROUTES[action.view])
        return
      }
      pendingRef.current = action
      navigate(ROUTE_FOR[action.kind])
      // The target view may already be mounted, in which case navigating does
      // not remount it and nothing new registers — so try to deliver now too.
      queueMicrotask(drain)
    },
    [navigate, drain],
  )

  const value = useMemo(() => ({ dispatch, register }), [dispatch, register])

  return <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>
}

function useAppActionsContext(): AppActionsValue {
  const value = useContext(AppActionsContext)
  if (!value) throw new Error('useAppActions must be used inside AppActionsProvider')
  return value
}

export function useAppActions(): Pick<AppActionsValue, 'dispatch'> {
  return useAppActionsContext()
}

/** Runs `handler` when the assistant dispatches an action of `kind`. */
export function useAppAction<K extends ActionKind>(
  kind: K,
  handler: (action: Extract<ChatAction, { kind: K }>) => void,
): void {
  const { register } = useAppActionsContext()
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(
    () =>
      register(kind, (action) => handlerRef.current(action as Extract<ChatAction, { kind: K }>)),
    [register, kind],
  )
}
