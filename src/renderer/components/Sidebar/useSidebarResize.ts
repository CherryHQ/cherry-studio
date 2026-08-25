import { useCallback, useEffect, useRef } from 'react'

import {
  getSidebarDisplayWidth,
  isIntermediateSidebarWidth,
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH
} from './constants'

export function useSidebarResize(
  width: number,
  setWidth: (width: number) => void,
  onResizePreview?: (width: number | null) => void
) {
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
      const startWidth = getSidebarDisplayWidth(width)
      let lastWidth: number | null = null

      // Every frame of the drag is a preview; only the released width is persisted.
      // Dragging a full-width sidebar down to hidden sweeps through the icon band,
      // and persisting those frames would overwrite the width it restores to.
      const previewDragWidth = (nextWidth: number) => {
        lastWidth = nextWidth
        onResizePreview?.(nextWidth)
      }

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return
        const nextWidth = moveEvent.clientX - containerLeft

        if (nextWidth < SIDEBAR_HIDDEN_THRESHOLD) {
          previewDragWidth(0)
        } else if (nextWidth <= SIDEBAR_ICON_WIDTH) {
          previewDragWidth(SIDEBAR_ICON_WIDTH)
        } else {
          previewDragWidth(Math.min(SIDEBAR_MAX_WIDTH, nextWidth))
        }
      }

      const cleanup = () => {
        onResizePreview?.(null)
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseUp = () => {
        if (lastWidth !== null) {
          setWidth(
            isIntermediateSidebarWidth(lastWidth)
              ? lastWidth > startWidth
                ? SIDEBAR_FULL_THRESHOLD
                : SIDEBAR_ICON_WIDTH
              : lastWidth
          )
        }
        cleanup()
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [onResizePreview, setWidth, width]
  )

  return { sidebarRef, startResizing }
}
