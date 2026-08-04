import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizeDragOptions {
  onMove: (event: MouseEvent, stop: () => void) => void
  /** Called exactly once when a drag ends, however it ends (mouseup, blur,
   *  visibilitychange, mouseleave, unmount, or onMove calling stop()). */
  onEnd?: () => void
  cursor?: CSSProperties['cursor']
}

export function useResizeDrag({ onMove, onEnd, cursor = 'col-resize' }: UseResizeDragOptions) {
  const onMoveRef = useRef(onMove)
  const onEndRef = useRef(onEnd)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    onEndRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    return () => cleanupRef.current?.()
  }, [])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      cleanupRef.current?.()

      let active = true
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = cursor
      document.body.style.userSelect = 'none'
      setIsResizing(true)

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!active) return
        onMoveRef.current(moveEvent, cleanup)
      }

      let cleanup = () => {}

      const onVisibilityChange = () => {
        if (document.hidden) cleanup()
      }

      cleanup = () => {
        if (!active) return

        active = false
        setIsResizing(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', cleanup)
        document.removeEventListener('mouseleave', cleanup)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('blur', cleanup)
        if (cleanupRef.current === cleanup) cleanupRef.current = null
        onEndRef.current?.()
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', cleanup)
      document.addEventListener('mouseleave', cleanup)
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('blur', cleanup)
      cleanupRef.current = cleanup
    },
    [cursor]
  )

  return {
    isResizing,
    startResizing
  }
}
