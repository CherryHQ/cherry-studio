import { useCallback, useRef } from 'react'

/**
 * Preserves the user's visual scroll position when an element's height changes
 * (e.g. accordion expand/collapse) inside a `column-reverse` scroll container.
 *
 * Usage:
 *   const { anchorRef, withScrollAnchor } = useScrollAnchor()
 *   <div ref={anchorRef}>...</div>
 *   onValueChange={(v) => withScrollAnchor(() => setValue(v))}
 */
export function useScrollAnchor<T extends HTMLElement = HTMLElement>() {
  const anchorRef = useRef<T>(null)

  const withScrollAnchor = useCallback((update: () => void) => {
    const anchor = anchorRef.current
    if (!anchor) {
      update()
      return
    }

    const scrollContainer = anchor.closest('#messages')
    if (!scrollContainer) {
      update()
      return
    }

    // Record position of the anchor relative to viewport before DOM change
    const rectBefore = anchor.getBoundingClientRect()
    const scrollBefore = scrollContainer.scrollTop

    // Apply the state change
    update()

    // After React commits the state change, restore scroll position
    // Use requestAnimationFrame to run after the paint
    requestAnimationFrame(() => {
      const rectAfter = anchor.getBoundingClientRect()
      const drift = rectAfter.top - rectBefore.top
      scrollContainer.scrollTop = scrollBefore + drift
    })
  }, [])

  return { anchorRef, withScrollAnchor }
}
