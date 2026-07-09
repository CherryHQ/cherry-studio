import { useCallback, useRef } from 'react'

import { useScrollOwnership } from './ScrollOwnershipContext'

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
 * bottom-follow, smooth scroll) via `useScrollOwnership` — otherwise both would
 * write `scrollTop` in the same frame to different targets and jitter the
 * scrollbar. See {@link ScrollOwnershipContext}.
 *
 * Pass `{ takeScrollOwnership: true }` on an EXPAND: the user wants to read the
 * freshly revealed content, so we ask the runtime to relinquish bottom-follow and
 * then hold our own position instead of letting the live stream scroll it away.
 *
 * Usage:
 *   const { anchorRef, withScrollAnchor } = useScrollAnchor()
 *   <div ref={anchorRef}>...</div>
 *   onValueChange={(v) => withScrollAnchor(() => setValue(v), { takeScrollOwnership: !!v })}
 */
export function useScrollAnchor<T extends HTMLElement = HTMLElement>() {
  const anchorRef = useRef<T>(null)
  const { isScrollOwned, releaseScrollOwnership } = useScrollOwnership()

  const withScrollAnchor = useCallback(
    (update: () => void, options?: { takeScrollOwnership?: boolean }) => {
      // Yield to the message-list runtime while it owns scrollTop (a streaming
      // top-pin or its bottom-follow, at-bottom auto-stick, or an in-flight
      // smooth scroll). Restoring our own anchored scrollTop in the same frame the
      // runtime writes its — to a different target — is what makes the scrollbar
      // jitter on expand/collapse during streaming. Apply the state change and let
      // the runtime keep the view coherent. Outside the virtual list there is no
      // provider, so `isScrollOwned` is always false and the standalone anchor
      // behavior below is preserved.
      if (isScrollOwned()) {
        // An explicit expand is a user intent to READ this block: ask the runtime
        // to hand back bottom-follow ownership so the stream stops scrolling the
        // revealed content away. It keeps an active top-pin (already stable), so
        // re-check ownership — if still owned, yield as before.
        if (options?.takeScrollOwnership) releaseScrollOwnership()
        if (isScrollOwned()) {
          update()
          return
        }
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
    [isScrollOwned, releaseScrollOwnership]
  )

  return { anchorRef, withScrollAnchor }
}
