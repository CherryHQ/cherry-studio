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

    const container = containerRef.current
    if (!container) return

    let frameId: number | null = null

    const scheduleMeasurement = () => {
      if (frameId !== null) return

      frameId = requestAnimationFrame(() => {
        frameId = null
        if (container.clientHeight === 0) return

        if (container.scrollHeight <= container.clientHeight) {
          loadMore()
        }
      })
    }

    const resizeObserver = new ResizeObserver(scheduleMeasurement)
    resizeObserver.observe(container)
    scheduleMeasurement()

    return () => {
      resizeObserver.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [containerRef, hasMore, isLoading, itemCount, loadMore])
}
