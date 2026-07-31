/**
 * Chat-behavior runtime for the message virtualizer (orchestrator).
 *
 * Composes three focused hooks:
 *
 *   - `useAtBottomTracker` — pure at-bottom state machine wrapper.
 *   - `useAutoStickToBottom` — auto-follow stream when at bottom.
 *   - `useSmoothScrollAnimation` — RAF + cancel-on-wheel.
 *
 * At any moment exactly one driver owns scrollTop (`scrollDriverRef`):
 *
 *   - 'runtime' — the hooks above follow the streaming bottom and animate
 *     explicit navigation.
 *   - 'user' — the user took over (any pointer/keyboard interaction inside
 *     the scroller via `takeUserControl`, or an upward scroll-away). Runtime
 *     writers go idle and the viewport is frozen where the user holds it: every
 *     observed layout change re-asserts scrollTop against a freeze anchor, so
 *     streaming growth, block toggles and async renders cannot move what the
 *     user is reading or aiming at.
 *
 * Returning to the live bottom re-enables bottom-follow. Manual top/key
 * navigation finishes in a user-owned reading position; scroll-to-bottom
 * explicitly returns ownership to the runtime.
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
import { useScrollPositionMemory } from './useScrollPositionMemory'
import { useSmoothScrollAnimation } from './useSmoothScrollAnimation'

export interface MessageVirtualListHandle {
  scrollToBottom(behavior?: ScrollBehavior): void
  scrollToTop(behavior?: ScrollBehavior): void
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  /** Smooth-scroll `element`'s top to the viewport top, then freeze the viewport on it. */
  scrollToElement(element: HTMLElement): void
  /** Capture whether a pending local send may return to the live bottom. */
  captureLocalSendScrollEligibility(): void
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
   * Topic id used to remember and restore this list's scroll position
   * across remounts (topic / agent-session switches). Omit to disable.
   */
  topicId?: string
  /** Padding reserved below the last message; used to restore to the bottom. */
  bottomPadding: number
  /** Monotonic generation from the local conversation turn controller. */
  localSendGeneration?: number
  /** Stable item keys that must survive virtualization while they own live UI state. */
  keepMountedKeys?: readonly string[]
}

interface ScrollerEventHandlers {
  onWheel(event: WheelEvent): void
  /** Wired into virtua's `onScroll(offset)` callback. */
  onScroll(offset: number): void
  onScrollEnd(): void
}

/** Data item enriched with stable identity for virtua and DOM navigation. */
export interface WrappedItem<T> {
  key: string
  value: T
  originalIndex: number
}

interface FreezeAnchor {
  /** Stable virtual item identity; resolved back to the current index after prepends. */
  itemKey: string
  /** Pixel position inside the item, used when the DOM anchor was replaced. */
  offsetInItem: number
  /** Visible semantic element (clicked control / element at viewport top), when available. */
  element: HTMLElement | null
  /** Element top relative to the scroller viewport at capture time. */
  elementViewportTop: number | null
}

export interface ChatVirtualizerRuntime<T> {
  scrollerRef: RefObject<HTMLDivElement | null>
  /**
   * Ref for the inner content wrapper observed by ResizeObserver — catches
   * DOM size changes (item growth from streaming text and new items added).
   */
  contentRef: RefObject<HTMLDivElement | null>
  /** Temporary bottom slack used to preserve scrollTop when frozen content shrinks. */
  freezeSpacerRef: RefObject<HTMLDivElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  /** Wrapped items array to pass to virtua's `<Virtualizer data>`. */
  wrappedItems: WrappedItem<T>[]
  /** Render function for wrapped items. */
  wrappedRenderItem(item: WrappedItem<T>, index: number): ReactElement
  /** True only for the render where older items were prepended. */
  shift: boolean
  keepMounted: readonly number[]
  scrollerProps: ScrollerEventHandlers
  isScrollToBottomButtonVisible: boolean
  /**
   * The user directly interacted with the message area (pointer / keyboard —
   * the host wires this to capture-phase input events on the
   * scroller). The runtime hands them the wheel: it stops driving scrollTop
   * (bottom-follow, smooth scroll) and instead freezes the viewport against
   * every layout change, until the user scrolls back to the effective bottom
   * or an explicit scroll-to-bottom runs.
   */
  takeUserControl(preferredAnchor?: Element | null): void
  /** Recover runtime ownership after a local disclosure collapses at the real bottom. */
  releaseUserControlIfAtBottomAfterLayout(): void
  scrollToBottom(behavior?: ScrollBehavior): void
  /** Capture the current one-viewport decision for the next successful local send. */
  captureLocalSendScrollEligibility(): void
  /**
   * Mark that a real user scroll input just happened. Wheel is wired through
   * `scrollerProps.onWheel`; the host calls this for pointer drags and
   * keyboard scroll commands. Direct clicks use `takeUserControl` without
   * marking scroll intent.
   */
  markUserInput(): void
  /** Keep native scrollbar ownership latched until the pointer is actually released. */
  beginScrollbarDrag(): void
  /** Finish a native scrollbar drag and anchor the viewport at its final position. */
  endScrollbarDrag(): void
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100
// During a programmatic bottom-follow, scroll events fire as the viewport
// catches up. A small negative delta is noise (trackpad inertia, subpixel
// rounding, virtualization remeasure), not intent — only an upward move beyond
// this many pixels counts as the user taking control back.
const SCROLL_TAKEOVER_THRESHOLD_PX = 6
// A real scroll-intent signal (wheel, pointer drag, scroll key) seeds
// a gesture when its first scroll event arrives within this window. Once seeded,
// non-scrollbar gestures stay active until onScrollEnd, so trackpad momentum is
// not cut off by a timer. Native scrollbar drags use the pointer lifecycle below.
const USER_SCROLL_INPUT_WINDOW_MS = 250
// While the user holds the viewport frozen, snap scrollTop back to the freeze
// anchor when a layout change drifts it by more than this. Kept above
// subpixel/rounding noise so an already-stable viewport never churns.
const FREEZE_REASSERT_TOLERANCE_PX = 2
const FREEZE_SEMANTIC_ANCHOR_SELECTOR =
  'button,[role="button"],a,input,textarea,select,h1,h2,h3,h4,h5,h6,.block-wrapper,[data-message-id],p,pre,li,table'

export function useChatVirtualizerRuntime<T>({
  items,
  getItemKey,
  renderItem,
  onReachTop,
  hasMoreTop,
  handleRef,
  topReachOverscanItems,
  topPadding = 0,
  topicId,
  bottomPadding,
  localSendGeneration,
  keepMountedKeys = []
}: ChatVirtualizerRuntimeOptions<T>): ChatVirtualizerRuntime<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const freezeSpacerRef = useRef<HTMLDivElement | null>(null)
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)
  const [isScrollToBottomButtonVisible, setIsScrollToBottomButtonVisible] = useState(false)
  const isScrollToBottomButtonVisibleRef = useRef(false)
  const wasMoreThanOneViewportFromBottomRef = useRef(false)
  const pendingLocalSendBottomFollowEligibilityRef = useRef<boolean | null>(null)

  const atBottom = useAtBottomTracker()
  // Who drives scrollTop right now. 'runtime': bottom-follow and smooth
  // navigation write it. 'user': the user took over (any direct interaction
  // with the message area, or an upward scroll-away) — runtime writers go idle
  // and the viewport is instead FROZEN against layout changes (see the freeze
  // anchor below). Hands back to 'runtime' at the bottom or when the user
  // explicitly navigates there.
  const scrollDriverRef = useRef<'runtime' | 'user'>('runtime')
  // Viewport freeze anchor while the user drives. Stable item identity survives
  // history prepends; a visible DOM element preserves position through reflow
  // inside one large MessageGroup. The item-relative offset is the fallback when
  // that element is replaced or virtualized.
  const freezeAnchorRef = useRef<FreezeAnchor | null>(null)
  // Temporary bottom slack keeps the old scroll range available when a collapse
  // or late render makes content shorter while the user owns the viewport.
  const freezeSpacerHeightRef = useRef(0)
  const freezeBaselineScrollHeightRef = useRef<number | null>(null)
  // A timestamp only starts a genuine scroll gesture. Trackpad/keyboard motion
  // remains active until scrollend; a native scrollbar drag has its own latch.
  const lastUserInputAtRef = useRef(0)
  const lastUserInputDirectionRef = useRef<'up' | 'down' | 'none'>('none')
  const userScrollGestureRef = useRef(false)
  const scrollbarDragActiveRef = useRef(false)
  const readNavigationActiveRef = useRef(false)
  const markUserInput = useCallback(() => {
    lastUserInputAtRef.current = performance.now()
    lastUserInputDirectionRef.current = 'none'
  }, [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const getItemKeyRef = useRef(getItemKey)
  getItemKeyRef.current = getItemKey
  const renderItemRef = useRef(renderItem)
  renderItemRef.current = renderItem
  const findDataIndexByKey = useCallback((key: string): number => {
    const list = itemsRef.current
    const get = getItemKeyRef.current
    for (let i = 0; i < list.length; i++) {
      if (get(list[i], i) === key) return i
    }
    return -1
  }, [])
  const getDataKeyAtIndex = useCallback((index: number): string | null => {
    const list = itemsRef.current
    if (index < 0 || index >= list.length) return null
    return getItemKeyRef.current(list[index], index)
  }, [])
  const bottomFollowInsetRef = useRef(0)
  bottomFollowInsetRef.current = freezeSpacerHeightRef.current
  const setFreezeSpacerHeight = useCallback((height: number) => {
    const next = Math.max(0, height)
    if (Math.abs(next - freezeSpacerHeightRef.current) <= FREEZE_REASSERT_TOLERANCE_PX) return
    freezeSpacerHeightRef.current = next
    bottomFollowInsetRef.current = next
    if (freezeSpacerRef.current) {
      freezeSpacerRef.current.style.height = `${next}px`
    }
  }, [])
  const getNaturalScrollHeight = useCallback(() => {
    const el = scrollerRef.current
    return el ? Math.max(el.clientHeight, el.scrollHeight - freezeSpacerHeightRef.current) : 0
  }, [])
  const maintainFreezeScrollRange = useCallback(() => {
    const naturalHeight = getNaturalScrollHeight()
    const baseline = freezeBaselineScrollHeightRef.current ?? naturalHeight
    freezeBaselineScrollHeightRef.current = baseline
    setFreezeSpacerHeight(Math.max(0, baseline - naturalHeight))
  }, [getNaturalScrollHeight, setFreezeSpacerHeight])
  const clearFreeze = useCallback(() => {
    freezeAnchorRef.current = null
    freezeBaselineScrollHeightRef.current = null
    userScrollGestureRef.current = false
    setFreezeSpacerHeight(0)
  }, [setFreezeSpacerHeight])
  const isBottomFollowSuppressed = useCallback(() => scrollDriverRef.current === 'user', [])
  const getBottomFollowInset = useCallback(() => bottomFollowInsetRef.current, [])
  const autoStick = useAutoStickToBottom({
    scrollerRef,
    getBottomInset: getBottomFollowInset,
    smoothScroll,
    isAtBottom: atBottom.isAtBottom,
    isLocked: isBottomFollowSuppressed,
    markStuck: atBottom.notifyProgrammaticStick
  })

  const getLocalSendBottomFollowEligibility = useCallback((): boolean | null => {
    const el = scrollerRef.current
    return el ? !isMoreThanOneViewportFromBottom(el, bottomFollowInsetRef.current) : null
  }, [])

  const captureLocalSendScrollEligibility = useCallback(() => {
    pendingLocalSendBottomFollowEligibilityRef.current = getLocalSendBottomFollowEligibility()
  }, [getLocalSendBottomFollowEligibility])

  const refreshPendingLocalSendEligibilityAfterUserInput = useCallback(() => {
    if (pendingLocalSendBottomFollowEligibilityRef.current === null) return
    const eligibility = getLocalSendBottomFollowEligibility()
    if (eligibility !== null) {
      pendingLocalSendBottomFollowEligibilityRef.current = eligibility
    }
  }, [getLocalSendBottomFollowEligibility])

  const updateScrollToBottomButtonVisibility = useCallback(() => {
    const el = scrollerRef.current
    const isMoreThanOneViewportAway = el ? isMoreThanOneViewportFromBottom(el, bottomFollowInsetRef.current) : false
    wasMoreThanOneViewportFromBottomRef.current = isMoreThanOneViewportAway
    const nextVisible = !smoothScroll.isAnimating() && isMoreThanOneViewportAway
    if (isScrollToBottomButtonVisibleRef.current === nextVisible) return
    isScrollToBottomButtonVisibleRef.current = nextVisible
    setIsScrollToBottomButtonVisible(nextVisible)
  }, [smoothScroll])

  const hideScrollToBottomButton = useCallback(() => {
    if (!isScrollToBottomButtonVisibleRef.current) return
    isScrollToBottomButtonVisibleRef.current = false
    setIsScrollToBottomButtonVisible(false)
  }, [])

  // ---- user-held viewport freeze --------------------------------------

  const resolveSemanticAnchor = useCallback((preferredAnchor?: Element | null) => {
    const scroller = scrollerRef.current
    if (!scroller) return null
    let candidate = preferredAnchor
    if (!candidate) {
      const rect = scroller.getBoundingClientRect()
      candidate = scroller.ownerDocument.elementFromPoint?.(rect.left + rect.width / 2, rect.top + 1) ?? null
    }
    const htmlCandidate = candidate instanceof HTMLElement ? candidate : candidate?.parentElement
    if (!htmlCandidate || !scroller.contains(htmlCandidate)) return null
    const itemElement = htmlCandidate.closest<HTMLElement>('[data-message-key]')
    const itemKey = itemElement?.dataset.messageKey
    if (!itemElement || !itemKey) return null
    const semanticElement = htmlCandidate.closest<HTMLElement>(FREEZE_SEMANTIC_ANCHOR_SELECTOR) ?? htmlCandidate
    return itemElement.contains(semanticElement) ? { element: semanticElement, itemKey } : null
  }, [])

  // Capture stable item identity plus an optional visible DOM element. Virtua's
  // findItemIndex expects the raw scroller-relative offset and applies
  // startMargin internally, so topPadding must not be subtracted here.
  const captureFreezeAnchor = useCallback(
    (preferredAnchor?: Element | null) => {
      const el = scrollerRef.current
      const handle = vlistHandleRef.current
      if (!el || !handle) return
      const semantic = resolveSemanticAnchor(preferredAnchor)
      const visibleIndex = handle.findItemIndex(el.scrollTop)
      const fallbackIndex = Math.min(Math.max(visibleIndex, 0), itemsRef.current.length - 1)
      const semanticIndex = semantic ? findDataIndexByKey(semantic.itemKey) : -1
      const itemIndex = semanticIndex >= 0 ? semanticIndex : fallbackIndex
      const itemKey = getDataKeyAtIndex(itemIndex)
      if (!itemKey) {
        freezeAnchorRef.current = null
        return
      }
      const scrollerTop = el.getBoundingClientRect().top
      const element = semantic?.element ?? null
      freezeAnchorRef.current = {
        itemKey,
        offsetInItem: el.scrollTop - (Math.max(0, topPadding) + handle.getItemOffset(itemIndex)),
        element,
        elementViewportTop: element ? element.getBoundingClientRect().top - scrollerTop : null
      }
    },
    [findDataIndexByKey, getDataKeyAtIndex, resolveSemanticAnchor, topPadding]
  )

  // Re-assert the semantic element first so reflow inside one large virtual item
  // is covered. If React replaced that element, fall back to the stable item key
  // and its current virtua offset. Active user scrolling is never fought; the
  // resting semantic anchor is captured once at scrollend.
  const reassertFreeze = useCallback(() => {
    const frozen = freezeAnchorRef.current
    const el = scrollerRef.current
    const content = contentRef.current
    const handle = vlistHandleRef.current
    if (!frozen || !el || !handle) return
    if (smoothScroll.isAnimating() || userScrollGestureRef.current || scrollbarDragActiveRef.current) return

    const itemIndex = findDataIndexByKey(frozen.itemKey)
    if (itemIndex < 0) {
      freezeAnchorRef.current = null
      return
    }

    const elementItemKey = frozen.element?.closest<HTMLElement>('[data-message-key]')?.dataset.messageKey
    if (
      frozen.element &&
      frozen.elementViewportTop != null &&
      frozen.element.isConnected &&
      content?.contains(frozen.element) &&
      elementItemKey === frozen.itemKey
    ) {
      const currentTop = frozen.element.getBoundingClientRect().top - el.getBoundingClientRect().top
      const drift = currentTop - frozen.elementViewportTop
      if (Math.abs(drift) > FREEZE_REASSERT_TOLERANCE_PX) {
        el.scrollTop += drift
      }
      return
    }

    const target = Math.max(0, topPadding) + handle.getItemOffset(itemIndex) + frozen.offsetInItem
    if (Math.abs(el.scrollTop - target) > FREEZE_REASSERT_TOLERANCE_PX) {
      el.scrollTop = target
    }
  }, [findDataIndexByKey, smoothScroll, topPadding])

  // Any direct user interaction with the message area hands them the wheel:
  // cancel runtime writers, latch the at-bottom tracker into its protected
  // `user-scrolled-up` state (a plain reset would be re-latched by the very next
  // in-tolerance size change), and freeze the viewport where it stands. A click
  // alone does not resample a pending local send; only a real scroll or an
  // explicit return to the bottom may change that captured decision.
  const takeUserControl = useCallback(
    (preferredAnchor?: Element | null) => {
      readNavigationActiveRef.current = false
      smoothScroll.cancel()
      const wasUserDriven = scrollDriverRef.current === 'user'
      scrollDriverRef.current = 'user'
      atBottom.notifyUserTookControl()
      if (!wasUserDriven) {
        setFreezeSpacerHeight(0)
        freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
      }
      captureFreezeAnchor(preferredAnchor)
      updateScrollToBottomButtonVisibility()
    },
    [
      atBottom,
      captureFreezeAnchor,
      getNaturalScrollHeight,
      setFreezeSpacerHeight,
      smoothScroll,
      updateScrollToBottomButtonVisibility
    ]
  )

  const beginScrollbarDrag = useCallback(() => {
    scrollbarDragActiveRef.current = true
    markUserInput()
  }, [markUserInput])

  const beginUserScrollGesture = useCallback(() => {
    if (userScrollGestureRef.current) return
    // Any slack belongs to the old resting position. Once the user moves the
    // native thumb, its live scroll range must be the only range in play.
    setFreezeSpacerHeight(0)
    freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
    userScrollGestureRef.current = true
  }, [getNaturalScrollHeight, setFreezeSpacerHeight])

  const settleUserScrollGesture = useCallback(() => {
    if (scrollDriverRef.current !== 'user' || !userScrollGestureRef.current) {
      userScrollGestureRef.current = false
      return
    }
    // Rebase after virtua has measured the newly visited rows. Carrying the
    // pre-drag estimate forward creates phantom range when the thumb reverses.
    setFreezeSpacerHeight(0)
    freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
    captureFreezeAnchor()
    userScrollGestureRef.current = false
  }, [captureFreezeAnchor, getNaturalScrollHeight, setFreezeSpacerHeight])

  const endScrollbarDrag = useCallback(() => {
    if (!scrollbarDragActiveRef.current) return
    scrollbarDragActiveRef.current = false
    settleUserScrollGesture()
  }, [settleUserScrollGesture])

  const handBackToRuntime = useCallback(() => {
    scrollDriverRef.current = 'runtime'
    clearFreeze()
  }, [clearFreeze])

  const releaseUserControlIfAtBottomAfterLayout = useCallback(() => {
    const requestedScroller = scrollerRef.current
    // Local disclosures request recovery in the same event that schedules their
    // React update. Capture eligibility now, before a shrink can move the real
    // bottom above a preserved reading position and make negative distance look
    // like "already at bottom". The tracker covers non-interaction transitions
    // (for example stream completion) that request recovery after their commit.
    const shouldRecoverAfterLayout =
      atBottom.isAtBottom() ||
      (requestedScroller !== null &&
        Math.abs(getRealBottom(requestedScroller, bottomFollowInsetRef.current) - requestedScroller.scrollTop) <=
          FREEZE_REASSERT_TOLERANCE_PX)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollerRef.current
        if (!el || scrollDriverRef.current !== 'user') return
        if (!shouldRecoverAfterLayout) return
        const realBottom = getRealBottom(el, bottomFollowInsetRef.current)
        // Freeze slack can hold scrollTop below the natural content edge after
        // a disclosure shrinks. That still represents the live bottom; only a
        // viewport genuinely above it must retain user ownership.
        if (realBottom - el.scrollTop > FREEZE_REASSERT_TOLERANCE_PX) return

        handBackToRuntime()
        el.scrollTop = realBottom
        atBottom.notifyProgrammaticStick()
        hideScrollToBottomButton()
      })
    })
  }, [atBottom, handBackToRuntime, hideScrollToBottomButton])

  const stickToEffectiveBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    smoothScroll.cancel()
    el.scrollTop = getRealBottom(el, bottomFollowInsetRef.current)
    atBottom.notifyProgrammaticStick()
    hideScrollToBottomButton()
  }, [atBottom, hideScrollToBottomButton, smoothScroll])

  // ---- wrap items with stable DOM identity -----------------------------

  const dataKeys = useMemo(() => items.map((value, i) => getItemKey(value, i)), [items, getItemKey])
  const previousDataKeysRef = useRef<string[]>([])
  const previousDataKeys = previousDataKeysRef.current
  const addedAtStart =
    previousDataKeys.length > 0 &&
    dataKeys.length > previousDataKeys.length &&
    dataKeys.indexOf(previousDataKeys[0]) > 0
  const removedFromStart =
    dataKeys.length > 0 && dataKeys.length < previousDataKeys.length && previousDataKeys.indexOf(dataKeys[0]) > 0
  const shift = addedAtStart || removedFromStart

  useEffect(() => {
    previousDataKeysRef.current = dataKeys
  }, [dataKeys])

  const wrappedItems = useMemo<WrappedItem<T>[]>(
    () =>
      items.map((value, i) => ({
        key: dataKeys[i],
        value,
        originalIndex: i
      })),
    [dataKeys, items]
  )

  const wrappedRenderItem = useCallback((item: WrappedItem<T>) => {
    // Tag with data-message-index so the selectionchange listener can
    // map a text selection back to a data index for keepMounted.
    return (
      <div key={item.key} data-message-index={item.originalIndex} data-message-key={item.key} style={{ width: '100%' }}>
        {renderItemRef.current(item.value, item.originalIndex)}
      </div>
    )
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
    isAnimating: smoothScroll.isAnimating
  })

  // ---- ResizeObserver: viewport freeze + auto-stick --------------------

  useLayoutEffect(() => {
    const content = contentRef.current
    const scroller = scrollerRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const userDrives = scrollDriverRef.current === 'user'
      const shouldHoldRestingViewport = userDrives && !userScrollGestureRef.current && !scrollbarDragActiveRef.current
      if (shouldHoldRestingViewport) {
        // Restore range from the currently committed DOM before re-asserting
        // scrollTop. Disclosure collapse may already have let the browser clamp
        // the frozen viewport.
        maintainFreezeScrollRange()
      }
      // Locked (a no-op write-wise) while the user drives, but keeps its
      // scroll-size bookkeeping current for when the runtime takes back over.
      autoStick.onContentSizeChange()
      if (shouldHoldRestingViewport) {
        // The single writer while the user drives: hold the frozen viewport
        // against whatever just resized (streaming growth, block toggles,
        // composer/viewport changes, async renders).
        maintainFreezeScrollRange()
        reassertFreeze()
      } else if (!userDrives) {
        // Feed the at-bottom tracker so its state machine stays current.
        const el = scrollerRef.current
        if (el && !smoothScroll.isAnimating()) {
          const viewportSize = el.clientHeight
          atBottom.notifySizeChange({
            offset: el.scrollTop,
            scrollSize: getEffectiveScrollSize(el, bottomFollowInsetRef.current),
            viewportSize
          })
        }
      }
      updateScrollToBottomButtonVisibility()
    })
    observer.observe(content)
    // Also observe the scroller — the composer can expand (long paste) and
    // shrink the viewport without changing content height. Without this, the
    // freeze range stays sized for the old viewport and turns into phantom scroll
    // room below the messages.
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [
    atBottom,
    autoStick,
    maintainFreezeScrollRange,
    reassertFreeze,
    smoothScroll,
    updateScrollToBottomButtonVisibility
  ])

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
      lastUserInputDirectionRef.current = dir
      if (readNavigationActiveRef.current && dir !== 'none') {
        takeUserControl()
      }
      if (smoothScroll.isAnimating() && dir === 'up') {
        smoothScroll.cancel()
      }
      lastWheelDirRef.current = dir
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = setTimeout(() => {
        lastWheelDirRef.current = 'none'
      }, SCROLL_WHEEL_DEBOUNCE_MS)
    },
    [markUserInput, smoothScroll, takeUserControl]
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
    // Only a genuine user scroll (recent wheel / pointer / keyboard) is treated as
    // intent. virtua's remeasure-compensation jumps and child `scrollIntoView`
    // calls also fire scroll events, with no preceding input.
    const recentInputDirection = lastUserInputDirectionRef.current
    const inputDirectionMatchesScroll =
      recentInputDirection === 'none' || delta === 0 || (recentInputDirection === 'up' ? delta < 0 : delta > 0)
    const hasRecentUserScrollIntent =
      performance.now() - lastUserInputAtRef.current < USER_SCROLL_INPUT_WINDOW_MS && inputDirectionMatchesScroll
    const isUserInitiated = scrollbarDragActiveRef.current || userScrollGestureRef.current || hasRecentUserScrollIntent
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
    const realBottom = getRealBottom(el, bottomFollowInsetRef.current)
    const shouldReassertBottomAfterProgrammaticDrift =
      !isUserInitiated &&
      scrollDriverRef.current === 'runtime' &&
      atBottom.isAtBottom() &&
      realBottom - offset > FREEZE_REASSERT_TOLERANCE_PX
    if (shouldReassertBottomAfterProgrammaticDrift) {
      // Virtua may compensate a just-measured bottom item in the opposite
      // direction of the user's final downward wheel. There is no resize for
      // auto-stick to observe, so restore the live edge from the scroll event
      // itself instead of leaving a persistent gap until the next line wraps.
      lastScrollOffsetRef.current = offset
      stickToEffectiveBottom()
      return
    }
    const viewportSize = el.clientHeight
    const scrollSize = getEffectiveScrollSize(el, bottomFollowInsetRef.current)
    const wheelDir = lastWheelDirRef.current
    const direction: 'up' | 'down' | 'none' =
      wheelDir !== 'none' ? wheelDir : delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
    lastScrollOffsetRef.current = offset
    if (scrollDriverRef.current === 'user') {
      if (isUserInitiated) {
        beginUserScrollGesture()
        atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction, userInitiated: true })
        const hasTemporaryBottomRange = bottomFollowInsetRef.current > FREEZE_REASSERT_TOLERANCE_PX
        if (atBottom.isAtBottom()) {
          handBackToRuntime()
          if (hasTemporaryBottomRange) stickToEffectiveBottom()
        }
      } else {
        // A content shrink can clamp scrollTop before this runtime's
        // ResizeObserver runs, and virtua may apply its own remeasure
        // compensation after that observer. Close both ordering windows at the
        // scroll boundary: restore any lost range, then re-assert the viewport
        // anchor synchronously before the browser paints the drift.
        maintainFreezeScrollRange()
        reassertFreeze()
        updateScrollToBottomButtonVisibility()
        saveScrollPosition()
        return
      }
    } else {
      if (isUserInitiated && direction === 'up') {
        beginUserScrollGesture()
        // An upward user scroll is a takeover like any other interaction.
        takeUserControl()
      } else {
        atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction, userInitiated: isUserInitiated })
        if (isUserInitiated && direction !== 'none' && !atBottom.isAtBottom()) {
          beginUserScrollGesture()
          takeUserControl()
        }
      }
    }
    updateScrollToBottomButtonVisibility()
    if (isUserInitiated) {
      refreshPendingLocalSendEligibilityAfterUserInput()
    }
    saveScrollPosition()
    maybeNotifyReachTop(offset)
  }, [
    atBottom,
    beginUserScrollGesture,
    handBackToRuntime,
    maintainFreezeScrollRange,
    maybeNotifyReachTop,
    reassertFreeze,
    refreshPendingLocalSendEligibilityAfterUserInput,
    saveScrollPosition,
    smoothScroll,
    stickToEffectiveBottom,
    takeUserControl,
    updateScrollToBottomButtonVisibility
  ])

  const onScrollEnd = useCallback(() => {
    lastWheelDirRef.current = 'none'
    // virtua synthesizes scroll-end after a short quiet period. A user can
    // still be holding the native thumb while pausing to reverse direction.
    if (!scrollbarDragActiveRef.current) {
      settleUserScrollGesture()
    }
    // Scrolling has settled — capture the exact resting position, bypassing the
    // throttle that paces the in-flight `onScroll` saves.
    saveScrollPosition(true)
  }, [saveScrollPosition, settleUserScrollGesture])
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
      const scroller = scrollerRef.current
      const ownerScroller = indexed?.closest('[data-message-virtual-list-scroller]')
      if (!indexed || !scroller || ownerScroller !== scroller) {
        setSelectionIndex(null)
        return
      }
      const idx = Number(indexed.getAttribute('data-message-index'))
      setSelectionIndex(Number.isInteger(idx) ? idx : null)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  const keepMounted = useMemo<readonly number[]>(() => {
    const indices = new Set<number>()
    if (selectionIndex != null) indices.add(selectionIndex)
    for (const key of keepMountedKeys) {
      const index = items.findIndex((item, itemIndex) => getItemKey(item, itemIndex) === key)
      if (index >= 0) indices.add(index)
    }
    return [...indices].filter((index) => Number.isInteger(index) && index >= 0 && index < items.length)
  }, [getItemKey, items, keepMountedKeys, selectionIndex])

  // ---- imperative API -------------------------------------------------

  const navigateForReading = useCallback(
    (
      getTarget: (scroller: HTMLElement) => number,
      behavior: ScrollBehavior,
      getPreferredAnchor?: () => Element | null
    ) => {
      const el = scrollerRef.current
      if (!el) return

      readNavigationActiveRef.current = false
      smoothScroll.cancel()
      handBackToRuntime()
      atBottom.notifyUserTookControl()

      const resolveTarget = () => {
        const current = scrollerRef.current
        if (!current) return 0
        return Math.min(getRealBottom(current, bottomFollowInsetRef.current), Math.max(0, getTarget(current)))
      }
      const finish = () => {
        if (!readNavigationActiveRef.current) return
        readNavigationActiveRef.current = false
        takeUserControl(getPreferredAnchor?.() ?? null)
      }

      if (behavior === 'smooth') {
        readNavigationActiveRef.current = true
        smoothScroll.scrollTo(resolveTarget, { onComplete: finish })
      } else {
        el.scrollTop = resolveTarget()
        takeUserControl(getPreferredAnchor?.() ?? null)
      }
    },
    [atBottom, handBackToRuntime, smoothScroll, takeUserControl]
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      if (pendingLocalSendBottomFollowEligibilityRef.current !== null) {
        pendingLocalSendBottomFollowEligibilityRef.current = true
      }
      readNavigationActiveRef.current = false
      // The user chose the live edge: drop the frozen range before resolving
      // the target.
      handBackToRuntime()
      const el = scrollerRef.current
      if (!el) return
      const target = getRealBottom(el, bottomFollowInsetRef.current)
      if (behavior === 'smooth') {
        smoothScroll.scrollTo(() => {
          const current = scrollerRef.current
          return current ? getRealBottom(current, bottomFollowInsetRef.current) : 0
        })
      } else {
        smoothScroll.cancel()
        el.scrollTop = target
      }
      atBottom.notifyProgrammaticStick()
      hideScrollToBottomButton()
    },
    [atBottom, handBackToRuntime, hideScrollToBottomButton, smoothScroll]
  )

  const observedLocalSendGenerationRef = useRef(localSendGeneration)
  const observedTopicIdRef = useRef(topicId)
  useLayoutEffect(() => {
    const previousGeneration = observedLocalSendGenerationRef.current
    const topicChanged = observedTopicIdRef.current !== topicId
    observedLocalSendGenerationRef.current = localSendGeneration
    observedTopicIdRef.current = topicId
    if (topicChanged || localSendGeneration === undefined || localSendGeneration === previousGeneration) {
      if (topicChanged) {
        pendingLocalSendBottomFollowEligibilityRef.current = null
      }
      return
    }
    const bottomFollowEligible =
      pendingLocalSendBottomFollowEligibilityRef.current ?? !wasMoreThanOneViewportFromBottomRef.current
    pendingLocalSendBottomFollowEligibilityRef.current = null
    if (!bottomFollowEligible) return
    // The action-time snapshot survives branch replacement and its layout
    // changes. Without one (for consumers that do not bind the capture API),
    // fall back to the latest one-viewport decision.
    scrollToBottom('instant')
  }, [localSendGeneration, scrollToBottom, topicId])

  const scrollToTop = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      navigateForReading(() => 0, behavior)
    },
    [navigateForReading]
  )

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom,
      scrollToTop,
      scrollToKey: (key, align = 'start') => {
        if (findDataIndexByKey(key) < 0) return
        navigateForReading(
          (scroller) => {
            const handle = vlistHandleRef.current
            const idx = findDataIndexByKey(key)
            if (!handle || idx < 0) return scroller.scrollTop
            const start = Math.max(0, topPadding) + handle.getItemOffset(idx)
            const size = handle.getItemSize(idx)
            if (align === 'center') return start - (scroller.clientHeight - size) / 2
            if (align === 'end') return start + size - scroller.clientHeight
            return start
          },
          'smooth',
          () => {
            const elements = contentRef.current?.querySelectorAll<HTMLElement>('[data-message-key]') ?? []
            return Array.from(elements).find((element) => element.dataset.messageKey === key) ?? null
          }
        )
      },
      scrollToElement: (element) => {
        navigateForReading(
          (scroller) => {
            if (!element.isConnected) return scroller.scrollTop
            return scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          },
          'smooth',
          () => (element.isConnected ? element : null)
        )
      },
      captureLocalSendScrollEligibility,
      isAtBottom: atBottom.isAtBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [
      atBottom.isAtBottom,
      captureLocalSendScrollEligibility,
      findDataIndexByKey,
      navigateForReading,
      scrollToBottom,
      scrollToTop,
      topPadding
    ]
  )

  return {
    scrollerRef,
    contentRef,
    freezeSpacerRef,
    vlistHandleRef,
    wrappedItems,
    wrappedRenderItem: wrappedRenderItem as ChatVirtualizerRuntime<T>['wrappedRenderItem'],
    shift,
    keepMounted,
    scrollerProps,
    isScrollToBottomButtonVisible,
    takeUserControl,
    releaseUserControlIfAtBottomAfterLayout,
    scrollToBottom,
    captureLocalSendScrollEligibility,
    markUserInput,
    beginScrollbarDrag,
    endScrollbarDrag
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
