/**
 * Chat-behavior runtime for the message virtualizer (orchestrator).
 *
 * Composes three focused hooks:
 *
 *   - `useViewportFollowState` — the sole product-level following/reading state.
 *   - `useAutoStickToBottom` — exact live-edge reconciliation while following.
 *   - `useSmoothScrollAnimation` — explicit reading navigation only.
 *
 * At any moment exactly one product mode decides how virtualizer adjustments
 * are reconciled:
 *
 *   - 'following' — every size change converges immediately on the live edge.
 *   - 'reading' — the viewport is frozen against a semantic message anchor.
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

import { getDistanceToBottom, getRealBottom, isMoreThanOneViewportFromBottom } from './scrollGeometry'
import { clampForwardedWheelDelta, findOutermostVerticalScrollContainer } from './ScrollOwnershipContext'
import { useAutoStickToBottom } from './useAutoStickToBottom'
import { useScrollPositionMemory } from './useScrollPositionMemory'
import { useSmoothScrollAnimation } from './useSmoothScrollAnimation'
import { type FollowingReason, type ReadingReason, useViewportFollowState } from './useViewportFollowState'

export interface MessageVirtualListHandle {
  scrollToBottom(): void
  scrollToTop(behavior?: ScrollBehavior): void
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  /** Base item for adjacent navigation: the latest item while following, otherwise the current explicit target. */
  getNavigationBaseKey(): string | null
  /** Smooth-scroll `element` to the requested viewport alignment, then freeze the viewport on it. */
  scrollToElement(element: HTMLElement, align?: 'start' | 'center'): void
  /** Center an exact text range immediately, then freeze the viewport on its rendered content. */
  scrollToRange(range: Range): void
  isFollowing(): boolean
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

interface ExplicitNavigationBase {
  key: string
  topicId?: string
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
  /** Enter reading mode for an explicit reading action and freeze its anchor. */
  takeUserControl(reason: ReadingReason, preferredAnchor?: Element | null): void
  scrollToBottom(): void
  /** Navigate within the outer message scroller under the reading-mode owner. */
  scrollToElement(element: HTMLElement): void
  /** Mark a wheel that will reach this viewport through native boundary chaining. */
  notifyWheelIntent(deltaY: number): void
  /** Apply a wheel forwarded from an isolated child document under this runtime's ownership. */
  scrollByWheel(deltaY: number): boolean
  /**
   * Mark that a real user scroll input just happened. Wheel is wired through
   * `scrollerProps.onWheel`; the host calls this for pointer drags and
   * keyboard scroll commands.
   */
  markUserInput(direction?: ScrollDirection): void
  /** Keep native scrollbar ownership latched until the pointer is actually released. */
  beginScrollbarDrag(): void
  /** Finish a native scrollbar drag and anchor the viewport at its final position. */
  endScrollbarDrag(): void
  /** Arm a candidate middle-click autoscroll; freeze still holds until scroll confirms it. */
  armAutoscrollCandidate(): void
  /** Confirm a candidate via real outer-scroller movement; starts freeze suppression. */
  confirmAutoscroll(): void
  /** Dismiss any candidate or confirmed autoscroll and re-anchor the viewport. */
  dismissAutoscroll(): void
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100
type ScrollDirection = 'up' | 'down' | 'none'
type PendingUserInput = { at: number; direction: ScrollDirection }
// scrollToKey animates smoothly for nearby targets but jumps instantly once the
// distance exceeds this many viewports — see the behavior choice in scrollToKey.
const LONG_JUMP_VIEWPORTS = 3
// A real scroll-intent signal (wheel, pointer drag, scroll key) seeds
// a gesture when its first scroll event arrives within this window. Once seeded,
// non-scrollbar gestures stay active until onScrollEnd, so trackpad momentum is
// not cut off by a timer. Native scrollbar drags use the pointer lifecycle below.
const USER_SCROLL_INPUT_WINDOW_MS = 250
// Middle-click autoscroll synthesizes scrollTop without wheel/pointer events.
// A middle press only arms a candidate; real outer-scroller movement must
// confirm it before freeze logic yields. Both candidate and confirmed states
// are time-bounded so a swallowed dismissal click cannot latch suppression.
const AUTOSCROLL_CANDIDATE_MS = 1500
const AUTOSCROLL_IDLE_MS = 250
// While the user holds the viewport frozen, snap scrollTop back to the freeze
// anchor when a layout change drifts it by more than this. Kept above
// subpixel/rounding noise so an already-stable viewport never churns.
const FREEZE_REASSERT_TOLERANCE_PX = 2
const FREEZE_SEMANTIC_ANCHOR_SELECTOR =
  'button,[role="button"],a,input,textarea,select,h1,h2,h3,h4,h5,h6,.block-wrapper,[data-message-id],p,pre,li,table'

function getScrollDirection(delta: number): ScrollDirection {
  return delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
}

function keysMatchAt(container: readonly string[], candidate: readonly string[], offset: number): boolean {
  return candidate.every((key, index) => container[index + offset] === key)
}

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
  keepMountedKeys = []
}: ChatVirtualizerRuntimeOptions<T>): ChatVirtualizerRuntime<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const freezeSpacerRef = useRef<HTMLDivElement | null>(null)
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)
  const [isScrollToBottomButtonVisible, setIsScrollToBottomButtonVisible] = useState(false)
  const isScrollToBottomButtonVisibleRef = useRef(false)
  const viewportFollow = useViewportFollowState()
  // Viewport freeze anchor while the user drives. Stable item identity survives
  // history prepends; a visible DOM element preserves position through reflow
  // inside one large MessageGroup. The item-relative offset is the fallback when
  // that element is replaced or virtualized.
  const freezeAnchorRef = useRef<FreezeAnchor | null>(null)
  // Temporary bottom slack keeps the old scroll range available when a collapse
  // or late render makes content shorter while the user owns the viewport.
  const freezeSpacerHeightRef = useRef(0)
  const freezeBaselineScrollHeightRef = useRef<number | null>(null)
  // Pending input only starts a genuine scroll gesture when a matching scroll arrives.
  // Trackpad/keyboard motion then remains active until scrollend; a native drag has its own latch.
  const pendingUserInputRef = useRef<PendingUserInput | null>(null)
  const userScrollGestureRef = useRef(false)
  const scrollbarDragActiveRef = useRef(false)
  const autoscrollActiveRef = useRef(false)
  const autoscrollCandidateRef = useRef(false)
  const autoscrollCandidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoscrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoscrollCandidateScrollTopRef = useRef<number | null>(null)
  const autoscrollSuppressConfirmRef = useRef(false)
  const autoscrollSuppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readNavigationActiveRef = useRef(false)
  const explicitNavigationBaseRef = useRef<ExplicitNavigationBase | null>(null)
  const lastScrollOffsetRef = useRef(0)
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelDirRef = useRef<ScrollDirection>('none')
  const clearAutoscrollSuppressTimer = useCallback(() => {
    if (autoscrollSuppressTimerRef.current) {
      clearTimeout(autoscrollSuppressTimerRef.current)
      autoscrollSuppressTimerRef.current = null
    }
    autoscrollSuppressConfirmRef.current = false
  }, [])
  const suppressNextAutoscrollConfirm = useCallback(() => {
    autoscrollSuppressConfirmRef.current = true
    if (autoscrollSuppressTimerRef.current) {
      clearTimeout(autoscrollSuppressTimerRef.current)
    }
    autoscrollSuppressTimerRef.current = setTimeout(() => {
      autoscrollSuppressConfirmRef.current = false
      autoscrollSuppressTimerRef.current = null
    }, 50)
  }, [])
  const markUserInput = useCallback((direction: ScrollDirection = 'none') => {
    pendingUserInputRef.current = { at: performance.now(), direction }
  }, [])
  const isUserScrollIntentPending = useCallback((direction: ScrollDirection = 'none') => {
    if (autoscrollActiveRef.current) return true
    const input = pendingUserInputRef.current
    if (!input) return false
    const directionMatches = input.direction === 'none' || direction === 'none' || input.direction === direction
    return performance.now() - input.at < USER_SCROLL_INPUT_WINDOW_MS && directionMatches
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
  const rememberNavigationBase = useCallback(
    (key: string) => {
      if (!scrollerRef.current || findDataIndexByKey(key) < 0) return
      explicitNavigationBaseRef.current = { key, topicId }
    },
    [findDataIndexByKey, topicId]
  )
  const getNavigationBaseKey = useCallback((): string | null => {
    if (viewportFollow.isFollowing()) {
      return getDataKeyAtIndex(itemsRef.current.length - 1)
    }
    const base = explicitNavigationBaseRef.current
    if (!base) return null
    if (base.topicId !== topicId || findDataIndexByKey(base.key) < 0) {
      explicitNavigationBaseRef.current = null
      return null
    }
    return base.key
  }, [findDataIndexByKey, getDataKeyAtIndex, topicId, viewportFollow])
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

  const hideScrollToBottomButton = useCallback(() => {
    if (!isScrollToBottomButtonVisibleRef.current) return
    isScrollToBottomButtonVisibleRef.current = false
    setIsScrollToBottomButtonVisible(false)
  }, [])

  const stickToEffectiveBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    smoothScroll.cancel()
    const target = getRealBottom(el, bottomFollowInsetRef.current)
    if (Math.abs(el.scrollTop - target) > FREEZE_REASSERT_TOLERANCE_PX) {
      suppressNextAutoscrollConfirm()
    }
    el.scrollTop = target
    lastScrollOffsetRef.current = target
    hideScrollToBottomButton()
  }, [hideScrollToBottomButton, smoothScroll, suppressNextAutoscrollConfirm])

  const autoStick = useAutoStickToBottom({
    isFollowing: viewportFollow.isFollowing,
    stickToBottom: stickToEffectiveBottom
  })

  const updateScrollToBottomButtonVisibility = useCallback(() => {
    const el = scrollerRef.current
    const nextVisible = el ? isMoreThanOneViewportFromBottom(el, bottomFollowInsetRef.current) : false
    if (isScrollToBottomButtonVisibleRef.current === nextVisible) return
    isScrollToBottomButtonVisibleRef.current = nextVisible
    setIsScrollToBottomButtonVisible(nextVisible)
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
    const semanticCandidate = htmlCandidate.closest<HTMLElement>(FREEZE_SEMANTIC_ANCHOR_SELECTOR) ?? htmlCandidate
    if (!itemElement.contains(semanticCandidate)) return null
    return {
      element: findOutermostVerticalScrollContainer(semanticCandidate, itemElement) ?? semanticCandidate,
      itemKey
    }
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
    if (
      smoothScroll.isAnimating() ||
      userScrollGestureRef.current ||
      scrollbarDragActiveRef.current ||
      autoscrollActiveRef.current
    )
      return

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
      frozen.element.getClientRects().length > 0 &&
      elementItemKey === frozen.itemKey
    ) {
      const currentTop = frozen.element.getBoundingClientRect().top - el.getBoundingClientRect().top
      const drift = currentTop - frozen.elementViewportTop
      if (Math.abs(drift) > FREEZE_REASSERT_TOLERANCE_PX) {
        suppressNextAutoscrollConfirm()
        el.scrollTop += drift
      }
      return
    }

    const target = Math.max(0, topPadding) + handle.getItemOffset(itemIndex) + frozen.offsetInItem
    if (Math.abs(el.scrollTop - target) > FREEZE_REASSERT_TOLERANCE_PX) {
      suppressNextAutoscrollConfirm()
      el.scrollTop = target
    }
  }, [findDataIndexByKey, smoothScroll, suppressNextAutoscrollConfirm, topPadding])

  // Explicit reading actions freeze the current semantic anchor. Passive DOM
  // events, ordinary clicks and virtualizer compensation never call this path.
  const takeUserControl = useCallback(
    (reason: ReadingReason, preferredAnchor?: Element | null) => {
      readNavigationActiveRef.current = false
      smoothScroll.cancel()
      const wasFollowing = viewportFollow.isFollowing()
      viewportFollow.enterReading(reason)
      if (wasFollowing || freezeBaselineScrollHeightRef.current === null) {
        setFreezeSpacerHeight(0)
        freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
      }
      captureFreezeAnchor(preferredAnchor)
      updateScrollToBottomButtonVisibility()
    },
    [
      captureFreezeAnchor,
      getNaturalScrollHeight,
      setFreezeSpacerHeight,
      smoothScroll,
      updateScrollToBottomButtonVisibility,
      viewportFollow
    ]
  )

  const beginScrollbarDrag = useCallback(() => {
    scrollbarDragActiveRef.current = true
    markUserInput()
  }, [markUserInput])

  const beginUserScrollGesture = useCallback(() => {
    // A real scroll has claimed the latest input, even when the gesture is already active.
    pendingUserInputRef.current = null
    if (userScrollGestureRef.current) return
    explicitNavigationBaseRef.current = null
    // Any slack belongs to the old resting position. Once the user moves the
    // native thumb, its live scroll range must be the only range in play.
    setFreezeSpacerHeight(0)
    freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
    userScrollGestureRef.current = true
  }, [getNaturalScrollHeight, setFreezeSpacerHeight])

  const settleUserScrollGesture = useCallback(() => {
    if (viewportFollow.isFollowing() || !userScrollGestureRef.current) {
      userScrollGestureRef.current = false
      return
    }
    // Rebase after virtua has measured the newly visited rows. Carrying the
    // pre-drag estimate forward creates phantom range when the thumb reverses.
    setFreezeSpacerHeight(0)
    freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
    captureFreezeAnchor()
    userScrollGestureRef.current = false
  }, [captureFreezeAnchor, getNaturalScrollHeight, setFreezeSpacerHeight, viewportFollow])

  const endScrollbarDrag = useCallback(() => {
    if (!scrollbarDragActiveRef.current) return
    scrollbarDragActiveRef.current = false
    settleUserScrollGesture()
  }, [settleUserScrollGesture])

  const clearAutoscrollCandidateTimer = useCallback(() => {
    if (autoscrollCandidateTimerRef.current) {
      clearTimeout(autoscrollCandidateTimerRef.current)
      autoscrollCandidateTimerRef.current = null
    }
  }, [])

  const clearAutoscrollIdleTimer = useCallback(() => {
    if (autoscrollIdleTimerRef.current) {
      clearTimeout(autoscrollIdleTimerRef.current)
      autoscrollIdleTimerRef.current = null
    }
  }, [])

  const endAutoscrollInternal = useCallback(() => {
    if (!autoscrollActiveRef.current) return
    autoscrollActiveRef.current = false
    clearAutoscrollIdleTimer()
    clearAutoscrollSuppressTimer()
    autoscrollCandidateScrollTopRef.current = null
    pendingUserInputRef.current = null
    if (wheelTimeoutRef.current) {
      clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = null
    }
    lastWheelDirRef.current = 'none'
    settleUserScrollGesture()
  }, [clearAutoscrollIdleTimer, clearAutoscrollSuppressTimer, settleUserScrollGesture])

  const dismissAutoscroll = useCallback(() => {
    const wasCandidate = autoscrollCandidateRef.current
    const wasActive = autoscrollActiveRef.current
    if (!wasCandidate && !wasActive) return
    autoscrollCandidateRef.current = false
    autoscrollCandidateScrollTopRef.current = null
    clearAutoscrollCandidateTimer()
    clearAutoscrollSuppressTimer()
    if (wasActive) {
      endAutoscrollInternal()
    }
  }, [clearAutoscrollCandidateTimer, clearAutoscrollSuppressTimer, endAutoscrollInternal])

  const beginAutoscroll = useCallback(() => {
    autoscrollCandidateRef.current = false
    autoscrollCandidateScrollTopRef.current = null
    clearAutoscrollCandidateTimer()
    clearAutoscrollSuppressTimer()
    if (autoscrollActiveRef.current) {
      clearAutoscrollIdleTimer()
    } else {
      autoscrollActiveRef.current = true
    }
    if (wheelTimeoutRef.current) {
      clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = null
    }
    lastWheelDirRef.current = 'none'
    markUserInput()
    clearAutoscrollIdleTimer()
    autoscrollIdleTimerRef.current = setTimeout(() => {
      autoscrollIdleTimerRef.current = null
      if (!autoscrollActiveRef.current) return
      autoscrollActiveRef.current = false
      autoscrollCandidateRef.current = true
      autoscrollCandidateScrollTopRef.current = scrollerRef.current?.scrollTop ?? null
      clearAutoscrollCandidateTimer()
      autoscrollCandidateTimerRef.current = setTimeout(() => {
        autoscrollCandidateRef.current = false
        autoscrollCandidateScrollTopRef.current = null
        autoscrollCandidateTimerRef.current = null
        clearAutoscrollSuppressTimer()
        pendingUserInputRef.current = null
        if (wheelTimeoutRef.current) {
          clearTimeout(wheelTimeoutRef.current)
          wheelTimeoutRef.current = null
        }
        lastWheelDirRef.current = 'none'
        settleUserScrollGesture()
      }, AUTOSCROLL_CANDIDATE_MS)
      pendingUserInputRef.current = null
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current)
        wheelTimeoutRef.current = null
      }
      lastWheelDirRef.current = 'none'
    }, AUTOSCROLL_IDLE_MS)
  }, [
    clearAutoscrollCandidateTimer,
    clearAutoscrollIdleTimer,
    clearAutoscrollSuppressTimer,
    markUserInput,
    settleUserScrollGesture
  ])

  const armAutoscrollCandidate = useCallback(() => {
    if (autoscrollCandidateRef.current || autoscrollActiveRef.current) {
      dismissAutoscroll()
      return
    }
    autoscrollCandidateRef.current = true
    autoscrollCandidateScrollTopRef.current = scrollerRef.current?.scrollTop ?? null
    clearAutoscrollCandidateTimer()
    autoscrollCandidateTimerRef.current = setTimeout(() => {
      autoscrollCandidateRef.current = false
      autoscrollCandidateScrollTopRef.current = null
      autoscrollCandidateTimerRef.current = null
    }, AUTOSCROLL_CANDIDATE_MS)
  }, [clearAutoscrollCandidateTimer, dismissAutoscroll])

  const confirmAutoscroll = useCallback(() => {
    if (autoscrollSuppressConfirmRef.current) return
    if (!autoscrollCandidateRef.current && !autoscrollActiveRef.current) return
    beginAutoscroll()
  }, [beginAutoscroll])

  useEffect(() => {
    return () => {
      clearAutoscrollCandidateTimer()
      clearAutoscrollIdleTimer()
      clearAutoscrollSuppressTimer()
    }
  }, [clearAutoscrollCandidateTimer, clearAutoscrollIdleTimer, clearAutoscrollSuppressTimer])

  const enterFollowingMode = useCallback(
    (reason: FollowingReason) => {
      explicitNavigationBaseRef.current = null
      viewportFollow.enterFollowing(reason)
      clearFreeze()
    },
    [clearFreeze, viewportFollow]
  )

  const prepareReadingNavigation = useCallback(() => {
    viewportFollow.enterReading('navigation')
    clearFreeze()
  }, [clearFreeze, viewportFollow])

  const enterReadingForRestore = useCallback(() => {
    viewportFollow.enterReading('restored-anchor')
    clearFreeze()
  }, [clearFreeze, viewportFollow])

  const settleReadingRestore = useCallback(() => {
    freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
    captureFreezeAnchor()
  }, [captureFreezeAnchor, getNaturalScrollHeight])

  const enterFollowingAfterRestore = useCallback(() => {
    enterFollowingMode('restored-bottom')
  }, [enterFollowingMode])

  // ---- wrap items with stable DOM identity -----------------------------

  const dataKeys = useMemo(() => items.map((value, i) => getItemKey(value, i)), [items, getItemKey])
  useLayoutEffect(() => {
    const base = explicitNavigationBaseRef.current
    if (base && (base.topicId !== topicId || !dataKeys.includes(base.key))) {
      explicitNavigationBaseRef.current = null
    }
  }, [dataKeys, topicId])
  const previousDataKeysRef = useRef(dataKeys)
  const previousDataKeys = previousDataKeysRef.current
  const lengthDelta = dataKeys.length - previousDataKeys.length
  const addedAtStart =
    previousDataKeys.length > 0 && lengthDelta > 0 && keysMatchAt(dataKeys, previousDataKeys, lengthDelta)
  const removedFromStart =
    dataKeys.length > 0 && lengthDelta < 0 && keysMatchAt(previousDataKeys, dataKeys, -lengthDelta)
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

  const wrappedRenderItem = useCallback(
    (item: WrappedItem<T>) => {
      // Keep the bottom inset inside the measured live item. Streaming growth
      // then expands the native scroll range before virtua refreshes its cache.
      const isLastItem = item.originalIndex === itemsRef.current.length - 1
      return (
        <div
          key={item.key}
          data-message-index={item.originalIndex}
          data-message-key={item.key}
          style={{ width: '100%', paddingBottom: isLastItem ? bottomPadding : undefined }}>
          {renderItemRef.current(item.value, item.originalIndex)}
        </div>
      )
    },
    [bottomPadding]
  )

  // ---- per-topic scroll position memory -------------------------------

  const { save: saveScrollPosition } = useScrollPositionMemory({
    topicId,
    itemCount: items.length,
    bottomPadding,
    scrollerRef,
    vlistHandleRef,
    getDataKeyAtIndex,
    findDataIndexByKey,
    shouldRestore: () => viewportFollow.getState().reason === 'initializing',
    isFollowing: viewportFollow.isFollowing,
    enterFollowingAfterRestore,
    enterReadingForRestore,
    settleReadingRestore,
    isAnimating: smoothScroll.isAnimating
  })

  // ---- ResizeObserver: viewport freeze + auto-stick --------------------

  useLayoutEffect(() => {
    const content = contentRef.current
    const scroller = scrollerRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const isReading = !viewportFollow.isFollowing()
      const shouldHoldRestingViewport =
        isReading && !userScrollGestureRef.current && !scrollbarDragActiveRef.current && !autoscrollActiveRef.current
      if (shouldHoldRestingViewport) {
        // Restore range from the currently committed DOM before re-asserting
        // scrollTop. Disclosure collapse may already have let the browser clamp
        // the frozen viewport.
        maintainFreezeScrollRange()
      }
      autoStick.onContentSizeChange()
      if (shouldHoldRestingViewport) {
        // The single writer while the user drives: hold the frozen viewport
        // against whatever just resized (streaming growth, block toggles,
        // composer/viewport changes, async renders).
        maintainFreezeScrollRange()
        // A fresh keyboard/pointer intent means a native scroll is in flight
        // but the gesture latch is not set yet (onScroll hasn't fired).
        // Suppress the snap-back so the native scroll can land; onScroll will
        // call beginUserScrollGesture() once it observes the real offset.
        if (!isUserScrollIntentPending()) {
          reassertFreeze()
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
    autoStick,
    isUserScrollIntentPending,
    maintainFreezeScrollRange,
    reassertFreeze,
    updateScrollToBottomButtonVisibility,
    viewportFollow
  ])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || typeof MutationObserver === 'undefined') return

    const observer = new MutationObserver(() => autoStick.onContentSizeChange())
    observer.observe(content, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [autoStick])

  // Initial scroll on mount is owned by `useScrollPositionMemory` above: it
  // restores the saved anchor for this topic, or scrolls to the newest message
  // when there is nothing to restore.

  // ---- scroll / wheel handlers ---------------------------------------

  const notifyWheelIntent = useCallback(
    (deltaY: number) => {
      const dir = getScrollDirection(deltaY)
      markUserInput(dir)
      if (readNavigationActiveRef.current && dir !== 'none') {
        takeUserControl('navigation')
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

  const scrollByWheel = useCallback(
    (deltaY: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return false

      const boundedDeltaY = clampForwardedWheelDelta(deltaY)
      notifyWheelIntent(boundedDeltaY)
      scroller.scrollBy({ top: boundedDeltaY })
      return true
    },
    [notifyWheelIntent]
  )

  const onWheel = useCallback((event: WheelEvent) => notifyWheelIntent(event.deltaY), [notifyWheelIntent])

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
    const pendingUserInput = pendingUserInputRef.current
    const deltaDirection = getScrollDirection(delta)
    const hasRecentUserScrollIntent = isUserScrollIntentPending(deltaDirection)
    if (
      pendingUserInput &&
      performance.now() - pendingUserInput.at < USER_SCROLL_INPUT_WINDOW_MS &&
      pendingUserInput.direction !== 'none' &&
      deltaDirection !== 'none' &&
      pendingUserInput.direction !== deltaDirection
    ) {
      pendingUserInputRef.current = null
    }
    const isUserInitiated =
      scrollbarDragActiveRef.current ||
      autoscrollActiveRef.current ||
      userScrollGestureRef.current ||
      hasRecentUserScrollIntent
    const wheelDir = lastWheelDirRef.current
    const direction = autoscrollActiveRef.current ? deltaDirection : wheelDir !== 'none' ? wheelDir : deltaDirection
    if (hasRecentUserScrollIntent && pendingUserInput?.direction === 'none' && direction !== 'none') {
      pendingUserInput.direction = direction
    }

    // Smooth scrolling is reserved for explicit reading navigation. Any real
    // directional user scroll cancels it; virtualizer compensation never does.
    // Wheel cancels in onWheel already — this covers scroll keys and native
    // scrollbar drags, in both directions: without it the next animation frame
    // would rewrite scrollTop and take the viewport away from the user.
    if (smoothScroll.isAnimating()) {
      if (!isUserInitiated || direction === 'none') {
        lastScrollOffsetRef.current = offset
        updateScrollToBottomButtonVisibility()
        return
      }
      smoothScroll.cancel()
      readNavigationActiveRef.current = false
      // Fall through: the user's scroll goes through the normal reading/bottom
      // reconciliation below (an End jump to the live bottom resumes following).
    }

    const distanceToBottom = getDistanceToBottom(el, bottomFollowInsetRef.current)
    const shouldReassertBottomAfterProgrammaticDrift =
      !isUserInitiated && viewportFollow.isFollowing() && Math.abs(distanceToBottom) > FREEZE_REASSERT_TOLERANCE_PX
    if (shouldReassertBottomAfterProgrammaticDrift) {
      // Virtua may compensate a just-measured bottom item in the opposite
      // direction of the user's final downward wheel. There is no resize for
      // auto-stick to observe, so restore the live edge from the scroll event
      // itself instead of leaving a persistent gap until the next line wraps.
      lastScrollOffsetRef.current = offset
      stickToEffectiveBottom()
      return
    }

    lastScrollOffsetRef.current = offset
    if (!viewportFollow.isFollowing()) {
      if (isUserInitiated) {
        beginUserScrollGesture()
        // Resuming follow requires this scroll to be tied to fresh real input.
        // The gesture latch alone is not enough: until scrollend it also covers
        // virtua's remeasure compensation, which must not hand the wheel back
        // just because it happened to land on the live bottom.
        if (hasRecentUserScrollIntent && direction !== 'up' && distanceToBottom <= FREEZE_REASSERT_TOLERANCE_PX) {
          enterFollowingMode('user-reached-bottom')
          stickToEffectiveBottom()
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
        maybeNotifyReachTop(offset)
        return
      }
    } else if (isUserInitiated && direction === 'up') {
      beginUserScrollGesture()
      takeUserControl('user-scrolled-up')
    }
    updateScrollToBottomButtonVisibility()
    saveScrollPosition()
    maybeNotifyReachTop(offset)
  }, [
    beginUserScrollGesture,
    enterFollowingMode,
    isUserScrollIntentPending,
    maintainFreezeScrollRange,
    maybeNotifyReachTop,
    reassertFreeze,
    saveScrollPosition,
    smoothScroll,
    stickToEffectiveBottom,
    takeUserControl,
    updateScrollToBottomButtonVisibility,
    viewportFollow
  ])

  const onScrollEnd = useCallback(() => {
    lastWheelDirRef.current = 'none'
    // virtua synthesizes scroll-end after a short quiet period. A user can
    // still be holding the native thumb while pausing to reverse direction.
    if (!scrollbarDragActiveRef.current) {
      settleUserScrollGesture()
      // A settled gesture already captured its resting anchor above. Only fill
      // in a missing anchor here — an existing one is often the semantic target
      // of a finished navigation and must not be replaced by whatever element
      // happens to sit at the viewport top.
      if (!viewportFollow.isFollowing() && !freezeAnchorRef.current) captureFreezeAnchor()
    }
    // Scrolling has settled — capture the exact resting position, bypassing the
    // throttle that paces the in-flight `onScroll` saves.
    saveScrollPosition(true)
  }, [captureFreezeAnchor, saveScrollPosition, settleUserScrollGesture, viewportFollow])
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

  // Reading navigations can only land within [0, realBottom]; both the scroll
  // itself and any distance measured against it must use this same bound.
  const clampToReachable = useCallback(
    (scroller: HTMLElement, target: number) =>
      Math.min(getRealBottom(scroller, bottomFollowInsetRef.current), Math.max(0, target)),
    []
  )

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
      prepareReadingNavigation()

      const resolveTarget = () => {
        const current = scrollerRef.current
        if (!current) return 0
        return clampToReachable(current, getTarget(current))
      }
      const finish = () => {
        if (!readNavigationActiveRef.current) return
        readNavigationActiveRef.current = false
        takeUserControl('navigation', getPreferredAnchor?.() ?? null)
      }

      if (behavior === 'smooth') {
        readNavigationActiveRef.current = true
        smoothScroll.scrollTo(resolveTarget, { onComplete: finish })
      } else {
        const target = resolveTarget()
        if (Math.abs(el.scrollTop - target) > FREEZE_REASSERT_TOLERANCE_PX) {
          suppressNextAutoscrollConfirm()
        }
        el.scrollTop = target
        takeUserControl('navigation', getPreferredAnchor?.() ?? null)
      }
    },
    [clampToReachable, prepareReadingNavigation, smoothScroll, suppressNextAutoscrollConfirm, takeUserControl]
  )

  const scrollToBottom = useCallback(() => {
    readNavigationActiveRef.current = false
    enterFollowingMode('scroll-to-bottom')
    stickToEffectiveBottom()
  }, [enterFollowingMode, stickToEffectiveBottom])

  const scrollToTop = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      const firstKey = getDataKeyAtIndex(0)
      if (firstKey) rememberNavigationBase(firstKey)
      navigateForReading(() => 0, behavior)
    },
    [getDataKeyAtIndex, navigateForReading, rememberNavigationBase]
  )

  const scrollToElement = useCallback(
    (element: HTMLElement, align: 'start' | 'center' = 'start') => {
      const itemKey = element.closest<HTMLElement>('[data-message-key]')?.dataset.messageKey
      if (itemKey) rememberNavigationBase(itemKey)
      navigateForReading(
        (scroller) => {
          if (!element.isConnected) return scroller.scrollTop
          const elementRect = element.getBoundingClientRect()
          const scrollerRect = scroller.getBoundingClientRect()
          const start = scroller.scrollTop + elementRect.top - scrollerRect.top
          return align === 'center' ? start - (scroller.clientHeight - elementRect.height) / 2 : start
        },
        'smooth',
        () => (element.isConnected ? element : null)
      )
    },
    [navigateForReading, rememberNavigationBase]
  )

  const scrollToRange = useCallback(
    (range: Range) => {
      const getRangeElement = () => {
        const container = range.commonAncestorContainer
        const element = container instanceof Element ? container : container.parentElement
        return element?.isConnected ? element : null
      }
      const scroller = scrollerRef.current
      if (!scroller || !getRangeElement()) return
      const itemKey = getRangeElement()?.closest<HTMLElement>('[data-message-key]')?.dataset.messageKey
      if (itemKey) rememberNavigationBase(itemKey)

      navigateForReading(
        (currentScroller) => {
          if (!getRangeElement()) return currentScroller.scrollTop

          const rangeRect = range.getBoundingClientRect()
          const scrollerRect = currentScroller.getBoundingClientRect()
          return (
            currentScroller.scrollTop +
            rangeRect.top -
            scrollerRect.top -
            (currentScroller.clientHeight - rangeRect.height) / 2
          )
        },
        'instant',
        getRangeElement
      )
    },
    [navigateForReading, rememberNavigationBase]
  )

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom,
      scrollToTop,
      scrollToKey: (key, align = 'start') => {
        if (findDataIndexByKey(key) < 0) return
        rememberNavigationBase(key)
        const resolveTarget = (scroller: HTMLElement) => {
          const handle = vlistHandleRef.current
          const idx = findDataIndexByKey(key)
          if (!handle || idx < 0) return scroller.scrollTop
          const start = Math.max(0, topPadding) + handle.getItemOffset(idx)
          const size = handle.getItemSize(idx)
          if (align === 'center') return start - (scroller.clientHeight - size) / 2
          if (align === 'end') return start + size - scroller.clientHeight
          return start
        }
        // Smooth-scrolling a long jump forces the virtualizer to mount and
        // discard every heavy message the animation flies over, frame by
        // frame — janky over hundreds of turns. Past a few viewports the
        // in-between content is never read anyway, so jump instantly and only
        // mount the destination window. Measure the distance from the clamped
        // target — the same reachable bound navigateForReading scrolls to —
        // so an out-of-range raw offset cannot inflate a short real movement
        // into an instant jump.
        const scroller = scrollerRef.current
        const behavior: ScrollBehavior =
          scroller &&
          Math.abs(clampToReachable(scroller, resolveTarget(scroller)) - scroller.scrollTop) >
            scroller.clientHeight * LONG_JUMP_VIEWPORTS
            ? 'instant'
            : 'smooth'
        navigateForReading(resolveTarget, behavior, () => {
          const elements = contentRef.current?.querySelectorAll<HTMLElement>('[data-message-key]') ?? []
          return Array.from(elements).find((element) => element.dataset.messageKey === key) ?? null
        })
      },
      getNavigationBaseKey,
      scrollToElement,
      scrollToRange,
      isFollowing: viewportFollow.isFollowing,
      getScrollElement: () => scrollerRef.current
    }),
    [
      clampToReachable,
      findDataIndexByKey,
      getNavigationBaseKey,
      navigateForReading,
      rememberNavigationBase,
      scrollToBottom,
      scrollToElement,
      scrollToRange,
      scrollToTop,
      topPadding,
      viewportFollow.isFollowing
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
    scrollToBottom,
    scrollToElement,
    notifyWheelIntent,
    scrollByWheel,
    markUserInput,
    beginScrollbarDrag,
    endScrollbarDrag,
    armAutoscrollCandidate,
    confirmAutoscroll,
    dismissAutoscroll
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
