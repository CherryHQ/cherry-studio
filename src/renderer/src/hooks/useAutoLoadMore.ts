import type { RefObject } from 'react'
import { useEffect } from 'react'

interface UseAutoLoadMoreOptions {
  containerRef: RefObject<HTMLElement | null>
  itemCount: number
  hasMore: boolean
  isLoading: boolean
  loadMore: () => void
}

/**
 * Loads another page when the current content is too short to produce a scroll event.
 */
export function useAutoLoadMore({ containerRef, itemCount, hasMore, isLoading, loadMore }: UseAutoLoadMoreOptions) {
  useEffect(() => {
    if (!hasMore || isLoading) return

    const frameId = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container || container.clientHeight === 0) return

      if (container.scrollHeight <= container.clientHeight) {
        loadMore()
      }
    })

    return () => cancelAnimationFrame(frameId)
  }, [containerRef, hasMore, isLoading, itemCount, loadMore])
}
