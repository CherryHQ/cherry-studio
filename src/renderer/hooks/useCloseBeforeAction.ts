import { useCallback } from 'react'

export function useCloseBeforeAction(
  onOpenChange: (open: boolean) => boolean | void | Promise<boolean | void>
): (action: () => void) => void {
  return useCallback(
    (action: () => void) => {
      const scheduleAction = (closed: boolean | void) => {
        if (closed === false) return
        window.requestAnimationFrame(() => action())
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
