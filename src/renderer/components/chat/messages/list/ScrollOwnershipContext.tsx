/**
 * Scroll-ownership context — identifies the DOM scroller whose stability is
 * owned by the message-list runtime.
 *
 * Inside the virtual list, `chatVirtualizerRuntime` owns product-level scroll
 * intent and reconciles virtualizer adjustments. Blocks never write that same
 * scroller's `scrollTop`; explicit disclosures instead ask the runtime to enter
 * reading mode and preserve their semantic anchor. Embedded documents report
 * boundary wheel intent (and isolated-realm deltas) through this context, so
 * the runtime remains the only writer of the message viewport.
 *
 * React context can cross portals and nested scroll containers, so provider
 * presence alone does not establish DOM ownership. Blocks compare their nearest
 * real scroll parent with `scrollContainerRef` before yielding to the runtime.
 * The pure helpers below define the shared nested-scroll policy for anchoring,
 * wheel, keyboard and touch input.
 */

import { createContext, type ReactNode, type RefObject, use, useCallback, useMemo } from 'react'

interface ScrollOwnership {
  scrollContainerRef: RefObject<HTMLElement | null>
  requestReadingControl: (anchor: HTMLElement | null) => void
  scrollToElement: (element: HTMLElement, align?: 'start' | 'center') => void
  notifyWheelIntent?: (deltaY: number) => void
  scrollByWheel?: (deltaY: number, maxDeltaY?: number) => boolean
}

const ScrollOwnershipContext = createContext<ScrollOwnership | null>(null)
const NOOP: (anchor: HTMLElement | null) => void = () => {}

export const VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX = 1
export const VERTICAL_SCROLLABLE_OVERFLOW_PATTERN_SOURCE = 'auto|scroll|overlay'
export const FORWARDED_WHEEL_MAX_DELTA_PX = 200
const VERTICAL_SCROLLABLE_OVERFLOW_PATTERN = new RegExp(`^(?:${VERTICAL_SCROLLABLE_OVERFLOW_PATTERN_SOURCE})$`)

export function clampForwardedWheelDelta(deltaY: number, maxDeltaY: number = FORWARDED_WHEEL_MAX_DELTA_PX): number {
  return Math.max(-maxDeltaY, Math.min(maxDeltaY, deltaY))
}

export const ScrollOwnershipProvider = ({
  children,
  scrollContainerRef,
  requestReadingControl = NOOP,
  scrollToElement = NOOP,
  notifyWheelIntent,
  scrollByWheel
}: {
  children: ReactNode
  scrollContainerRef: RefObject<HTMLElement | null>
  requestReadingControl?: (anchor: HTMLElement | null) => void
  scrollToElement?: (element: HTMLElement, align?: 'start' | 'center') => void
  notifyWheelIntent?: (deltaY: number) => void
  scrollByWheel?: (deltaY: number, maxDeltaY?: number) => boolean
}) => {
  const value = useMemo(
    () => ({ notifyWheelIntent, requestReadingControl, scrollByWheel, scrollContainerRef, scrollToElement }),
    [notifyWheelIntent, requestReadingControl, scrollByWheel, scrollContainerRef, scrollToElement]
  )
  return <ScrollOwnershipContext value={value}>{children}</ScrollOwnershipContext>
}

/** Whether an element establishes a real vertical scrolling coordinate space. */
export function isVerticalScrollContainer(element: Element | null, isRoot = false): boolean {
  if (!element || element.scrollHeight <= element.clientHeight + VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX) return false
  if (isRoot) return true

  const view = element.ownerDocument.defaultView
  return view ? VERTICAL_SCROLLABLE_OVERFLOW_PATTERN.test(view.getComputedStyle(element).overflowY) : false
}

/** Whether this element consumes a wheel delta instead of chaining it to an ancestor. */
export function canConsumeVerticalWheel(element: Element | null, deltaY: number, isRoot = false): boolean {
  if (!isVerticalScrollContainer(element, isRoot) || !element) return false

  const view = element.ownerDocument.defaultView
  if (!view) return false

  const overscrollBehaviorY = view.getComputedStyle(element).overscrollBehaviorY
  if (overscrollBehaviorY === 'contain' || overscrollBehaviorY === 'none') return true
  if (deltaY < 0) return element.scrollTop > 0
  return (
    deltaY > 0 &&
    element.scrollTop + element.clientHeight < element.scrollHeight - VERTICAL_SCROLL_OVERFLOW_TOLERANCE_PX
  )
}

/** Nearest vertical scroller at or above `element`, stopping before `boundary`. */
export function findNearestVerticalScrollContainer(
  element: HTMLElement | null,
  boundary: HTMLElement | null = null
): HTMLElement | null {
  for (let node = element; node && node !== boundary; node = node.parentElement) {
    if (isVerticalScrollContainer(node)) return node
  }
  return null
}

/** First ancestor that consumes this wheel delta, stopping before `boundary`. */
export function findVerticalWheelConsumer(
  element: Element | null,
  deltaY: number,
  boundary: Element | null = null
): Element | null {
  for (let node = element; node && node !== boundary; node = node.parentElement) {
    if (canConsumeVerticalWheel(node, deltaY)) return node
  }
  return null
}

/** Outermost nested vertical scroller whose border box is stable in the owning viewport. */
export function findOutermostVerticalScrollContainer(element: HTMLElement, boundary: HTMLElement): HTMLElement | null {
  let outermost: HTMLElement | null = null
  for (let node = element.parentElement; node && node !== boundary; node = node.parentElement) {
    if (isVerticalScrollContainer(node)) outermost = node
  }
  return outermost
}

/** Nearest actually-scrollable ancestor. */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  return findNearestVerticalScrollContainer(element?.parentElement ?? null)
}

export interface ScrollRuntimeBoundary {
  getScrollContainer(): HTMLElement | null
  notifyWheelIntent(deltaY: number): boolean
  scrollByWheel(deltaY: number, maxDeltaY?: number): boolean
}

/** Route embedded or portal scroll input through the owning message-list runtime. */
export function useScrollRuntimeBoundary(): ScrollRuntimeBoundary {
  const ownership = use(ScrollOwnershipContext)
  const getScrollContainer = useCallback(() => ownership?.scrollContainerRef.current ?? null, [ownership])
  const notifyWheelIntent = useCallback(
    (deltaY: number) => {
      if (!ownership?.notifyWheelIntent) return false
      ownership.notifyWheelIntent(deltaY)
      return true
    },
    [ownership]
  )
  const scrollByWheel = useCallback(
    (deltaY: number, maxDeltaY?: number) => {
      if (!ownership?.scrollByWheel) return false
      return maxDeltaY === undefined ? ownership.scrollByWheel(deltaY) : ownership.scrollByWheel(deltaY, maxDeltaY)
    },
    [ownership]
  )

  return useMemo(
    () => ({ getScrollContainer, notifyWheelIntent, scrollByWheel }),
    [getScrollContainer, notifyWheelIntent, scrollByWheel]
  )
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
