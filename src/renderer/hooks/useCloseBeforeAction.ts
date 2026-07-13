import { useCallback } from 'react'

export function useCloseBeforeAction(onOpenChange: (open: boolean) => void): (action: () => void) => void {
  return useCallback(
    (action: () => void) => {
      onOpenChange(false)
      window.requestAnimationFrame(action)
    },
    [onOpenChange]
  )
}
