import { useCallback, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { readCustomFolders, writeCustomFolders } from '@/lib/folders'

export function useCustomFolders() {
  const { scope } = useAuth()
  const [folders, setFolders] = useState<string[]>(() => readCustomFolders(scope))

  // Lazy `useState` init only runs once, on mount. Without the check below, a
  // guest->authenticated transition (scope changes) keeps the previous
  // scope's folders in memory, and the next add/removeFolder call writes
  // them into the *new* scope's storage key, clobbering it. Adjusting state
  // during render (React's recommended pattern for "reset state when a prop
  // changes") re-reads synchronously instead of via an effect.
  const [prevScope, setPrevScope] = useState(scope)
  if (scope !== prevScope) {
    setPrevScope(scope)
    setFolders(readCustomFolders(scope))
  }

  const addFolder = useCallback(
    (name: string) => {
      setFolders((prev) => {
        const next = [...prev, name]
        writeCustomFolders(scope, next)
        return next
      })
    },
    [scope],
  )

  const removeFolder = useCallback(
    (name: string) => {
      setFolders((prev) => {
        const next = prev.filter((f) => f !== name)
        writeCustomFolders(scope, next)
        return next
      })
    },
    [scope],
  )

  return { folders, addFolder, removeFolder }
}
