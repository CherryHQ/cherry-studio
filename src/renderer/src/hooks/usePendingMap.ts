import { useCache } from '@data/hooks/useCache'
import { useCallback } from 'react'

export const usePendingMap = () => {
  const [pendingMap, setPendingMap] = useCache('app.pending_map')

  const setPending = useCallback(
    (id: string, value: boolean | undefined) => {
      if (value !== undefined) {
        setPendingMap({
          ...pendingMap,
          [id]: value
        })
      } else {
        const newMap = { ...pendingMap }
        delete newMap[id]
        setPendingMap(newMap)
      }
    },
    [pendingMap, setPendingMap]
  )

  const isPending = useCallback(
    (id: string) => {
      return pendingMap[id]
    },
    [pendingMap]
  )

  return { pendingMap, setPending, isPending }
}
