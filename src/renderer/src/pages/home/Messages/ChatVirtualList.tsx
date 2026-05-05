/**
 * Virtualized message list for the chat view.
 *
 * Built on `@tanstack/react-virtual` (already in deps via `CodeViewer`),
 * with chat-specific scroll behavior implemented in this file:
 *
 *   - On mount: scroll to the bottom (newest item visible).
 *   - On append while user is at bottom: stick to bottom by setting
 *     `scrollTop = scrollHeight` directly. Avoids `scrollToIndex`'s
 *     animation path competing with `measureElement`'s ResizeObserver
 *     re-measure cycle during high-frequency streaming.
 *   - On prepend (older history loaded): preserve the user's visual
 *     position by shifting `scrollTop` by the new content height that
 *     was added above. Detection uses item-count growth + first-key
 *     change; size delta drives the offset.
 *   - On streaming (last item grows): if user is at bottom, follow;
 *     otherwise leave the scroll position alone (don't yank the user
 *     who's reading history).
 *
 * Stable `getItemKey` is mandatory — `@tanstack/react-virtual` keys its
 * measured-height cache by item key. Without it, prepend invalidates
 * every cached height and items "jump" visually as they remeasure.
 *
 * Accepts an imperative `handleRef` for callers that need to scroll
 * programmatically (e.g. `MessageAnchorLine`'s click-to-scroll).
 */

import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'

const AT_BOTTOM_THRESHOLD_PX = 4

export interface ChatVirtualListHandle {
  /** Scroll to the bottom of the list. */
  scrollToBottom(behavior?: ScrollBehavior): void
  /** Scroll the item with the given key into view. */
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  /** Returns whether the viewport is currently flush with the list's bottom. */
  isAtBottom(): boolean
  /** Returns the underlying scroll element, e.g. for screenshot capture. */
  getScrollElement(): HTMLElement | null
}

export interface ChatVirtualListProps<T> {
  /** Items in chronological order (oldest first). DOM order = display order. */
  items: T[]
  /**
   * Stable, unique key per item. Same item across renders MUST yield the
   * same key — the virtualizer caches measured heights by this key.
   */
  getItemKey(item: T, index: number): string
  /** Render function for one item. */
  renderItem(item: T, index: number): ReactNode
  /** Initial pixel estimate per item; refined by `measureElement`. */
  estimateSize?: number
  /** Items rendered off-screen on each side for smooth scroll. */
  overscan?: number
  /**
   * Triggered when the topmost rendered index falls within `overscan` of
   * index 0 — i.e. the user is approaching the start of the list.
   * Caller should debounce / track in-flight to avoid duplicate fetches.
   */
  onReachTop?(): void
  /** Whether more older items exist to load (gates `onReachTop`). */
  hasMoreTop?: boolean
  /** Imperative API for scrolling. */
  handleRef?: Ref<ChatVirtualListHandle>
  /** className applied to the outer scroll container. */
  className?: string
  /** style applied to the outer scroll container. */
  style?: React.CSSProperties
}

export function ChatVirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize = 200,
  overscan = 6,
  onReachTop,
  hasMoreTop = false,
  handleRef,
  className,
  style
}: ChatVirtualListProps<T>): React.ReactElement {
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const virtualizerGetItemKey = useCallback((index: number) => getItemKey(items[index], index), [items, getItemKey])
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

  // ── atBottom tracking ────────────────────────────────────────
  // Updated on every scroll event; read in the data-change effect to
  // decide whether to follow. Initial value `true` means a fresh mount
  // with no scroll yet is treated as "at bottom" — matches the
  // initial-scroll-to-bottom behavior below.
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

  // ── Initial scroll-to-bottom ──────────────────────────────────
  // First-frame scroll uses `el.scrollHeight` from the estimated
  // totalSize — gets us close to the bottom but typically off by a
  // few hundred px because most items haven't been `measureElement`-d
  // yet. Schedule a second pass after ResizeObserver has had a chance
  // to settle the real measurements; if the user hasn't scrolled away
  // in the meantime, re-stick to the now-correct bottom.
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
    // Settle pass — runs after measureElement converges. Guarded by
    // `wasAtBottomRef` so we don't yank a user who scrolled up in the
    // first 100ms (rare but possible during slow renders).
    const settleTimer = setTimeout(() => {
      const el = scrollerRef.current
      if (!el) return
      if (!wasAtBottomRef.current) return
      el.scrollTop = el.scrollHeight
    }, 120)
    return () => clearTimeout(settleTimer)
  }, [items.length])

  // ── Prepend anchor + append/streaming follow ──────────────────
  // Detects three cases on every layout-effect run:
  //   prepend     → items.length grew AND items[0] key changed
  //   append      → items.length grew AND items[0] key unchanged
  //   item-grew   → items.length unchanged, totalSize grew
  // Append + item-grew share the "stick to bottom if user was there"
  // policy; prepend uses anchored-shift to preserve viewport.
  const prevFirstKeyRef = useRef<string | undefined>(undefined)
  const prevTotalSizeRef = useRef(0)
  const prevItemCountRef = useRef(0)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const newFirstKey = items.length > 0 ? getItemKey(items[0], 0) : undefined
    const prevFirstKey = prevFirstKeyRef.current
    const prevTotalSize = prevTotalSizeRef.current
    const prevCount = prevItemCountRef.current

    const sizeDelta = totalSize - prevTotalSize
    const countDelta = items.length - prevCount
    const firstKeyChanged = newFirstKey !== prevFirstKey

    // Skip the first run after mount — initial-scroll-to-bottom owns
    // the scroll position for that case.
    if (prevCount === 0) {
      prevFirstKeyRef.current = newFirstKey
      prevTotalSizeRef.current = totalSize
      prevItemCountRef.current = items.length
      return
    }

    // Scroll mutations are deferred to the next frame. Setting
    // `scrollTop` synchronously inside a layout effect fires the
    // scroller's scroll event, which makes `@tanstack/react-virtual`'s
    // subscription call `flushSync` to commit measurements — and
    // React 18 forbids `flushSync` from inside a lifecycle method
    // ("flushSync was called from inside a lifecycle method"). RAF
    // pushes the mutation past the commit phase, so the resulting
    // virtualizer update is just a normal setState.
    if (countDelta > 0 && firstKeyChanged && sizeDelta > 0) {
      // Prepend: shift scrollTop by the new content height added above.
      // Imperfect when prepended items haven't been `measureElement`-d
      // yet — their estimated size differs from real size, so the user
      // may see a small jump as ResizeObserver settles. The next
      // layout-effect run re-anchors with the corrected sizeDelta.
      requestAnimationFrame(() => {
        const node = scrollerRef.current
        if (node) node.scrollTop = node.scrollTop + sizeDelta
      })
    } else if (sizeDelta > 0 && wasAtBottomRef.current) {
      // Append OR streaming-grow while user was at bottom: stick to
      // bottom directly. We bypass `scrollToIndex` because its animation
      // path fights `measureElement` during high-frequency chunks.
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

  // ── Reach-top trigger for `loadOlder` ─────────────────────────
  const virtualItems = virtualizer.getVirtualItems()
  const topmostIndex = virtualItems[0]?.index ?? 0
  const onReachTopRef = useRef(onReachTop)
  onReachTopRef.current = onReachTop

  useEffect(() => {
    if (!hasMoreTop) return
    if (topmostIndex >= overscan) return
    onReachTopRef.current?.()
  }, [topmostIndex, overscan, hasMoreTop])

  // ── Imperative handle ─────────────────────────────────────────
  useImperativeHandle(
    handleRef,
    (): ChatVirtualListHandle => ({
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

  return (
    <div
      ref={scrollerRef}
      className={className}
      style={{ overflowY: 'auto', overflowX: 'hidden', position: 'relative', ...style }}>
      <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
        {virtualItems.map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vi.start}px)`
            }}>
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  )
}
