import { usePersistCache } from '@data/hooks/useCache'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import {
  getHorizontalResizeDelta,
  getHorizontalResizeOrigin,
  getHorizontalResizeWidth,
  type HorizontalResizeOrigin
} from '@renderer/utils/horizontalGeometry'
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
  const dragStateRef = useRef<{
    origin: HorizontalResizeOrigin
    startClientX: number
  }>({
    origin: { fixedX: 0, handleEdge: 'right' },
    startClientX: 0
  })
  const paneWidth = clampResourceListPaneWidth(storedWidth ?? RESOURCE_LIST_PANE_DEFAULT_WIDTH)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--assistants-width', `${paneWidth}px`)
  }, [paneWidth])

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent, stop: () => void) => {
      const { origin, startClientX } = dragStateRef.current
      const nextWidth = getHorizontalResizeWidth(origin, moveEvent.clientX)
      const resizeDelta = getHorizontalResizeDelta(origin, startClientX, moveEvent.clientX)
      if (nextWidth < RESOURCE_LIST_PANE_MIN_WIDTH && resizeDelta <= -RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD) {
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
      const rect = paneRef.current?.getBoundingClientRect()
      dragStateRef.current = {
        origin: getHorizontalResizeOrigin(rect ?? { left: 0, right: RESOURCE_LIST_PANE_DEFAULT_WIDTH }, event.clientX),
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
