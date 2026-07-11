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

import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState
} from 'react'

interface ScrollOwnership {
  scrollContainerRef: RefObject<HTMLElement | null>
  requestFollowRecovery: () => void
}

interface ScrollViewportGeometry {
  bottomInset: number
  scrollContainerRef: RefObject<HTMLElement | null>
}

interface ScrollViewportMaxHeightOptions {
  bottomGap?: number
  enabled: boolean
  maxViewportRatio?: number
  minHeight?: number
}

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)
const ScrollViewportGeometryContext = createContext<ScrollViewportGeometry | null>(null)
const NOOP = () => {}

export const ScrollOwnershipProvider = ({
  children,
  scrollContainerRef,
  requestFollowRecovery = NOOP,
  viewportBottomInset = 0
}: {
  children: ReactNode
  scrollContainerRef: RefObject<HTMLElement | null>
  requestFollowRecovery?: () => void
  viewportBottomInset?: number
}) => {
  const value = useMemo(
    () => ({ requestFollowRecovery, scrollContainerRef }),
    [requestFollowRecovery, scrollContainerRef]
  )
  const viewportGeometry = useMemo(
    () => ({ bottomInset: Math.max(0, viewportBottomInset), scrollContainerRef }),
    [scrollContainerRef, viewportBottomInset]
  )
  return (
    <ScrollOwnershipContext value={value}>
      <ScrollViewportGeometryContext value={viewportGeometry}>{children}</ScrollViewportGeometryContext>
    </ScrollOwnershipContext>
  )
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

/**
 * Measures the vertical budget below a disclosure trigger inside the managed
 * message-list viewport. The result is capped to a viewport ratio and updates
 * only when the outer viewport, trigger geometry, or bottom inset changes.
 */
export function useScrollViewportMaxHeight(
  triggerRef: RefObject<HTMLElement | null>,
  { bottomGap = 0, enabled, maxViewportRatio = 1, minHeight = 0 }: ScrollViewportMaxHeightOptions
): number | null {
  const geometry = use(ScrollViewportGeometryContext)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  const bottomInset = geometry?.bottomInset ?? 0
  const scrollContainerRef = geometry?.scrollContainerRef ?? null

  useLayoutEffect(() => {
    if (!enabled) return

    const updateMaxHeight = () => {
      const trigger = triggerRef.current
      const scrollContainer = scrollContainerRef?.current
      if (!trigger || !scrollContainer?.contains(trigger)) {
        setMaxHeight((current) => (current === null ? current : null))
        return
      }

      const nearestScrollParent = findScrollParent(trigger)
      if (nearestScrollParent && nearestScrollParent !== scrollContainer) {
        setMaxHeight((current) => (current === null ? current : null))
        return
      }

      const ratio = Math.min(1, Math.max(0, maxViewportRatio))
      const usableViewportHeight = Math.max(0, scrollContainer.clientHeight - bottomInset)
      const ratioLimit = Math.floor(usableViewportHeight * ratio)
      if (ratioLimit <= 0) {
        setMaxHeight((current) => (current === null ? current : null))
        return
      }

      const scrollContainerRect = scrollContainer.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const availableHeight = Math.floor(
        scrollContainerRect.bottom - bottomInset - triggerRect.bottom - Math.max(0, bottomGap)
      )
      const minimumHeight = Math.min(ratioLimit, Math.max(0, minHeight))
      const nextMaxHeight = Math.max(minimumHeight, Math.min(ratioLimit, Math.max(0, availableHeight)))
      setMaxHeight((current) => (current === nextMaxHeight ? current : nextMaxHeight))
    }

    updateMaxHeight()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateMaxHeight)
      const scrollContainer = scrollContainerRef?.current
      const trigger = triggerRef.current
      if (scrollContainer) observer.observe(scrollContainer)
      if (trigger) observer.observe(trigger)
      return () => observer.disconnect()
    }

    const ownerWindow = scrollContainerRef?.current?.ownerDocument.defaultView
    ownerWindow?.addEventListener('resize', updateMaxHeight)
    return () => ownerWindow?.removeEventListener('resize', updateMaxHeight)
  }, [bottomGap, bottomInset, enabled, maxViewportRatio, minHeight, scrollContainerRef, triggerRef])

  return maxHeight
}
