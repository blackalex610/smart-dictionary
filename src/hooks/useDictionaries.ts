import { useQuery } from '@tanstack/react-query'
import { listDictionaries } from '@/api/dictionaries'
import { useAuth } from '@/context/AuthContext'

export function useDictionaries() {
  const { scope, state } = useAuth()
  return useQuery({
    queryKey: ['dictionaries', scope],
    queryFn: () => listDictionaries().then((r) => r.items),
    enabled: state.status === 'authenticated',
    staleTime: 30_000,
  })
}
