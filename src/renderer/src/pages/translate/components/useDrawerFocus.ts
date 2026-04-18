import type { RefObject } from 'react'
import { useEffect } from 'react'

/**
 * Minimal drawer focus management for the translate page.
 * - On open: remember previously focused element, move focus to the first
 *   interactive element inside the drawer.
 * - On close/unmount: restore focus to the previously focused element.
 * Does not implement a focus trap — Tab can still escape; we accept this
 * because our drawers are non-modal panels inside the translate page.
 */
export function useDrawerFocus(open: boolean, containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const focusable = containerRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [role="button"], [tabindex="0"], input:not([disabled]), textarea:not([disabled])'
      )
      focusable?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [open, containerRef])
}
