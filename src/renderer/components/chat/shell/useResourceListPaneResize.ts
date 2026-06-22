import { usePersistCache } from '@data/hooks/useCache'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import {
  RESOURCE_LIST_PANE_CACHE_KEY,
  RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD,
  RESOURCE_LIST_PANE_DEFAULT_WIDTH,
  RESOURCE_LIST_PANE_MAX_WIDTH,
  RESOURCE_LIST_PANE_MIN_WIDTH
} from './paneLayout'

export function clampResourceListPaneWidth(width: number): number {
  return Math.min(RESOURCE_LIST_PANE_MAX_WIDTH, Math.max(RESOURCE_LIST_PANE_MIN_WIDTH, Math.round(width)))
}

interface ResourceListPaneResizeOptions {
  onPaneCollapse?: () => void
}

export function useResourceListPaneResize({ onPaneCollapse }: ResourceListPaneResizeOptions = {}) {
  const [storedWidth, setStoredWidth] = usePersistCache(RESOURCE_LIST_PANE_CACHE_KEY)
  const paneRef = useRef<HTMLDivElement>(null)
  const pendingPaneCollapseRef = useRef(false)
  const dragStateRef = useRef({ paneLeft: 0, startClientX: 0 })
  const paneWidth = clampResourceListPaneWidth(storedWidth ?? RESOURCE_LIST_PANE_DEFAULT_WIDTH)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--assistants-width', `${paneWidth}px`)
  }, [paneWidth])

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent, stop: () => void) => {
      const { paneLeft, startClientX } = dragStateRef.current
      const nextWidth = moveEvent.clientX - paneLeft
      const dragDelta = moveEvent.clientX - startClientX
      if (nextWidth < RESOURCE_LIST_PANE_MIN_WIDTH && dragDelta <= -RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD) {
        setStoredWidth(RESOURCE_LIST_PANE_DEFAULT_WIDTH)
        pendingPaneCollapseRef.current = true
        stop()
        return
      }
      setStoredWidth(clampResourceListPaneWidth(nextWidth))
    },
    [setStoredWidth]
  )

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({ onMove: handleMouseMove })

  useEffect(() => {
    if (isResizing || !pendingPaneCollapseRef.current) return

    pendingPaneCollapseRef.current = false
    onPaneCollapse?.()
  }, [isResizing, onPaneCollapse])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      dragStateRef.current = {
        paneLeft: paneRef.current?.getBoundingClientRect().left ?? 0,
        startClientX: event.clientX
      }
      startResizeDrag(event)
    },
    [startResizeDrag]
  )

  const setPaneWidth = useCallback(
    (nextWidth: number) => setStoredWidth(clampResourceListPaneWidth(nextWidth)),
    [setStoredWidth]
  )

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing,
    setPaneWidth
  }
}
