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
 *
 * At any moment exactly one driver owns scrollTop (`scrollDriverRef`):
 *
 *   - 'runtime' — the hooks above drive: pin the fresh user message to the top,
 *     follow the streaming bottom, animate scrolls.
 *   - 'user' — the user took over (any pointer/keyboard interaction inside
 *     the scroller via `takeUserControl`, or an upward scroll-away). Runtime
 *     writers go idle and the viewport is frozen where the user holds it: every
 *     observed layout change re-asserts scrollTop against a freeze anchor, so
 *     streaming growth, block toggles and async renders cannot move what the
 *     user is reading or aiming at.
 *
 * The wheel goes back to the runtime when the user returns to the effective
 * bottom, on an explicit scroll command (scroll-to-bottom/top/key), and at turn
 * boundaries.
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
  scrollToTop(behavior?: ScrollBehavior): void
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  /** Smooth-scroll `element`'s top to the viewport top, then freeze the viewport on it. */
  scrollToElement(element: HTMLElement): void
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
  /** Stable item keys that must survive virtualization while they own live UI state. */
  keepMountedKeys?: readonly string[]
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
   * DOM size changes (item growth from streaming text, new items added,
   * spacer-height changes).
   */
  contentRef: RefObject<HTMLDivElement | null>
  /** Temporary bottom slack used to preserve scrollTop when frozen content shrinks. */
  freezeSpacerRef: RefObject<HTMLDivElement | null>
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
  /**
   * The user directly interacted with the message area (pointer / keyboard —
   * the host wires this to capture-phase input events on the
   * scroller). The runtime hands them the wheel: it stops driving scrollTop
   * (bottom-follow, smooth scroll) and instead freezes the viewport against
   * every layout change, until the user scrolls back to the effective bottom,
   * an explicit scroll-to-bottom runs, or a new turn begins.
   */
  takeUserControl(preferredAnchor?: Element | null): void
  /** Recover runtime ownership after a local disclosure collapses at the real bottom. */
  releaseUserControlIfAtBottomAfterLayout(): void
  scrollToBottom(behavior?: ScrollBehavior): void
  /**
   * Mark that a real user scroll input just happened. Wheel is wired through
   * `scrollerProps.onWheel`; the host calls this for pointer drags and
   * keyboard scroll commands. Direct clicks use `takeUserControl` without
   * marking scroll intent.
   */
  markUserInput(): void
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100
// During a programmatic bottom-follow, scroll events fire as the viewport
// catches up. A small negative delta is noise (trackpad inertia, subpixel
// rounding, virtualization remeasure), not intent — only an upward move beyond
// this many pixels counts as the user taking control back.
const SCROLL_TAKEOVER_THRESHOLD_PX = 6
// A real scroll-intent signal (wheel, pointer drag, scroll key) seeds
// a gesture when its first scroll event arrives within this window. Once seeded,
// the gesture stays active until onScrollEnd, so trackpad momentum and scrollbar
// drags are not cut off by a timer.
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
  scrollToTopKey,
  topicId,
  bottomPadding,
  preserveScrollAnchor = false,
  keepMountedKeys = []
}: ChatVirtualizerRuntimeOptions<T>): ChatVirtualizerRuntime<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const freezeSpacerRef = useRef<HTMLDivElement | null>(null)
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)
  const [isScrollToBottomButtonVisible, setIsScrollToBottomButtonVisible] = useState(false)
  const isScrollToBottomButtonVisibleRef = useRef(false)

  const atBottom = useAtBottomTracker()
  const preserveScrollAnchorRef = useRef(preserveScrollAnchor)
  preserveScrollAnchorRef.current = preserveScrollAnchor
  // Who drives scrollTop right now. 'runtime': top-pin, bottom-follow and smooth
  // scrolls write it. 'user': the user took over (any direct interaction with the
  // message area, or an upward scroll-away) — runtime writers go idle and the
  // viewport is instead FROZEN against layout changes (see the freeze anchor
  // below). Hands back to 'runtime' on the first streaming growth after any
  // released preparation spacer is consumed, on an explicit scroll-to-bottom,
  // and at turn boundaries.
  const scrollDriverRef = useRef<'runtime' | 'user'>('runtime')
  // Returning to the effective bottom while a released preparation spacer is
  // still present records follow intent without starting a second scrollTop
  // writer. The frozen viewport keeps ownership until natural content consumes
  // the spacer; ResizeObserver then performs one explicit handoff.
  const resumeFollowAfterSpacerRef = useRef(false)
  // True once governance has been handed from the top-pin to the at-bottom
  // tracker for the current streaming turn — the reply overflowed a viewport so
  // the pin released (ResizeObserver handoff below), or the user scrolled/was
  // brought past the pin. Once set, `preserveScrollAnchor` no longer suppresses
  // bottom-follow, so reaching the bottom re-engages auto-stick. Reset at the
  // start of each turn (see the pin effect and the preserve rising edge below).
  const turnHandedOffRef = useRef(false)
  // Viewport freeze anchor while the user drives. Stable item identity survives
  // history prepends; a visible DOM element preserves position through reflow
  // inside one large MessageGroup. The item-relative offset is the fallback when
  // that element is replaced or virtualized.
  const freezeAnchorRef = useRef<FreezeAnchor | null>(null)
  // Temporary bottom slack keeps the old scroll range available when a collapse
  // or late render makes content shorter while the user owns the viewport.
  const freezeSpacerHeightRef = useRef(0)
  const freezeBaselineScrollHeightRef = useRef<number | null>(null)
  // A timestamp only starts a genuine scroll gesture. The gesture itself remains
  // active until scrollend, which covers trackpad momentum and scrollbar drags.
  const lastUserInputAtRef = useRef(0)
  const lastUserInputDirectionRef = useRef<'up' | 'down' | 'none'>('none')
  const userScrollGestureRef = useRef(false)
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
  const anchor = useScrollAnchor({
    scrollerRef,
    contentRef,
    vlistHandleRef,
    smoothScroll,
    startMargin: topPadding
  })
  const bottomFollowInsetRef = useRef(0)
  bottomFollowInsetRef.current = anchor.spacerHeight + freezeSpacerHeightRef.current
  const setFreezeSpacerHeight = useCallback(
    (height: number) => {
      const next = Math.max(0, height)
      if (Math.abs(next - freezeSpacerHeightRef.current) <= FREEZE_REASSERT_TOLERANCE_PX) return
      freezeSpacerHeightRef.current = next
      bottomFollowInsetRef.current = anchor.spacerHeight + next
      if (freezeSpacerRef.current) {
        freezeSpacerRef.current.style.height = `${next}px`
      }
    },
    [anchor.spacerHeight]
  )
  const getNaturalScrollHeight = useCallback(() => {
    const el = scrollerRef.current
    return el ? Math.max(el.clientHeight, el.scrollHeight - freezeSpacerHeightRef.current) : 0
  }, [])
  const maintainFreezeScrollRange = useCallback(
    (pendingAnchorSpacerDelta = 0) => {
      const naturalHeight = getNaturalScrollHeight()
      const baseline = freezeBaselineScrollHeightRef.current ?? naturalHeight
      freezeBaselineScrollHeightRef.current = baseline
      // A pending spacer shrink will remove range on the next React commit, so
      // reserve it now. A pending growth does not provide range until it is in
      // the DOM; crediting it early leaves one frame where the browser can clamp
      // scrollTop before the anchor spacer commits.
      const pendingRangeLoss = Math.min(0, pendingAnchorSpacerDelta)
      setFreezeSpacerHeight(Math.max(0, baseline - (naturalHeight + pendingRangeLoss)))
    },
    [getNaturalScrollHeight, setFreezeSpacerHeight]
  )
  const clearFreeze = useCallback(() => {
    freezeAnchorRef.current = null
    freezeBaselineScrollHeightRef.current = null
    userScrollGestureRef.current = false
    setFreezeSpacerHeight(0)
  }, [setFreezeSpacerHeight])
  const isBottomFollowSuppressed = useCallback(
    () =>
      scrollDriverRef.current === 'user' ||
      anchor.isPinned() ||
      (preserveScrollAnchorRef.current && !turnHandedOffRef.current),
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
    (preferredAnchor?: Element | null, extendScrollRange = false) => {
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
      if (extendScrollRange) {
        const naturalHeight = getNaturalScrollHeight()
        freezeBaselineScrollHeightRef.current = Math.max(freezeBaselineScrollHeightRef.current ?? 0, naturalHeight)
      }
    },
    [findDataIndexByKey, getDataKeyAtIndex, getNaturalScrollHeight, resolveSemanticAnchor, topPadding]
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
    if (anchor.isPinned() || smoothScroll.isAnimating() || userScrollGestureRef.current) return

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
  }, [anchor, findDataIndexByKey, smoothScroll, topPadding])

  // Any direct user interaction with the message area hands them the wheel:
  // cancel runtime writers, latch the at-bottom tracker into its protected
  // `user-scrolled-up` state (a plain reset would be re-latched by the very next
  // in-tolerance size change), and freeze the viewport where it stands. An
  // active top-pin keeps holding instead of the freeze (same position, one
  // writer); the freeze takes over if the pin later lets go.
  const takeUserControl = useCallback(
    (preferredAnchor?: Element | null) => {
      resumeFollowAfterSpacerRef.current = false
      readNavigationActiveRef.current = false
      smoothScroll.cancel()
      const wasUserDriven = scrollDriverRef.current === 'user'
      scrollDriverRef.current = 'user'
      atBottom.notifyUserTookControl()
      if (!wasUserDriven) {
        setFreezeSpacerHeight(0)
        freezeBaselineScrollHeightRef.current = getNaturalScrollHeight()
      }
      captureFreezeAnchor(preferredAnchor, wasUserDriven)
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

  const handBackToRuntime = useCallback(() => {
    resumeFollowAfterSpacerRef.current = false
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
        if (preserveScrollAnchorRef.current && anchor.spacerHeight > FREEZE_REASSERT_TOLERANCE_PX) return
        const realBottom = getRealBottom(el, bottomFollowInsetRef.current)
        // Freeze slack can hold scrollTop below the natural content edge after
        // a disclosure shrinks. That still represents the live bottom; only a
        // viewport genuinely above it must retain user ownership.
        if (realBottom - el.scrollTop > FREEZE_REASSERT_TOLERANCE_PX) return

        turnHandedOffRef.current = true
        handBackToRuntime()
        el.scrollTop = realBottom
        atBottom.notifyProgrammaticStick()
        hideScrollToBottomButton()
      })
    })
  }, [anchor.spacerHeight, atBottom, handBackToRuntime, hideScrollToBottomButton])

  const stickToEffectiveBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    smoothScroll.cancel()
    el.scrollTop = getRealBottom(el, bottomFollowInsetRef.current)
    atBottom.notifyProgrammaticStick()
    hideScrollToBottomButton()
  }, [atBottom, hideScrollToBottomButton, smoothScroll])

  // ---- wrap items so the anchor's spacer is included ------------------

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
      let userDrives = scrollDriverRef.current === 'user'
      if (userDrives) {
        // Restore range from the currently committed DOM before the anchor can
        // re-assert scrollTop. Disclosure collapse may already have let the
        // browser clamp it while a larger React spacer is still pending.
        maintainFreezeScrollRange()
      }
      const wasBottomFollowSuppressed = isBottomFollowSuppressed()
      const wasPinned = anchor.isPinned()
      // Anchor first: it may adjust spacer height. Auto-stick reads
      // scrollHeight after, so any pin-driven layout change is reflected.
      const nextAnchorSpacerHeight = anchor.onContentSizeChange()
      const pendingAnchorSpacerDelta = nextAnchorSpacerHeight - anchor.spacerHeight
      const pinReleasedByContent = wasPinned && !anchor.isPinned()
      if (!userDrives && !anchor.isPinned() && anchor.spacerHeight > 0 && nextAnchorSpacerHeight === 0) {
        // Runtime follow consumed the released spacer budget completely. Seal
        // that budget so a later content shrink cannot resurrect blank range.
        anchor.release()
      }
      if (userDrives) {
        // The pin let go while the user holds the viewport: re-capture the freeze
        // where the pin left it instead of handing the turn to bottom-follow.
        if (pinReleasedByContent) captureFreezeAnchor()
      } else {
        // The pin let go because the reply outgrew the space below it (overflowed
        // a viewport). Hand the turn to bottom-follow: drop the preserve
        // suppression and snap to the live bottom so streaming now sticks to the
        // bottom instead of freezing the user message at the top.
        if (pinReleasedByContent && preserveScrollAnchorRef.current) {
          turnHandedOffRef.current = true
        }
        if (wasBottomFollowSuppressed || isBottomFollowSuppressed()) {
          atBottom.reset()
        }
      }
      const shouldResumeFollowOnThisGrowth =
        userDrives &&
        resumeFollowAfterSpacerRef.current &&
        preserveScrollAnchorRef.current &&
        !anchor.isPinned() &&
        anchor.spacerHeight <= FREEZE_REASSERT_TOLERANCE_PX &&
        nextAnchorSpacerHeight <= FREEZE_REASSERT_TOLERANCE_PX
      if (shouldResumeFollowOnThisGrowth) {
        // The previous layout pass consumed the final preparation spacer while
        // the viewport stayed frozen. This new content growth can now transfer
        // ownership before auto-stick runs, so normal smooth following resumes
        // without an intermediate instant jump.
        anchor.release()
        turnHandedOffRef.current = true
        handBackToRuntime()
        userDrives = false
      }
      // Locked (a no-op write-wise) while the user drives, but keeps its
      // scroll-size bookkeeping current for when the runtime takes back over.
      autoStick.onContentSizeChange()
      if (userDrives) {
        // The single writer while the user drives: hold the frozen viewport
        // against whatever just resized (streaming growth, block toggles,
        // composer/viewport changes, async renders).
        maintainFreezeScrollRange(pendingAnchorSpacerDelta)
        reassertFreeze()
      } else {
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
    captureFreezeAnchor,
    handBackToRuntime,
    isBottomFollowSuppressed,
    maintainFreezeScrollRange,
    reassertFreeze,
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
  const stickToEffectiveBottomRef = useRef(stickToEffectiveBottom)
  stickToEffectiveBottomRef.current = stickToEffectiveBottom
  // The freeze callbacks change identity whenever the anchor spacer state does.
  // The falling-edge RAF below must survive those re-renders (cancelling it
  // would silently skip the spacer reclaim), so the effect reads them through
  // refs and keeps `preserveScrollAnchor` as its only changing dependency.
  const handBackToRuntimeRef = useRef(handBackToRuntime)
  handBackToRuntimeRef.current = handBackToRuntime
  const maintainFreezeScrollRangeRef = useRef(maintainFreezeScrollRange)
  maintainFreezeScrollRangeRef.current = maintainFreezeScrollRange
  const reassertFreezeRef = useRef(reassertFreeze)
  reassertFreezeRef.current = reassertFreeze
  const wasPreservingScrollAnchorRef = useRef(preserveScrollAnchor)
  useEffect(() => {
    const wasPreserving = wasPreservingScrollAnchorRef.current
    wasPreservingScrollAnchorRef.current = preserveScrollAnchor
    if (preserveScrollAnchor) {
      // Rising edge — a new generation began: turn boundaries clear the driving
      // state, so the fresh turn starts runtime-driven rather than inheriting a
      // takeover latched during the previous turn or while idle.
      if (!wasPreserving) {
        readNavigationActiveRef.current = false
        smoothScroll.cancel()
        turnHandedOffRef.current = false
        handBackToRuntimeRef.current()
      }
      return
    }
    if (!wasPreserving) return
    // A stream ending is not a navigation boundary. Images, syntax highlighting
    // and lazy previews can still resize afterward, so a user-held viewport keeps
    // its ownership until the user returns to the bottom or a new turn begins.
    const userDrives = scrollDriverRef.current === 'user'
    if (!userDrives) handBackToRuntimeRef.current()
    const raf = requestAnimationFrame(() => {
      // Once streaming has ended, a user who already returned to the real
      // bottom no longer needs the released-pin range. Clear it here because
      // there may be no subsequent scroll or resize event to reclaim it.
      const currentScroller = scrollerRef.current
      const deferredResume = resumeFollowAfterSpacerRef.current
      const isAtRealBottom =
        currentScroller !== null &&
        Math.abs(getRealBottom(currentScroller, bottomFollowInsetRef.current) - currentScroller.scrollTop) <=
          FREEZE_REASSERT_TOLERANCE_PX
      if (atBottom.isAtBottom() && (!deferredResume || isAtRealBottom)) {
        anchorRef.current.release({ clearSpacer: true })
        handBackToRuntimeRef.current()
        if (!deferredResume) stickToEffectiveBottomRef.current()
        return
      }
      if (userDrives) maintainFreezeScrollRangeRef.current()
      const nextAnchorSpacerHeight = anchorRef.current.onContentSizeChange()
      if (userDrives) {
        maintainFreezeScrollRangeRef.current(nextAnchorSpacerHeight - anchorRef.current.spacerHeight)
        reassertFreezeRef.current()
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [atBottom, preserveScrollAnchor, smoothScroll])

  // ---- scrollToTopKey trigger: pin the named item ---------------------

  const lastScrollToTopKeyRef = useRef<string | undefined>(undefined)
  const didMountForScrollKeyRef = useRef(false)
  // The committed `preserveScrollAnchor` from the previous render — i.e. whether a
  // turn was already streaming just before the current commit. Lets the pin effect
  // tell a fresh idle→new-turn send from a mid-stream insertion. A trailing effect
  // (below) keeps it in sync AFTER the pin effect has read the prior value.
  const wasStreamingBeforeUserMessageRef = useRef(preserveScrollAnchor)

  useEffect(() => {
    const previous = lastScrollToTopKeyRef.current
    lastScrollToTopKeyRef.current = scrollToTopKey
    if (!didMountForScrollKeyRef.current) {
      didMountForScrollKeyRef.current = true
      return
    }
    if (!scrollToTopKey || scrollToTopKey === previous) return
    // A new user message appeared. Only pin it to the top when it STARTS a fresh
    // turn (the topic was idle just before it). If a turn was already streaming —
    // a queued follow-up steered into the live turn — pinning the new message to
    // the top would yank the view and fight the previous assistant's still-growing
    // response (the instability we're fixing). Leave scroll to bottom-follow.
    if (wasStreamingBeforeUserMessageRef.current) return
    const idx = findDataIndexByKey(scrollToTopKey)
    if (idx < 0) return
    readNavigationActiveRef.current = false
    smoothScroll.cancel()
    anchor.pinTo(idx)
    atBottom.reset()
    // New user turn: the message is freshly pinned to the top, so the runtime
    // drives again regardless of any takeover carried over from before.
    turnHandedOffRef.current = false
    handBackToRuntime()
  }, [anchor, atBottom, findDataIndexByKey, handBackToRuntime, scrollToTopKey, smoothScroll])

  // Sync the "was a turn already streaming" marker AFTER the pin effect above has
  // read the previous render's value. Runs every commit so the next new-user-
  // message commit sees whether streaming was in progress when it arrived.
  useEffect(() => {
    wasStreamingBeforeUserMessageRef.current = preserveScrollAnchor
  })

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
    const isUserInitiated = userScrollGestureRef.current || hasRecentUserScrollIntent
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
      !isBottomFollowSuppressed() &&
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
    anchor.onUserScroll(offset, isUserInitiated)
    const wheelDir = lastWheelDirRef.current
    const direction: 'up' | 'down' | 'none' =
      wheelDir !== 'none' ? wheelDir : delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
    lastScrollOffsetRef.current = offset
    if (scrollDriverRef.current === 'user') {
      if (isUserInitiated) {
        userScrollGestureRef.current = true
        if (direction === 'up') resumeFollowAfterSpacerRef.current = false
        // Reflow correction stays paused for the whole gesture. Only extend the
        // shrink baseline here; the semantic DOM anchor is captured once at
        // scrollend to avoid elementFromPoint/layout reads on every scroll event.
        const naturalHeight = getNaturalScrollHeight()
        freezeBaselineScrollHeightRef.current = Math.max(freezeBaselineScrollHeightRef.current ?? 0, naturalHeight)
        atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction, userInitiated: true })
        // A released top-pin spacer still lets the user move below the real
        // content edge. Crossing that effective-bottom threshold must not hand
        // control back: reclaiming the spacer there clamps scrollTop and drops
        // the user message to the viewport bottom. Explicit scroll-to-bottom is
        // the safe path that clears temporary range before following resumes.
        const hasTemporaryBottomRange = bottomFollowInsetRef.current > FREEZE_REASSERT_TOLERANCE_PX
        const hasReleasedAnchorRange = anchor.spacerHeight > FREEZE_REASSERT_TOLERANCE_PX
        const canReclaimTemporaryRange = !preserveScrollAnchorRef.current
        if (atBottom.isAtBottom() && (!hasTemporaryBottomRange || canReclaimTemporaryRange)) {
          turnHandedOffRef.current = true
          anchor.release(hasTemporaryBottomRange ? { clearSpacer: true } : undefined)
          handBackToRuntime()
          if (hasTemporaryBottomRange) stickToEffectiveBottom()
        } else if (atBottom.isAtBottom() && hasTemporaryBottomRange) {
          if (hasReleasedAnchorRange) {
            // During preparation, anchor-spacer decay and bottom-follow must not
            // write scrollTop together. Remember that the user returned to the
            // live edge but keep the frozen viewport as the sole writer until
            // natural content consumes that spacer; ResizeObserver completes the
            // handoff.
            resumeFollowAfterSpacerRef.current = true
          } else {
            // Freeze-only slack can be discarded immediately at the live edge;
            // unlike the anchor spacer, it does not protect the sent message's
            // preparation layout.
            turnHandedOffRef.current = true
            handBackToRuntime()
          }
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
      // A scroll during a preserve turn whose pin is gone (it just released, or
      // there never was one) hands governance to the at-bottom tracker, so
      // reaching the bottom re-engages auto-stick. `onUserScroll` runs first and
      // is input-gated, so the pin only drops on a real user scroll.
      if (preserveScrollAnchorRef.current && !anchor.isPinned()) {
        turnHandedOffRef.current = true
      }
      if (isUserInitiated && direction === 'up') {
        userScrollGestureRef.current = true
        // An upward user scroll is a takeover like any other interaction.
        takeUserControl()
      } else if (isBottomFollowSuppressed()) {
        atBottom.reset()
      } else {
        atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction, userInitiated: isUserInitiated })
        if (isUserInitiated && direction !== 'none' && !atBottom.isAtBottom()) {
          userScrollGestureRef.current = true
          takeUserControl()
        }
      }
    }
    updateScrollToBottomButtonVisibility()
    saveScrollPosition()
    maybeNotifyReachTop(offset)
  }, [
    anchor,
    atBottom,
    getNaturalScrollHeight,
    handBackToRuntime,
    isBottomFollowSuppressed,
    maintainFreezeScrollRange,
    maybeNotifyReachTop,
    reassertFreeze,
    saveScrollPosition,
    smoothScroll,
    stickToEffectiveBottom,
    takeUserControl,
    updateScrollToBottomButtonVisibility
  ])

  const onScrollEnd = useCallback(() => {
    lastWheelDirRef.current = 'none'
    if (scrollDriverRef.current === 'user' && userScrollGestureRef.current) {
      captureFreezeAnchor(undefined, true)
    }
    userScrollGestureRef.current = false
    // Scrolling has settled — capture the exact resting position, bypassing the
    // throttle that paces the in-flight `onScroll` saves.
    saveScrollPosition(true)
  }, [captureFreezeAnchor, saveScrollPosition])
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

  const keepMounted = useMemo<readonly number[]>(() => {
    const indices = new Set<number>()
    if (selectionIndex != null) indices.add(selectionIndex)
    for (const key of keepMountedKeys) {
      const index = items.findIndex((item, itemIndex) => getItemKey(item, itemIndex) === key)
      if (index >= 0) indices.add(index)
    }
    return [...indices]
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
      anchor.release({ clearSpacer: true })
      handBackToRuntime()
      turnHandedOffRef.current = true
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
    [anchor, atBottom, handBackToRuntime, smoothScroll, takeUserControl]
  )

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      readNavigationActiveRef.current = false
      // Explicit scroll-to-bottom releases any anchor — caller wants the
      // absolute bottom, not the user-message-top position.
      anchor.release({ clearSpacer: true })
      // The user chose the live edge: drop the frozen range before resolving
      // the target. The anchor inset remains until its state update commits, so
      // the current target still excludes both temporary spacers.
      turnHandedOffRef.current = true
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
    [anchor, atBottom, handBackToRuntime, hideScrollToBottomButton, smoothScroll]
  )

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
      isAtBottom: atBottom.isAtBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [atBottom.isAtBottom, findDataIndexByKey, navigateForReading, scrollToBottom, scrollToTop, topPadding]
  )

  return {
    scrollerRef,
    contentRef,
    freezeSpacerRef,
    vlistHandleRef,
    wrappedItems,
    wrappedGetItemKey,
    wrappedRenderItem: wrappedRenderItem as ChatVirtualizerRuntime<T>['wrappedRenderItem'],
    shift,
    keepMounted,
    scrollerProps,
    isScrollToBottomButtonVisible,
    takeUserControl,
    releaseUserControlIfAtBottomAfterLayout,
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
