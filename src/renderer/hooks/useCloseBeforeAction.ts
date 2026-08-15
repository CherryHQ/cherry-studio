import { useCallback, useRef } from 'react'

export function useCloseBeforeAction(onOpenChange: (open: boolean) => void): (action: () => void) => void {
  const pendingFrameIdsRef = useRef(new Set<number>())

  return useCallback(
    (action: () => void) => {
      onOpenChange(false)
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
    },
    [onOpenChange]
  )
}
