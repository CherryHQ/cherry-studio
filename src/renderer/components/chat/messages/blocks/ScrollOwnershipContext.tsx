/**
 * Scroll-ownership context — identifies the DOM scroller whose stability is
 * owned by the message-list runtime.
 *
 * Inside the virtual list, `chatVirtualizerRuntime` owns product-level scroll
 * intent and reconciles virtualizer adjustments. Blocks never write that same
 * scroller's `scrollTop`; explicit disclosures instead ask the runtime to enter
 * reading mode and preserve their semantic anchor.
 *
 * React context can cross portals and nested scroll containers, so provider
 * presence alone does not establish DOM ownership. Blocks compare their nearest
 * real scroll parent with `scrollContainerRef` before yielding to the runtime.
 */

import { createContext, type ReactNode, type RefObject, use, useCallback, useMemo } from 'react'

interface ScrollOwnership {
  scrollContainerRef: RefObject<HTMLElement | null>
  requestReadingControl: (anchor: HTMLElement | null) => void
  scrollToElement: (element: HTMLElement, align?: 'start' | 'center') => void
}

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)
const NOOP: (anchor: HTMLElement | null) => void = () => {}

export const ScrollOwnershipProvider = ({
  children,
  scrollContainerRef,
  requestReadingControl = NOOP,
  scrollToElement = NOOP
}: {
  children: ReactNode
  scrollContainerRef: RefObject<HTMLElement | null>
  requestReadingControl?: (anchor: HTMLElement | null) => void
  scrollToElement?: (element: HTMLElement, align?: 'start' | 'center') => void
}) => {
  const value = useMemo(
    () => ({ requestReadingControl, scrollContainerRef, scrollToElement }),
    [requestReadingControl, scrollContainerRef, scrollToElement]
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

/** Ask the owning runtime to preserve a disclosure as the reading anchor. */
export function useRequestScrollReadingControl(anchorRef: RefObject<HTMLElement | null>): () => void {
  const ownership = use(ScrollOwnershipContext)
  return useCallback(() => {
    if (!ownership) return
    const anchor = anchorRef.current
    const scrollContainer = ownership.scrollContainerRef.current
    if (!anchor || !scrollContainer?.contains(anchor)) return
    ownership.requestReadingControl(anchor)
  }, [anchorRef, ownership])
}

/** Route outer-list navigation through its runtime; leave nested scrollers local. */
export function useScrollRuntimeNavigation(): (element: HTMLElement, align?: 'start' | 'center') => boolean {
  const ownership = use(ScrollOwnershipContext)
  return useCallback(
    (element, align) => {
      if (!ownership) return false
      const scrollContainer = ownership.scrollContainerRef.current
      if (!scrollContainer?.contains(element) || findScrollParent(element) !== scrollContainer) return false
      ownership.scrollToElement(element, align)
      return true
    },
    [ownership]
  )
}
