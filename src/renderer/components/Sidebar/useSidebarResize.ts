import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { useCallback, useRef } from 'react'

import {
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_VERTICAL_CARD_WIDTH
} from './constants'

export function useSidebarResize(setWidth: (width: number) => void) {
  const sidebarRef = useRef<HTMLDivElement>(null)
  const containerLeftRef = useRef(0)

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent) => {
      const nextWidth = moveEvent.clientX - containerLeftRef.current
      if (nextWidth < SIDEBAR_HIDDEN_THRESHOLD) setWidth(0)
      else if (nextWidth < SIDEBAR_ICON_THRESHOLD) setWidth(SIDEBAR_ICON_WIDTH)
      else if (nextWidth < SIDEBAR_FULL_THRESHOLD) setWidth(SIDEBAR_VERTICAL_CARD_WIDTH)
      else setWidth(Math.min(SIDEBAR_MAX_WIDTH, nextWidth))
    },
    [setWidth]
  )

  const { startResizing: startResizeDrag } = useResizeDrag({ onMove: handleMouseMove })

  const startResizing = useCallback(
    (event: React.MouseEvent) => {
      containerLeftRef.current = sidebarRef.current?.parentElement?.getBoundingClientRect().left ?? 0
      startResizeDrag(event)
    },
    [startResizeDrag]
  )

  return { sidebarRef, startResizing }
}
