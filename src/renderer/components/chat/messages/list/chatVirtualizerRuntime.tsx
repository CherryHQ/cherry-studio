/**
 * Chat-behavior runtime for the message virtualizer (orchestrator).
 *
 * Composes four focused hooks:
 *
 *   - `useAtBottomTracker` — pure at-bottom state machine wrapper.
 *   - `useAutoStickToBottom` — auto-follow stream when at bottom.
 *   - `useScrollAnchor` — pin a list item to viewport top via a spacer
 *     item appended to virtua's data array (so virtua's measurement +
 *     scrollToIndex handles offsets, not us).
 *   - `useSmoothScrollAnimation` — RAF + cancel-on-wheel.
 */

import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { VListHandle } from 'virtua'

import { getEffectiveScrollSize, getRealBottom, isMoreThanOneViewportFromBottom } from './scrollGeometry'
import { useAtBottomTracker } from './useAtBottomTracker'
import { useAutoStickToBottom } from './useAutoStickToBottom'
import { useScrollAnchor } from './useScrollAnchor'
import { useScrollPositionMemory } from './useScrollPositionMemory'
import { useSmoothScrollAnimation } from './useSmoothScrollAnimation'

export interface MessageVirtualListHandle {
  scrollToBottom(behavior?: ScrollBehavior): void
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  isAtBottom(): boolean
  getScrollElement(): HTMLElement | null
}

export interface ChatVirtualizerRuntimeOptions<T> {
  items: T[]
  getItemKey(item: T, index: number): string
  renderItem(item: T, index: number): ReactNode
  onReachTop?(): void
  hasMoreTop: boolean
  handleRef?: Ref<MessageVirtualListHandle>
  topReachOverscanItems: number
  /** Real content rendered before the virtualizer; passed to virtua as `startMargin`. */
  topPadding?: number
  /**
   * Changes when the caller wants the message with this key scrolled to
   * the viewport top. Typically the latest user message after send.
   */
  scrollToTopKey?: string
  /**
   * Topic id used to remember and restore this list's scroll position
   * across remounts (topic / agent-session switches). Omit to disable.
   */
  topicId?: string
  /** Padding reserved below the last message; used to restore to the bottom. */
  bottomPadding: number
  /** Keep the top-pinned user message stable while an assistant response is still growing. */
  preserveScrollAnchor?: boolean
}

interface ScrollerEventHandlers {
  onWheel(event: WheelEvent): void
  /** Wired into virtua's `onScroll(offset)` callback. */
  onScroll(offset: number): void
  onScrollEnd(): void
}

/**
 * The runtime wraps the caller's items so it can transparently append a
 * spacer item (for scroll-anchor padding). MessageVirtualList passes the
 * wrapped values straight through to virtua's `<Virtualizer>`.
 */
export type WrappedItem<T> =
  | { kind: 'data'; key: string; value: T; originalIndex: number }
  | { kind: 'spacer'; key: '__anchor_spacer__'; height: number }

export interface ChatVirtualizerRuntime<T> {
  scrollerRef: RefObject<HTMLDivElement | null>
  /**
   * Ref for the inner content wrapper observed by ResizeObserver — catches
   * DOM size changes (item growth from streaming text, new items added,
   * spacer-height changes).
   */
  contentRef: RefObject<HTMLDivElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  /** Wrapped items array to pass to virtua's `<Virtualizer data>`. */
  wrappedItems: WrappedItem<T>[]
  /** virtua's `getItemKey` over wrapped items. */
  wrappedGetItemKey(item: WrappedItem<T>, index: number): string
  /** Render function for wrapped items (spacer is rendered as an empty div). */
  wrappedRenderItem(item: WrappedItem<T>, index: number): ReactElement
  /** True only for the render where older items were prepended. */
  shift: boolean
  keepMounted: readonly number[]
  scrollerProps: ScrollerEventHandlers
  isScrollToBottomButtonVisible: boolean
  scrollToBottom(behavior?: ScrollBehavior): void
  /**
   * Mark that a real user scroll input just happened (wheel is wired via
   * `scrollerProps.onWheel`; the host should also call this on pointer/touch
   * starts) so programmatic scrolls aren't mistaken for the user scrolling away.
   */
  markUserInput(): void
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100
// During a programmatic bottom-follow, scroll events fire as the viewport
// catches up. A small negative delta is noise (trackpad inertia, subpixel
// rounding, virtualization remeasure), not intent — only an upward move beyond
// this many pixels counts as the user taking control back.
const SCROLL_TAKEOVER_THRESHOLD_PX = 6
// A scroll event counts as user-initiated only if a real input (wheel / touch /
// pointer) fired within this window before it. Programmatic scrolls (virtua
// remeasure jumps, a child `scrollIntoView`) have no preceding input, so they
// must not release the top pin. Sized to comfortably bridge input→scroll latency
// (including trackpad momentum, which keeps re-stamping): long enough that a real
// gesture is never misread as programmatic, short enough that a programmatic
// scroll arriving a few hundred ms after an unrelated input isn't misread as a
// gesture.
const USER_SCROLL_INPUT_WINDOW_MS = 250

export function useChatVirtualizerRuntime<T>({
  items,
  getItemKey,
  renderItem,
  onReachTop,
  hasMoreTop,
  handleRef,
  topReachOverscanItems,
  topPadding = 0,
  scrollToTopKey,
  topicId,
  bottomPadding,
  preserveScrollAnchor = false
}: ChatVirtualizerRuntimeOptions<T>): ChatVirtualizerRuntime<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)
  const [isScrollToBottomButtonVisible, setIsScrollToBottomButtonVisible] = useState(false)
  const isScrollToBottomButtonVisibleRef = useRef(false)

  const atBottom = useAtBottomTracker()
  const preserveScrollAnchorRef = useRef(preserveScrollAnchor)
  preserveScrollAnchorRef.current = preserveScrollAnchor
  // True once governance has been handed from the top-pin to the at-bottom
  // tracker for the current streaming turn. Two writers flip it: (1) the user
  // manually scrolls away (onScroll, input-gated), and (2) the reply overflows a
  // viewport so the pin releases and we switch to bottom-follow (the ResizeObserver
  // handoff below). Once set, `preserveScrollAnchor` no longer suppresses
  // bottom-follow, so reaching the bottom re-engages auto-stick. Reset at the
  // start of each turn (see the pin effect and the preserve rising edge below).
  const userTookControlRef = useRef(false)
  // Timestamp of the last real user scroll input (wheel / touch / pointer). Lets
  // us tell a genuine scroll-away from a programmatic scroll (virtua remeasure
  // jump, a child `scrollIntoView`) so only the former releases the top pin.
  const lastUserInputAtRef = useRef(0)
  const markUserInput = useCallback(() => {
    lastUserInputAtRef.current = performance.now()
  }, [])
  const anchor = useScrollAnchor({
    scrollerRef,
    contentRef,
    vlistHandleRef,
    smoothScroll,
    startMargin: topPadding
  })
  const bottomFollowInsetRef = useRef(0)
  bottomFollowInsetRef.current = anchor.spacerHeight
  const isBottomFollowSuppressed = useCallback(
    () => anchor.isPinned() || (preserveScrollAnchorRef.current && !userTookControlRef.current),
    [anchor]
  )
  const getBottomFollowInset = useCallback(() => bottomFollowInsetRef.current, [])
  const autoStick = useAutoStickToBottom({
    scrollerRef,
    getBottomInset: getBottomFollowInset,
    smoothScroll,
    isAtBottom: atBottom.isAtBottom,
    isLocked: isBottomFollowSuppressed,
    markStuck: atBottom.notifyProgrammaticStick
  })

  const updateScrollToBottomButtonVisibility = useCallback(() => {
    const el = scrollerRef.current
    const nextVisible =
      el && !smoothScroll.isAnimating() ? isMoreThanOneViewportFromBottom(el, bottomFollowInsetRef.current) : false
    if (isScrollToBottomButtonVisibleRef.current === nextVisible) return
    isScrollToBottomButtonVisibleRef.current = nextVisible
    setIsScrollToBottomButtonVisible(nextVisible)
  }, [smoothScroll])

  const hideScrollToBottomButton = useCallback(() => {
    if (!isScrollToBottomButtonVisibleRef.current) return
    isScrollToBottomButtonVisibleRef.current = false
    setIsScrollToBottomButtonVisible(false)
  }, [])
  const stickToEffectiveBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    smoothScroll.cancel()
    el.scrollTop = getRealBottom(el, bottomFollowInsetRef.current)
    atBottom.notifyProgrammaticStick()
    hideScrollToBottomButton()
  }, [atBottom, hideScrollToBottomButton, smoothScroll])

  // ---- wrap items so the anchor's spacer is included ------------------

  const itemsRef = useRef(items)
  itemsRef.current = items
  const getItemKeyRef = useRef(getItemKey)
  getItemKeyRef.current = getItemKey
  const renderItemRef = useRef(renderItem)
  renderItemRef.current = renderItem

  const dataKeys = useMemo(() => items.map((value, i) => getItemKey(value, i)), [items, getItemKey])
  const previousDataKeysRef = useRef<string[]>([])
  const previousDataKeys = previousDataKeysRef.current
  const shift =
    previousDataKeys.length > 0 &&
    dataKeys.length > previousDataKeys.length &&
    dataKeys.indexOf(previousDataKeys[0]) > 0

  useEffect(() => {
    previousDataKeysRef.current = dataKeys
  }, [dataKeys])

  const wrappedItems = useMemo<WrappedItem<T>[]>(() => {
    const base = items.map<WrappedItem<T>>((value, i) => ({
      kind: 'data',
      key: dataKeys[i],
      value,
      originalIndex: i
    }))
    if (anchor.spacerHeight > 0) {
      base.push({ kind: 'spacer', key: '__anchor_spacer__', height: anchor.spacerHeight })
    }
    return base
  }, [items, dataKeys, anchor.spacerHeight])

  const wrappedGetItemKey = useCallback((item: WrappedItem<T>) => (item.kind === 'spacer' ? item.key : item.key), [])

  const wrappedRenderItem = useCallback((item: WrappedItem<T>) => {
    if (item.kind === 'spacer') {
      return <div key={item.key} aria-hidden="true" style={{ height: item.height, width: '100%' }} />
    }
    // Tag with data-message-index so the selectionchange listener can
    // map a text selection back to a data index for keepMounted.
    return (
      <div key={item.key} data-message-index={item.originalIndex} style={{ width: '100%' }}>
        {renderItemRef.current(item.value, item.originalIndex)}
      </div>
    )
  }, [])

  const findDataIndexByKey = useCallback((key: string): number => {
    const list = itemsRef.current
    const get = getItemKeyRef.current
    for (let i = 0; i < list.length; i++) {
      if (get(list[i], i) === key) return i
    }
    return -1
  }, [])

  // The spacer is appended after data items, so a wrapped index < data length
  // is a data item; anything else (the spacer) maps to null.
  const getDataKeyAtIndex = useCallback((index: number): string | null => {
    const list = itemsRef.current
    if (index < 0 || index >= list.length) return null
    return getItemKeyRef.current(list[index], index)
  }, [])

  // ---- per-topic scroll position memory -------------------------------

  const { save: saveScrollPosition } = useScrollPositionMemory({
    topicId,
    itemCount: items.length,
    bottomPadding,
    scrollerRef,
    vlistHandleRef,
    getDataKeyAtIndex,
    findDataIndexByKey,
    isAtBottom: atBottom.isAtBottom,
    notifyProgrammaticStick: atBottom.notifyProgrammaticStick,
    suppressBottomFollow: isBottomFollowSuppressed,
    releaseAnchor: anchor.release,
    isAnimating: smoothScroll.isAnimating
  })

  // ---- ResizeObserver: dispatch to anchor + auto-stick ----------------

  useLayoutEffect(() => {
    const content = contentRef.current
    const scroller = scrollerRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const wasBottomFollowSuppressed = isBottomFollowSuppressed()
      const wasPinned = anchor.isPinned()
      // Anchor first: it may adjust spacer height. Auto-stick reads
      // scrollHeight after, so any pin-driven layout change is reflected.
      anchor.onContentSizeChange()
      // The pin let go because the reply outgrew the space below it (overflowed a
      // viewport). Hand the turn to bottom-follow: drop the preserve suppression
      // and snap to the live bottom so streaming now sticks to the bottom instead
      // of freezing the user message at the top.
      const pinReleasedByContent = wasPinned && !anchor.isPinned()
      if (pinReleasedByContent && preserveScrollAnchorRef.current) {
        userTookControlRef.current = true
      }
      if (wasBottomFollowSuppressed || isBottomFollowSuppressed()) {
        atBottom.reset()
      }
      autoStick.onContentSizeChange()
      if (pinReleasedByContent && preserveScrollAnchorRef.current) {
        stickToEffectiveBottom()
      }
      // Feed the at-bottom tracker so its state machine stays current.
      const el = scrollerRef.current
      if (el && !wasBottomFollowSuppressed && !isBottomFollowSuppressed() && !smoothScroll.isAnimating()) {
        const viewportSize = el.clientHeight
        atBottom.notifySizeChange({
          offset: el.scrollTop,
          scrollSize: getEffectiveScrollSize(el, anchor.spacerHeight),
          viewportSize
        })
      }
      updateScrollToBottomButtonVisibility()
    })
    observer.observe(content)
    // Also observe the scroller — the composer can expand (long paste) and
    // shrink the viewport without changing content height. Without this, the
    // spacer stays sized for the old viewport and turns into phantom scroll
    // room below the messages.
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [
    anchor,
    atBottom,
    autoStick,
    isBottomFollowSuppressed,
    smoothScroll,
    stickToEffectiveBottom,
    updateScrollToBottomButtonVisibility
  ])

  // ---- react to the preserve-anchor lock edges -----------------------

  // This effect handles both edges of `preserveScrollAnchor`.
  //
  // Falling edge (assistant finished streaming) — reclaim the spacer. While
  // pinned, the spacer is monotonic: it grows to keep the user message at the
  // viewport top and is never shrunk per streaming chunk (that would jitter
  // scrollHeight under the viewport). A long reply that overflows the viewport
  // already released mid-stream (needed === 0) and handed off to bottom-follow;
  // a short reply (needed > 0) stays pinned. The decay only ever runs inside the
  // ResizeObserver's `onContentSizeChange`, and the streaming-ended transition
  // (status pending→done) usually carries no DOM size change — so without a nudge
  // here a just-satisfied spacer could linger as a phantom blank block until the
  // next unrelated resize. Re-run the size-change pass once on the falling edge.
  //
  // Rising edge (a new generation began) — reset the manual-control gate so the
  // fresh turn starts pinned-to-top instead of inheriting the previous turn's
  // "user took over" state.
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const isBottomFollowSuppressedRef = useRef(isBottomFollowSuppressed)
  isBottomFollowSuppressedRef.current = isBottomFollowSuppressed
  const stickToEffectiveBottomRef = useRef(stickToEffectiveBottom)
  stickToEffectiveBottomRef.current = stickToEffectiveBottom
  const wasPreservingScrollAnchorRef = useRef(preserveScrollAnchor)
  useEffect(() => {
    const wasPreserving = wasPreservingScrollAnchorRef.current
    wasPreservingScrollAnchorRef.current = preserveScrollAnchor
    if (preserveScrollAnchor) {
      // Rising edge — a new generation began: start it pinned-to-top again
      // rather than inheriting the previous turn's manual-control state.
      if (!wasPreserving) userTookControlRef.current = false
      return
    }
    if (!wasPreserving) return
    const raf = requestAnimationFrame(() => {
      const shouldKeepBottom = atBottom.isAtBottom() && !isBottomFollowSuppressedRef.current()
      if (shouldKeepBottom) {
        anchorRef.current.release()
        stickToEffectiveBottomRef.current()
      }
      anchorRef.current.onContentSizeChange()
    })
    return () => cancelAnimationFrame(raf)
  }, [atBottom, preserveScrollAnchor])

  // ---- scrollToTopKey trigger: pin the named item ---------------------

  const lastScrollToTopKeyRef = useRef<string | undefined>(undefined)
  const didMountForScrollKeyRef = useRef(false)

  useEffect(() => {
    const previous = lastScrollToTopKeyRef.current
    lastScrollToTopKeyRef.current = scrollToTopKey
    if (!didMountForScrollKeyRef.current) {
      didMountForScrollKeyRef.current = true
      return
    }
    if (!scrollToTopKey || scrollToTopKey === previous) return
    const idx = findDataIndexByKey(scrollToTopKey)
    if (idx < 0) return
    anchor.pinTo(idx)
    atBottom.reset()
    // New user turn: the message is freshly pinned to the top, so revoke any
    // manual-control gate carried over from the previous turn.
    userTookControlRef.current = false
  }, [anchor, atBottom, findDataIndexByKey, scrollToTopKey])

  // Initial scroll on mount is owned by `useScrollPositionMemory` above: it
  // restores the saved anchor for this topic, or scrolls to the newest message
  // when there is nothing to restore.

  // ---- scroll / wheel handlers ---------------------------------------

  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelDirRef = useRef<'up' | 'down' | 'none'>('none')
  const lastScrollOffsetRef = useRef(0)

  const onWheel = useCallback(
    (event: WheelEvent) => {
      markUserInput()
      const dir: 'up' | 'down' | 'none' = event.deltaY < 0 ? 'up' : event.deltaY > 0 ? 'down' : 'none'
      if (smoothScroll.isAnimating() && dir === 'up') {
        smoothScroll.cancel()
      }
      lastWheelDirRef.current = dir
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = setTimeout(() => {
        lastWheelDirRef.current = 'none'
      }, SCROLL_WHEEL_DEBOUNCE_MS)
    },
    [markUserInput, smoothScroll]
  )

  const onReachTopRef = useRef(onReachTop)
  onReachTopRef.current = onReachTop

  const maybeNotifyReachTop = useCallback(
    (offset: number) => {
      if (!hasMoreTop) return
      const handle = vlistHandleRef.current
      if (!handle) return
      const topmostIdx = handle.findItemIndex(offset)
      if (topmostIdx < topReachOverscanItems) {
        onReachTopRef.current?.()
      }
    },
    [hasMoreTop, topReachOverscanItems]
  )

  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const offset = el.scrollTop
    const delta = offset - lastScrollOffsetRef.current
    // Only a genuine user scroll (recent wheel / touch / pointer) is treated as
    // intent. virtua's remeasure-compensation jumps and child `scrollIntoView`
    // calls also fire scroll events, with no preceding input.
    const isUserInitiated = performance.now() - lastUserInputAtRef.current < USER_SCROLL_INPUT_WINDOW_MS
    // Programmatic bottom-follow emits scroll events while the viewport is still
    // catching up. Ignore forward progress, sub-threshold jitter, AND any non-user
    // scroll: virtua's remeasure compensation moves scrollTop backward by tens of
    // px mid-stream, and cancelling the follow on it makes streaming stutter up
    // and down. Only a real upward user gesture takes control.
    if (smoothScroll.isAnimating()) {
      if (!isUserInitiated || delta > -SCROLL_TAKEOVER_THRESHOLD_PX) {
        lastScrollOffsetRef.current = offset
        return
      }
      smoothScroll.cancel()
    }
    const viewportSize = el.clientHeight
    const scrollSize = getEffectiveScrollSize(el, anchor.spacerHeight)
    anchor.onUserScroll(offset, isUserInitiated)
    // A user scroll during a streaming turn (which just released the top pin,
    // or there was none) means the user has taken over: stop letting
    // `preserveScrollAnchor` suppress bottom-follow so reaching the bottom can
    // re-engage auto-stick. `onUserScroll` runs first and is itself input-gated,
    // so the pin is only un-pinned here when a real scroll crossed the tolerance.
    const tookControl = preserveScrollAnchorRef.current && !anchor.isPinned()
    if (tookControl) {
      userTookControlRef.current = true
    }
    const wheelDir = lastWheelDirRef.current
    const direction: 'up' | 'down' | 'none' =
      wheelDir !== 'none' ? wheelDir : delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
    lastScrollOffsetRef.current = offset
    if (isBottomFollowSuppressed()) {
      atBottom.reset()
    } else {
      atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction })
    }
    updateScrollToBottomButtonVisibility()
    saveScrollPosition()
    maybeNotifyReachTop(offset)
  }, [
    anchor,
    atBottom,
    isBottomFollowSuppressed,
    maybeNotifyReachTop,
    saveScrollPosition,
    smoothScroll,
    updateScrollToBottomButtonVisibility
  ])

  const onScrollEnd = useCallback(() => {
    lastWheelDirRef.current = 'none'
    // Scrolling has settled — capture the exact resting position, bypassing the
    // throttle that paces the in-flight `onScroll` saves.
    saveScrollPosition(true)
  }, [saveScrollPosition])
  const scrollerProps = useMemo(() => ({ onWheel, onScroll, onScrollEnd }), [onScroll, onScrollEnd, onWheel])

  // ---- selection-survival keepMounted --------------------------------

  const [selectionIndex, setSelectionIndex] = useState<number | null>(null)

  useEffect(() => {
    const handler = (): void => {
      const sel = typeof document !== 'undefined' ? document.getSelection() : null
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelectionIndex(null)
        return
      }
      const anchorNode = sel.anchorNode
      if (!anchorNode) {
        setSelectionIndex(null)
        return
      }
      const baseEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
      const indexed = baseEl?.closest('[data-message-index]')
      const idx = indexed ? Number(indexed.getAttribute('data-message-index')) : NaN
      setSelectionIndex(Number.isFinite(idx) ? idx : null)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  const keepMounted = useMemo<readonly number[]>(
    () => (selectionIndex == null ? [] : [selectionIndex]),
    [selectionIndex]
  )

  // ---- imperative API -------------------------------------------------

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      // Explicit scroll-to-bottom releases any anchor — caller wants the
      // absolute bottom, not the user-message-top position.
      anchor.release()
      const el = scrollerRef.current
      if (!el) return
      const target = getRealBottom(el, anchor.spacerHeight)
      if (behavior === 'smooth') {
        if (!smoothScroll.isAnimating()) {
          smoothScroll.scrollTo(() => {
            const current = scrollerRef.current
            return current ? getRealBottom(current, bottomFollowInsetRef.current) : 0
          })
        }
      } else {
        smoothScroll.cancel()
        el.scrollTop = target
      }
      atBottom.notifyProgrammaticStick()
      hideScrollToBottomButton()
    },
    [anchor, atBottom, hideScrollToBottomButton, smoothScroll]
  )

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom,
      scrollToKey: (key, align = 'start') => {
        const handle = vlistHandleRef.current
        const idx = findDataIndexByKey(key)
        if (idx < 0 || !handle) return
        anchor.release()
        handle.scrollToIndex(idx, { align, smooth: true })
      },
      isAtBottom: atBottom.isAtBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [anchor, atBottom.isAtBottom, findDataIndexByKey, scrollToBottom]
  )

  return {
    scrollerRef,
    contentRef,
    vlistHandleRef,
    wrappedItems,
    wrappedGetItemKey,
    wrappedRenderItem: wrappedRenderItem as ChatVirtualizerRuntime<T>['wrappedRenderItem'],
    shift,
    keepMounted,
    scrollerProps,
    isScrollToBottomButtonVisible,
    scrollToBottom,
    markUserInput
  }
}

// Item-element wrapper kept here for reference / future tagging; currently
// the wrapped renderItem path adds `data-message-index` via the item's own
// children (renderItem caller). If selection-survival per-item attribute
// becomes desirable again, re-introduce by wrapping wrappedRenderItem.
export type ItemElement = (props: {
  index: number
  style: CSSProperties
  children: React.ReactNode
}) => React.ReactElement
