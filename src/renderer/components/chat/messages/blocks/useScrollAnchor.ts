import { useCallback, useRef } from 'react'

import { useIsScrollRuntimeManaged } from './ScrollOwnershipContext'

/** Nearest actually-scrollable ancestor (overflow-y auto/scroll + scrollable content). */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Preserves the user's visual scroll position when an element's height changes
 * (e.g. accordion expand/collapse) inside a scroll container.
 *
 * Resolves the real scroller as the nearest scrollable ancestor — the virtualized
 * message list scrolls its own inner div, not the `overflow:hidden` `#messages`
 * wrapper, so a hardcoded `#messages` lookup would write `scrollTop` to a non-scroller (no-op).
 *
 * Inside the virtual list the runtime owns scroll stability entirely (it freezes
 * the viewport on user takeover and drives it otherwise — see
 * {@link ScrollOwnershipContext}), so the update applies directly and this hook
 * writes nothing. Only outside the list (no provider) does the standalone
 * rect-diff restore below run.
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
      // The message-list runtime keeps the viewport stable against every layout
      // change (including this one); a second scrollTop writer in the same frame
      // is exactly what used to jitter the scrollbar.
      if (isRuntimeManaged) {
        update()
        return
      }

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
