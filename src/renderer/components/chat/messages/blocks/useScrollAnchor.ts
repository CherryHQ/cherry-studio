import { useCallback, useRef } from 'react'

import { useIsScrollOwned } from './ScrollOwnershipContext'

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
 * Yields to the message-list runtime while it owns `scrollTop` (streaming,
 * bottom-follow, smooth scroll) via `useIsScrollOwned` — otherwise both would
 * write `scrollTop` in the same frame to different targets and jitter the
 * scrollbar. See {@link ScrollOwnershipContext}.
 *
 * Usage:
 *   const { anchorRef, withScrollAnchor } = useScrollAnchor()
 *   <div ref={anchorRef}>...</div>
 *   onValueChange={(v) => withScrollAnchor(() => setValue(v))}
 */
export function useScrollAnchor<T extends HTMLElement = HTMLElement>() {
  const anchorRef = useRef<T>(null)
  const isScrollOwned = useIsScrollOwned()

  const withScrollAnchor = useCallback(
    (update: () => void) => {
      // Yield to the message-list runtime while it owns scrollTop (a streaming
      // top-pin or its bottom-follow, at-bottom auto-stick, or an in-flight
      // smooth scroll). Restoring our own anchored scrollTop in the same frame the
      // runtime writes its — to a different target — is what makes the scrollbar
      // jitter on expand/collapse during streaming. Apply the state change and let
      // the runtime keep the view coherent. Outside the virtual list there is no
      // provider, so `isScrollOwned` is always false and the standalone anchor
      // behavior below is preserved.
      if (isScrollOwned()) {
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
    [isScrollOwned]
  )

  return { anchorRef, withScrollAnchor }
}
