import type { CursorPaginationResponse, ResourceListBand } from '@shared/data/api/types'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type AnchoredResourceWindow<T> = {
  anchorId: string
  band: ResourceListBand
  groupId: string
  items: T[]
  previousCursor?: string
  nextCursor?: string
}

type WindowIdentity = Pick<AnchoredResourceWindow<unknown>, 'band' | 'groupId'>

export function useAnchoredResourceWindow<T>({
  fetchPage,
  getItemId,
  resetKey
}: {
  fetchPage: (identity: WindowIdentity, cursor: string) => Promise<CursorPaginationResponse<T>>
  getItemId: (item: T) => string
  resetKey: string
}) {
  const [window, setWindow] = useState<AnchoredResourceWindow<T> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const windowRef = useRef(window)
  const generationRef = useRef(0)
  const pendingRef = useRef(new Map<'next' | 'previous', number>())
  const pendingTokenRef = useRef(0)

  useLayoutEffect(() => {
    windowRef.current = window
  }, [window])

  const clear = useCallback(() => {
    generationRef.current += 1
    pendingRef.current.clear()
    setIsLoading(false)
    windowRef.current = null
    setWindow(null)
  }, [])

  useEffect(() => clear(), [clear, resetKey])

  const replace = useCallback((next: AnchoredResourceWindow<T>) => {
    generationRef.current += 1
    pendingRef.current.clear()
    setIsLoading(false)
    windowRef.current = next
    setWindow(next)
  }, [])

  const load = useCallback(
    async (groupId: string, direction: 'next' | 'previous') => {
      const current = windowRef.current
      if (!current || current.groupId !== groupId || pendingRef.current.has(direction)) return
      const cursor = direction === 'previous' ? current.previousCursor : current.nextCursor
      if (!cursor) return

      const pendingToken = ++pendingTokenRef.current
      pendingRef.current.set(direction, pendingToken)
      setIsLoading(true)
      const generation = generationRef.current
      try {
        const page = await fetchPage({ band: current.band, groupId: current.groupId }, cursor)
        if (generationRef.current !== generation) return

        setWindow((latest) => {
          if (!latest || latest.groupId !== groupId) return latest
          const ordered = direction === 'previous' ? [...page.items, ...latest.items] : [...latest.items, ...page.items]
          const byId = new Map<string, T>()
          for (const item of ordered) byId.set(getItemId(item), item)
          const next = {
            ...latest,
            items: [...byId.values()],
            previousCursor: direction === 'previous' ? page.previousCursor : latest.previousCursor,
            nextCursor: direction === 'next' ? page.nextCursor : latest.nextCursor
          }
          windowRef.current = next
          return next
        })
      } finally {
        if (pendingRef.current.get(direction) === pendingToken) {
          pendingRef.current.delete(direction)
          setIsLoading(pendingRef.current.size > 0)
        }
      }
    },
    [fetchPage, getItemId]
  )

  const loadMoreGroup = useCallback((groupId: string) => load(groupId, 'next'), [load])
  const loadPreviousGroup = useCallback((groupId: string) => load(groupId, 'previous'), [load])

  return { clear, isLoading, loadMoreGroup, loadPreviousGroup, replace, window }
}
