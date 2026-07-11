import { useCallback, useRef } from 'react'

import { findScrollParent, useIsScrollRuntimeManaged } from './ScrollOwnershipContext'

/**
 * Preserves the user's visual scroll position when an element's height changes
 * (e.g. accordion expand/collapse) inside a scroll container.
 *
 * Resolves the real scroller as the nearest scrollable ancestor — the virtualized
 * message list scrolls its own inner div, not the `overflow:hidden` `#messages`
 * wrapper, so a hardcoded `#messages` lookup would write `scrollTop` to a non-scroller (no-op).
 *
 * When that nearest scroller is the virtual list, the runtime owns stability
 * entirely (see {@link ScrollOwnershipContext}), so this hook writes nothing.
 * Nested scrollers and portal content keep the standalone rect-diff behavior
 * even though React context still reaches them.
 *
 * Usage:
 *   const { anchorRef, withScrollAnchor } = useScrollAnchor()
 *   <div ref={anchorRef}>...</div>
 *   onValueChange={(v) => withScrollAnchor(() => setValue(v))}
 */
export function useScrollAnchor<T extends HTMLElement = HTMLElement>() {
  const anchorRef = useRef<T>(null)
  const isRuntimeManaged = useIsScrollRuntimeManaged()

  const withScrollAnchor = useCallback(
    (update: () => void) => {
      const anchor = anchorRef.current
      if (!anchor) {
        update()
        return
      }

      const scrollContainer = findScrollParent(anchor)
      if (!scrollContainer) {
        update()
        return
      }

      // The list runtime keeps its own viewport stable against every layout
      // change. Yield only for that exact scroller; context may cross a portal
      // or include an independently scrollable descendant.
      if (isRuntimeManaged(scrollContainer)) {
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
    },
    [isRuntimeManaged]
  )

  return { anchorRef, withScrollAnchor }
}
