import { useVirtualizer } from '@tanstack/react-virtual'
import { type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'

const AT_BOTTOM_THRESHOLD_PX = 8

export interface MessageVirtualListHandle {
  /** Scroll to the bottom of the list. */
  scrollToBottom(behavior?: ScrollBehavior): void
  /** Scroll the item with the given key into view. */
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  /** Returns whether the viewport is currently flush with the list's bottom. */
  isAtBottom(): boolean
  /** Returns the underlying scroll element, e.g. for screenshot capture. */
  getScrollElement(): HTMLElement | null
}

interface UseMessageVirtualListRuntimeOptions<T> {
  items: T[]
  getItemKey(item: T, index: number): string
  estimateSize: number
  overscan: number
  onReachTop?(): void
  hasMoreTop: boolean
  handleRef?: Ref<MessageVirtualListHandle>
  topPadding: number
  bottomPadding: number
}

export function useMessageVirtualListRuntime<T>({
  items,
  getItemKey,
  estimateSize,
  overscan,
  onReachTop,
  hasMoreTop,
  handleRef,
  topPadding,
  bottomPadding
}: UseMessageVirtualListRuntimeOptions<T>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const virtualizerGetItemKey = useCallback(
    (index: number) => getItemKey(items[index] as T, index),
    [items, getItemKey]
  )
  const virtualizerEstimateSize = useCallback(() => estimateSize, [estimateSize])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: virtualizerEstimateSize,
    getItemKey: virtualizerGetItemKey,
    overscan,
    useFlushSync: false
  })

  const totalSize = virtualizer.getTotalSize()
  const scrollHeight = topPadding + totalSize + bottomPadding
  const prevBottomPaddingRef = useRef(bottomPadding)
  const wasAtBottomRef = useRef(true)

  const computeIsAtBottom = useCallback((): boolean => {
    const el = scrollerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD_PX
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handler = (): void => {
      wasAtBottomRef.current = computeIsAtBottom()
    }
    el.addEventListener('scroll', handler, { passive: true })
    handler()
    return () => el.removeEventListener('scroll', handler)
  }, [computeIsAtBottom])

  const didInitialScrollRef = useRef(false)
  useLayoutEffect(() => {
    if (didInitialScrollRef.current) return
    if (items.length === 0) return
    didInitialScrollRef.current = true
    requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
      wasAtBottomRef.current = true
    })
    const settleTimer = setTimeout(() => {
      const el = scrollerRef.current
      if (!el) return
      if (!wasAtBottomRef.current) return
      el.scrollTop = el.scrollHeight
    }, 120)
    return () => clearTimeout(settleTimer)
  }, [items.length])

  const prevFirstKeyRef = useRef<string | undefined>(undefined)
  const prevTotalSizeRef = useRef(0)
  const prevItemCountRef = useRef(0)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const newFirstKey = items.length > 0 ? getItemKey(items[0] as T, 0) : undefined
    const prevFirstKey = prevFirstKeyRef.current
    const prevTotalSize = prevTotalSizeRef.current
    const prevCount = prevItemCountRef.current

    const sizeDelta = totalSize - prevTotalSize
    const countDelta = items.length - prevCount
    const firstKeyChanged = newFirstKey !== prevFirstKey

    if (prevCount === 0) {
      prevFirstKeyRef.current = newFirstKey
      prevTotalSizeRef.current = totalSize
      prevItemCountRef.current = items.length
      return
    }

    if (countDelta > 0 && firstKeyChanged && sizeDelta > 0) {
      requestAnimationFrame(() => {
        const node = scrollerRef.current
        if (node) node.scrollTop = node.scrollTop + sizeDelta
      })
    } else if (sizeDelta !== 0 && wasAtBottomRef.current) {
      requestAnimationFrame(() => {
        const node = scrollerRef.current
        if (!node) return
        node.scrollTop = node.scrollHeight
        wasAtBottomRef.current = true
      })
    }

    prevFirstKeyRef.current = newFirstKey
    prevTotalSizeRef.current = totalSize
    prevItemCountRef.current = items.length
  }, [items, getItemKey, totalSize])

  useLayoutEffect(() => {
    if (prevBottomPaddingRef.current === bottomPadding) return
    const shouldStickToBottom = wasAtBottomRef.current
    prevBottomPaddingRef.current = bottomPadding
    if (!shouldStickToBottom) return

    requestAnimationFrame(() => {
      const node = scrollerRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
      wasAtBottomRef.current = true
    })
  }, [bottomPadding])

  const stickyObserverRef = useRef<ResizeObserver | null>(null)
  const observedItemsRef = useRef<Set<HTMLElement>>(new Set())

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    stickyObserverRef.current = new ResizeObserver(() => {
      if (!wasAtBottomRef.current) return
      const node = scrollerRef.current
      if (!node) return
      const observed = observedItemsRef.current
      let lastBottom = -Infinity
      for (const el of observed) {
        if (!el.isConnected) continue
        const rect = el.getBoundingClientRect()
        if (rect.bottom > lastBottom) lastBottom = rect.bottom
      }
      if (lastBottom === -Infinity) {
        node.scrollTop = node.scrollHeight
        return
      }
      const scrollerRect = node.getBoundingClientRect()
      const target = lastBottom - scrollerRect.top + node.scrollTop - node.clientHeight + bottomPadding
      node.scrollTop = Math.max(0, target)
    })
    return () => {
      stickyObserverRef.current?.disconnect()
      stickyObserverRef.current = null
      observedItemsRef.current.clear()
    }
  }, [bottomPadding])

  const measureItem = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node)
      const observer = stickyObserverRef.current
      if (!observer) return
      const observed = observedItemsRef.current
      if (node) {
        if (!observed.has(node)) {
          observer.observe(node)
          observed.add(node)
        }
      } else {
        for (const el of observed) {
          if (!el.isConnected) {
            observer.unobserve(el)
            observed.delete(el)
          }
        }
      }
    },
    [virtualizer]
  )

  const virtualItems = virtualizer.getVirtualItems()
  const topmostIndex = virtualItems[0]?.index ?? 0
  const onReachTopRef = useRef(onReachTop)
  onReachTopRef.current = onReachTop

  useEffect(() => {
    if (!hasMoreTop) return
    if (topmostIndex >= overscan) return
    onReachTopRef.current?.()
  }, [topmostIndex, overscan, hasMoreTop])

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom(behavior = 'instant') {
        const el = scrollerRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior })
      },
      scrollToKey(key, align = 'start') {
        const idx = items.findIndex((item, i) => getItemKey(item, i) === key)
        if (idx < 0) return
        virtualizer.scrollToIndex(idx, { align })
      },
      isAtBottom: computeIsAtBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [items, getItemKey, virtualizer, computeIsAtBottom]
  )

  return {
    measureItem,
    scrollerRef,
    scrollHeight,
    virtualItems
  }
}
