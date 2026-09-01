/**
 * Virtualized message list for the chat view.
 *
 * Built on `virtua`'s `<Virtualizer>` so we get O(log n) item offsets,
 * declarative `keepMounted` for selection survival, and `shift` for
 * prepend without visual jump — without owning the basic DOM windowing
 * + ResizeObserver scheduling code that was the source of past jitter.
 *
 * The chat-specific behavior (following/reading state, explicit-navigation
 * animation, and user-owned viewport stability) lives in
 * `chatVirtualizerRuntime`. This component is just the JSX integration.
 */

import { ArrowDown } from 'lucide-react'
import { type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { Button, Scrollbar, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type MessageVirtualListHandle, useChatVirtualizerRuntime } from './chatVirtualizerRuntime'
import {
  canConsumeVerticalWheel,
  findNearestVerticalScrollContainer,
  findVerticalWheelConsumer,
  ScrollOwnershipProvider
} from './ScrollOwnershipContext'

export const MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX = 6
export const MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX = 12
const MESSAGE_SCROLL_TO_BOTTOM_BUTTON_DEFAULT_BOTTOM_OFFSET_PX = 24
const KEYBOARD_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])
const KEYBOARD_SCROLL_OWNER_SELECTOR =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"]'
const KEYBOARD_FOCUS_OWNER_SELECTOR = `${KEYBOARD_SCROLL_OWNER_SELECTOR},button,a[href],summary,[tabindex]:not([tabindex="-1"])`

function isKeyboardScrollIntent(event: KeyboardEvent, scroller: HTMLElement): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (KEYBOARD_SCROLL_KEYS.has(event.key)) return !target?.closest(KEYBOARD_SCROLL_OWNER_SELECTOR)
  if (event.key !== ' ' && event.key !== 'Spacebar') return false
  return target === scroller || !hasIndependentKeyboardFocusOwner(target, scroller)
}

function getKeyboardScrollDelta(event: KeyboardEvent): number {
  if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') return -1
  if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End') return 1
  return event.shiftKey ? -1 : 1
}

function getEventTargetElement(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target : null
  return element instanceof HTMLElement ? element : (element?.parentElement ?? null)
}

function findNestedScroller(target: EventTarget | null, scroller: HTMLElement): HTMLElement | null {
  return findNearestVerticalScrollContainer(getEventTargetElement(target), scroller)
}

function hasIndependentKeyboardFocusOwner(target: EventTarget | null, scroller: HTMLElement): boolean {
  const owner = getEventTargetElement(target)?.closest(KEYBOARD_FOCUS_OWNER_SELECTOR)
  return owner instanceof HTMLElement && owner !== scroller
}

function focusScrollerForKeyboard(scroller: HTMLElement): void {
  scroller.focus({ preventScroll: true })
}

function isDocumentFocusUnowned(ownerDocument: Document): boolean {
  const { activeElement } = ownerDocument
  return (
    activeElement === ownerDocument.body || activeElement === ownerDocument.documentElement || activeElement === null
  )
}

export type { MessageVirtualListHandle }

export interface MessageVirtualListProps<T> {
  /** Items in chronological order (oldest first). DOM order = display order. */
  items: T[]
  /**
   * Stable, unique key per item. Same item across renders MUST yield the
   * same key — virtua keys measured heights by this position.
   */
  getItemKey(item: T, index: number): string
  /** Render function for one item. */
  renderItem(item: T, index: number): ReactNode
  /** Initial pixel estimate per item; refined as items are measured. */
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
  handleRef?: Ref<MessageVirtualListHandle>
  /** className applied to the outer scroll container. */
  className?: string
  onScrollContainerReady?(element: HTMLDivElement): void
  /** style applied to the outer scroll container. */
  style?: React.CSSProperties
  /** Extra empty space before the oldest message. */
  topPadding?: number
  /** Extra empty space after the newest message. */
  bottomPadding?: number
  /** Stable item keys to retain while their live local UI state is active. */
  keepMountedKeys?: readonly string[]
  /** Whether to render the floating scroll-to-bottom affordance when the runtime is far from bottom. */
  showScrollToBottomButton?: boolean
  /** Distance from the scroll viewport bottom to place the floating scroll-to-bottom affordance. */
  scrollToBottomButtonBottomOffset?: number
  /**
   * Topic id used to remember and restore this list's scroll position
   * across remounts (topic / agent-session switches).
   */
  topicId?: string
}

export function MessageVirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize,
  overscan = 6,
  onReachTop,
  hasMoreTop = false,
  handleRef,
  className,
  onScrollContainerReady,
  style,
  topPadding = MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX,
  bottomPadding = MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX,
  keepMountedKeys,
  showScrollToBottomButton = false,
  scrollToBottomButtonBottomOffset = MESSAGE_SCROLL_TO_BOTTOM_BUTTON_DEFAULT_BOTTOM_OFFSET_PX,
  topicId
}: MessageVirtualListProps<T>): React.ReactElement {
  const { t } = useTranslation()
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey,
    renderItem,
    onReachTop,
    hasMoreTop,
    handleRef,
    topReachOverscanItems: overscan,
    topPadding,
    topicId,
    bottomPadding,
    keepMountedKeys
  })
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const { beginScrollbarDrag, endScrollbarDrag, scrollToBottom, markUserInput, takeUserControl } = runtime
  const { onWheel } = runtime.scrollerProps
  // Latch the captured node like TabRouter does: a background tab detaches the
  // ref (element === null) while its DOM node lives on, and clearing this state
  // would unmount the virtualizer below — discarding virtua's measurements and
  // every message's own state on a plain tab switch.
  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.scrollerRef.current = element
      if (element) {
        setScrollerElement(element)
        onScrollContainerReady?.(element)
      }
    },
    [onScrollContainerReady, runtime.scrollerRef]
  )

  useEffect(() => {
    if (!scrollerElement) return
    const handleWheel = (event: WheelEvent) => {
      // A purely horizontal wheel neither scrolls this list nor signals
      // vertical intent — it must not take scroll ownership away.
      if (event.deltaY === 0) return
      const target = event.target instanceof Element ? event.target : null
      if (findVerticalWheelConsumer(target, event.deltaY, scrollerElement)) return
      if (
        isDocumentFocusUnowned(scrollerElement.ownerDocument) &&
        !hasIndependentKeyboardFocusOwner(event.target, scrollerElement)
      )
        focusScrollerForKeyboard(scrollerElement)
      onWheel(event)
    }
    scrollerElement.addEventListener('wheel', handleWheel, { passive: true })
    return () => scrollerElement.removeEventListener('wheel', handleWheel)
  }, [onWheel, scrollerElement])

  // Inner scrollers own input while they can consume it. Input that reaches
  // their natural boundary is handed to the outer list's single runtime.
  const pointerGestureRef = useRef<{
    nestedScroller: HTMLElement | null
    pointerType: string
    lastClientY: number
  } | null>(null)
  useEffect(() => {
    if (!scrollerElement) return
    const ownerDocument = scrollerElement.ownerDocument
    const onPointerDown = (event: PointerEvent) => {
      const nestedScroller = findNestedScroller(event.target, scrollerElement)
      pointerGestureRef.current = {
        nestedScroller,
        pointerType: event.pointerType,
        lastClientY: event.clientY
      }
      if (!nestedScroller && !hasIndependentKeyboardFocusOwner(event.target, scrollerElement))
        focusScrollerForKeyboard(scrollerElement)
      if (event.target === scrollerElement) beginScrollbarDrag()
    }
    const onPointerMove = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current
      if (event.buttons === 0 || !gesture) return

      const deltaY = gesture.lastClientY - event.clientY
      gesture.lastClientY = event.clientY
      if (!gesture.nestedScroller) {
        markUserInput()
        return
      }

      const isTouchLikePointer = gesture.pointerType === 'touch' || gesture.pointerType === 'pen'
      if (isTouchLikePointer && deltaY !== 0 && !canConsumeVerticalWheel(gesture.nestedScroller, deltaY))
        markUserInput()
    }
    // The release can land anywhere (a scrollbar drag ends off-list), so the
    // gesture flag resets at the document level.
    const onPointerEnd = () => {
      pointerGestureRef.current = null
      endScrollbarDrag()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isKeyboardScrollIntent(event, scrollerElement)) return
      const nestedScroller = findNestedScroller(event.target, scrollerElement)
      const delta = getKeyboardScrollDelta(event)
      if (nestedScroller && canConsumeVerticalWheel(nestedScroller, delta)) return
      markUserInput(delta < 0 ? 'up' : 'down')
    }
    let focusedVirtualDescendant: Node | null = null
    const restoreFocusAfterOwnerRemoval = () => {
      const focusOwner = focusedVirtualDescendant
      if (!focusOwner || (focusOwner.isConnected && scrollerElement.contains(focusOwner))) return
      focusedVirtualDescendant = null

      if (scrollerElement.isConnected && ownerDocument.hasFocus() && isDocumentFocusUnowned(ownerDocument))
        focusScrollerForKeyboard(scrollerElement)
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      focusedVirtualDescendant =
        target instanceof Node && target !== scrollerElement && scrollerElement.contains(target) ? target : null
    }
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node) || target !== focusedVirtualDescendant) return
      queueMicrotask(() => {
        if (focusedVirtualDescendant !== target) return
        if (target.isConnected && scrollerElement.contains(target)) {
          focusedVirtualDescendant = null
          return
        }
        restoreFocusAfterOwnerRemoval()
      })
    }
    const focusOwnerObserver = new MutationObserver(restoreFocusAfterOwnerRemoval)
    focusOwnerObserver.observe(scrollerElement, { childList: true, subtree: true })
    scrollerElement.addEventListener('pointerdown', onPointerDown, { passive: true })
    scrollerElement.addEventListener('pointermove', onPointerMove, { passive: true })
    ownerDocument.addEventListener('pointerup', onPointerEnd, { passive: true })
    ownerDocument.addEventListener('pointercancel', onPointerEnd, { passive: true })
    scrollerElement.addEventListener('focusin', onFocusIn)
    scrollerElement.addEventListener('focusout', onFocusOut)
    scrollerElement.addEventListener('keydown', onKeyDown)
    return () => {
      focusOwnerObserver.disconnect()
      scrollerElement.removeEventListener('pointerdown', onPointerDown)
      scrollerElement.removeEventListener('pointermove', onPointerMove)
      ownerDocument.removeEventListener('pointerup', onPointerEnd)
      ownerDocument.removeEventListener('pointercancel', onPointerEnd)
      scrollerElement.removeEventListener('focusin', onFocusIn)
      scrollerElement.removeEventListener('focusout', onFocusOut)
      scrollerElement.removeEventListener('keydown', onKeyDown)
    }
  }, [beginScrollbarDrag, endScrollbarDrag, markUserInput, scrollerElement])

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  const requestDisclosureReadingControl = useCallback(
    (anchor: HTMLElement | null) => takeUserControl('disclosure', anchor),
    [takeUserControl]
  )

  const shouldShowScrollToBottomButton = showScrollToBottomButton && runtime.isScrollToBottomButtonVisible

  return (
    <div data-message-virtual-list-root className="relative flex min-h-0" style={style}>
      <Scrollbar
        ref={setScrollerRef}
        data-message-virtual-list-scroller
        tabIndex={0}
        role="region"
        aria-label={t('globalSearch.groups.message')}
        className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]', className)}>
        <div ref={runtime.contentRef}>
          <ScrollOwnershipProvider
            scrollContainerRef={runtime.scrollerRef}
            requestReadingControl={requestDisclosureReadingControl}
            scrollToElement={runtime.scrollToElement}
            notifyWheelIntent={runtime.notifyWheelIntent}
            scrollByWheel={runtime.scrollByWheel}>
            {topPadding > 0 && (
              <div aria-hidden="true" data-message-virtual-list-top-spacer style={{ height: topPadding }} />
            )}
            {/* Virtua reads an external scrollRef only when it mounts. Wait for
                Scrollbar's ref callback so staged layouts cannot leave it
                permanently unmeasured with data but no rendered items. */}
            {scrollerElement && (
              <Virtualizer
                ref={runtime.vlistHandleRef}
                scrollRef={runtime.scrollerRef}
                data={runtime.wrappedItems}
                itemSize={estimateSize}
                bufferSize={Math.max(200, overscan * (estimateSize ?? 200))}
                shift={runtime.shift}
                keepMounted={runtime.keepMounted}
                startMargin={topPadding}
                onScroll={runtime.scrollerProps.onScroll}
                onScrollEnd={runtime.scrollerProps.onScrollEnd}>
                {runtime.wrappedRenderItem}
              </Virtualizer>
            )}
          </ScrollOwnershipProvider>
        </div>
        {/* Outside the content wrapper so runtime-owned freeze slack does not
            inflate the natural content size observed above. */}
        <div ref={runtime.freezeSpacerRef} aria-hidden="true" data-message-virtual-list-freeze-spacer />
      </Scrollbar>
      {shouldShowScrollToBottomButton && (
        <ScrollToBottomButton
          bottomOffset={scrollToBottomButtonBottomOffset}
          label={t('chat.navigation.bottom')}
          onClick={handleScrollToBottom}
        />
      )}
    </div>
  )
}

interface ScrollToBottomButtonProps {
  bottomOffset: number
  label: string
  onClick(): void
}

function ScrollToBottomButton({ bottomOffset, label, onClick }: ScrollToBottomButtonProps) {
  return (
    <div
      data-message-scroll-to-bottom-button-layer
      className="pointer-events-none absolute inset-x-0 z-5 flex justify-center"
      style={{ bottom: bottomOffset }}>
      <Tooltip content={label} delay={500} placement="top">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          className="[&_svg]:!size-5 pointer-events-auto h-9 w-9 rounded-full border-border bg-background/95 text-foreground shadow-[0_10px_24px_rgba(15,23,42,0.14),0_3px_8px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-[background-color,color,box-shadow] duration-200 ease-out hover:bg-background hover:text-foreground dark:shadow-[0_12px_28px_rgba(0,0,0,0.34),0_3px_10px_rgba(0,0,0,0.22)]"
          data-testid="message-scroll-to-bottom-button"
          onClick={onClick}>
          <ArrowDown />
        </Button>
      </Tooltip>
    </div>
  )
}
