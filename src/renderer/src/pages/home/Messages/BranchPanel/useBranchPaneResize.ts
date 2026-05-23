import { useCallback, useEffect, useRef, useState } from 'react'

import { BRANCH_PANE_MAX_WIDTH, BRANCH_PANE_MIN_WIDTH } from './constants'

/**
 * useBranchPaneResize — mirror of `components/Sidebar/useSidebarResize` for a
 * right-anchored panel.
 *
 * The branch pane sits at the right edge of the chat row; its drag handle
 * lives on the LEFT edge of the pane. Dragging left enlarges the pane (mirror
 * of the sidebar where dragging right enlarges). Width is clamped to
 * [BRANCH_PANE_MIN_WIDTH, BRANCH_PANE_MAX_WIDTH]; we do not collapse-to-zero
 * by drag (the only path to close is the X button — keeps the gesture
 * intent unambiguous).
 *
 * `getCurrentWidth` is a stable ref-style getter so the hook captures the
 * width at drag-start without re-creating the listener on every state tick.
 * Returns `isResizing` so the caller can suppress framer-motion's open/close
 * transition while dragging (otherwise the 0.3s ease would make the pane
 * feel disconnected from the cursor).
 */
export function useBranchPaneResize(setWidth: (width: number) => void, getCurrentWidth: () => number) {
  const isResizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const startResizing = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      isResizingRef.current = true
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      // Capture the drag-start frame: cursor x + width at that moment. The
      // panel is right-anchored, so dx = startX − currentX (positive when
      // the cursor moves left).
      const startX = event.clientX
      const startWidth = getCurrentWidth()

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return
        const dx = startX - moveEvent.clientX
        const nextWidth = startWidth + dx
        setWidth(Math.min(BRANCH_PANE_MAX_WIDTH, Math.max(BRANCH_PANE_MIN_WIDTH, nextWidth)))
      }

      const cleanup = () => {
        isResizingRef.current = false
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        cleanupRef.current = null
      }

      const onMouseUp = () => cleanup()

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      cleanupRef.current = cleanup
    },
    [setWidth, getCurrentWidth]
  )

  return { isResizing, startResizing }
}
