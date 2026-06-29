import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizeDragOptions {
  onMove: (event: MouseEvent, stop: () => void) => void
}

export function useResizeDrag({ onMove }: UseResizeDragOptions) {
  const onMoveRef = useRef(onMove)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    return () => cleanupRef.current?.()
  }, [])

  const startResizing = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    cleanupRef.current?.()

    let active = true
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
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
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('mouseleave', cleanup)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', cleanup)
    cleanupRef.current = cleanup
  }, [])

  return {
    isResizing,
    startResizing
  }
}
