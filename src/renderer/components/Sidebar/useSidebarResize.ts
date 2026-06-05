import { useCallback, useEffect, useRef } from 'react'

import {
  getSidebarDisplayWidth,
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_RELEASE_DELTA
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
      const startLayout = width >= SIDEBAR_FULL_THRESHOLD ? 'full' : 'icon'
      const startWidth = getSidebarDisplayWidth(width)
      let lastWidth: number | null = null

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return
        const nextWidth = moveEvent.clientX - containerLeft

        if (nextWidth < SIDEBAR_HIDDEN_THRESHOLD) {
          lastWidth = 0
        } else if (nextWidth <= SIDEBAR_ICON_WIDTH) {
          lastWidth = SIDEBAR_ICON_WIDTH
        } else {
          lastWidth = Math.min(SIDEBAR_MAX_WIDTH, nextWidth)
        }

        setWidth(lastWidth)
      }

      const cleanup = () => {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseUp = () => {
        if (lastWidth !== null && lastWidth > SIDEBAR_ICON_WIDTH && lastWidth < SIDEBAR_FULL_THRESHOLD) {
          let nextWidth = startLayout === 'full' ? SIDEBAR_FULL_THRESHOLD : SIDEBAR_ICON_WIDTH

          if (startLayout === 'icon' && lastWidth - startWidth > SIDEBAR_RELEASE_DELTA) {
            nextWidth = SIDEBAR_FULL_THRESHOLD
          } else if (startLayout === 'full' && startWidth - lastWidth > SIDEBAR_RELEASE_DELTA) {
            nextWidth = SIDEBAR_ICON_WIDTH
          }

          setWidth(nextWidth)
        }
        cleanup()
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [setWidth, width]
  )

  return { sidebarRef, startResizing }
}
