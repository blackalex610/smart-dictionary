import { useCallback, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { readCustomFolders, writeCustomFolders } from '@/lib/folders'

export function useCustomFolders() {
  const { scope } = useAuth()
  const [folders, setFolders] = useState<string[]>(() => readCustomFolders(scope))

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
