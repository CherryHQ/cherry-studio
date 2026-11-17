import { useCallback, useRef } from 'react'

export function useCloseBeforeAction(
  onOpenChange: (open: boolean) => boolean | void | Promise<boolean | void>
): (action: () => void) => void {
  const pendingFrameIdsRef = useRef(new Set<number>())

  return useCallback(
    (action: () => void) => {
      const scheduleAction = (closed: boolean | void) => {
        if (closed === false) return
        const pendingFrame: { completedSynchronously: boolean; id?: number } = { completedSynchronously: false }
        pendingFrame.id = window.requestAnimationFrame(() => {
          pendingFrame.completedSynchronously = true
          if (pendingFrame.id !== undefined) {
            pendingFrameIdsRef.current.delete(pendingFrame.id)
          }
          action()
        })
        if (!pendingFrame.completedSynchronously) {
          pendingFrameIdsRef.current.add(pendingFrame.id)
        }
      }
      const closed = onOpenChange(false)
      if (closed instanceof Promise) {
        void closed.then(scheduleAction)
      } else {
        scheduleAction(closed)
      }
    },
    [onOpenChange]
  )
}
