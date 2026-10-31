import { createContext, type RefObject, use, useCallback } from 'react'

/**
 * Identifies the DOM scroller owned by a host runtime; hosts such as virtual lists mount a Provider, and consumers compare their actual scroll parent.
 * Shared components such as CodeViewer must depend on this module, not domain internals (renderer architecture §2).
 * Without a Provider, ownership is null and consumers treat the scroller as unowned without throwing.
 */
export interface ScrollViewportOwnership {
  scrollContainerRef: RefObject<HTMLElement | null>
}

export const ScrollViewportOwnershipContext = createContext<ScrollViewportOwnership | null>(null)

/** Raw accessor; null when no owner is mounted. */
export function useScrollViewportOwnership(): ScrollViewportOwnership | null {
  return use(ScrollViewportOwnershipContext)
}

/** Returns a predicate: does the owner runtime own this exact element? */
export function useIsScrollViewportOwned(): (scrollContainer: HTMLElement | null) => boolean {
  const ownership = useScrollViewportOwnership()
  return useCallback(
    (scrollContainer) => scrollContainer !== null && scrollContainer === ownership?.scrollContainerRef.current,
    [ownership]
  )
}
