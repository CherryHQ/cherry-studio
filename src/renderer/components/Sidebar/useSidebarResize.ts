import { useCallback, useEffect, useRef } from 'react'

import {
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_SNAP_THRESHOLD
} from './constants'

export function useSidebarResize(width: number, setWidth: (width: number) => void) {
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
      let snapTarget = width < SIDEBAR_FULL_THRESHOLD ? SIDEBAR_ICON_WIDTH : SIDEBAR_FULL_THRESHOLD

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return
        const nextWidth = moveEvent.clientX - containerLeft
        let resolvedWidth = snapTarget

        if (nextWidth < SIDEBAR_HIDDEN_THRESHOLD) {
          snapTarget = SIDEBAR_ICON_WIDTH
          resolvedWidth = 0
        } else if (nextWidth <= SIDEBAR_ICON_WIDTH) {
          snapTarget = SIDEBAR_ICON_WIDTH
          resolvedWidth = SIDEBAR_ICON_WIDTH
        } else if (nextWidth < SIDEBAR_FULL_THRESHOLD) {
          if (snapTarget === SIDEBAR_ICON_WIDTH && nextWidth >= SIDEBAR_SNAP_THRESHOLD) {
            snapTarget = SIDEBAR_FULL_THRESHOLD
          } else if (snapTarget === SIDEBAR_FULL_THRESHOLD && nextWidth <= SIDEBAR_SNAP_THRESHOLD) {
            snapTarget = SIDEBAR_ICON_WIDTH
          }
          resolvedWidth = snapTarget
        } else {
          snapTarget = SIDEBAR_FULL_THRESHOLD
          resolvedWidth = Math.min(SIDEBAR_MAX_WIDTH, nextWidth)
        }

        setWidth(resolvedWidth)
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
    [setWidth, width]
  )

  return { sidebarRef, startResizing }
}
