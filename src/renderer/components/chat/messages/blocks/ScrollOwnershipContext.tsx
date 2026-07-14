/**
 * Scroll-ownership context — identifies the DOM scroller whose stability is
 * owned by the message-list runtime.
 *
 * Inside the virtual list, `chatVirtualizerRuntime` is the single `scrollTop`
 * writer: while it drives (top-pin, bottom-follow, smooth scroll) it keeps the
 * view coherent itself, and once the user takes over (any pointer/keyboard
 * interaction inside the scroller) it freezes the viewport centrally against
 * every layout change. Either way a block must never write that same scroller's
 * `scrollTop` — a second writer in the same frame is what used to jitter it.
 *
 * React context can cross portals and nested scroll containers, so provider
 * presence alone does not establish DOM ownership. Blocks compare their nearest
 * real scroll parent with `scrollContainerRef` before yielding to the runtime.
 */

import { createContext, type ReactNode, type RefObject, use, useCallback, useMemo } from 'react'

interface ScrollOwnership {
  scrollContainerRef: RefObject<HTMLElement | null>
  requestFollowRecovery: () => void
}

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)
const NOOP = () => {}

export const ScrollOwnershipProvider = ({
  children,
  scrollContainerRef,
  requestFollowRecovery = NOOP
}: {
  children: ReactNode
  scrollContainerRef: RefObject<HTMLElement | null>
  requestFollowRecovery?: () => void
}) => {
  const value = useMemo(
    () => ({ requestFollowRecovery, scrollContainerRef }),
    [requestFollowRecovery, scrollContainerRef]
  )
  return <ScrollOwnershipContext value={value}>{children}</ScrollOwnershipContext>
}

/** Nearest actually-scrollable ancestor (overflow-y auto/scroll + scrollable content). */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/** Returns whether the runtime owns a specific DOM scroll container. */
export function useIsScrollRuntimeManaged(): (scrollContainer: HTMLElement | null) => boolean {
  const ownership = use(ScrollOwnershipContext)
  return useCallback(
    (scrollContainer) => scrollContainer !== null && scrollContainer === ownership?.scrollContainerRef.current,
    [ownership]
  )
}

/** Ask the owning runtime to resume following after a local disclosure settles. */
export function useRequestScrollFollowRecovery(anchorRef?: RefObject<HTMLElement | null>): () => void {
  const ownership = use(ScrollOwnershipContext)
  return useCallback(() => {
    if (!ownership) return
    if (anchorRef) {
      const scrollContainer = ownership.scrollContainerRef.current
      if (!anchorRef.current || !scrollContainer?.contains(anchorRef.current)) return
    }
    ownership.requestFollowRecovery()
  }, [anchorRef, ownership])
}
