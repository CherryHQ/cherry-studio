import { useCallback, useEffect, useRef } from 'react'

import {
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_VERTICAL_CARD_WIDTH
} from './constants'

export function useSidebarResize(setWidth: (width: number) => void) {
  const isResizing = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => resizeCleanupRef.current?.()
  }, [])

  const startResizing = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      isResizing.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const containerLeft = sidebarRef.current?.parentElement?.getBoundingClientRect().left ?? 0

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return
        const nextWidth = moveEvent.clientX - containerLeft
        if (nextWidth < SIDEBAR_HIDDEN_THRESHOLD) setWidth(0)
        else if (nextWidth < SIDEBAR_ICON_THRESHOLD) setWidth(SIDEBAR_ICON_WIDTH)
        else if (nextWidth < SIDEBAR_FULL_THRESHOLD) setWidth(SIDEBAR_VERTICAL_CARD_WIDTH)
        else setWidth(Math.min(SIDEBAR_MAX_WIDTH, nextWidth))
      }

      const cleanup = () => {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseUp = () => cleanup()

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [setWidth]
  )

  return { sidebarRef, startResizing }
}
