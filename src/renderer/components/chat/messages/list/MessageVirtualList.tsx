/**
 * Virtualized message list for the chat view.
 *
 * Built on `virtua`'s `<Virtualizer>` so we get O(log n) item offsets,
 * declarative `keepMounted` for selection survival, and `shift` for
 * prepend without visual jump — without owning the basic DOM windowing
 * + ResizeObserver scheduling code that was the source of past jitter.
 *
 * The chat-specific behavior (atBottom state machine, RAF smooth scroll
 * with cancel-on-wheel, scroll-user-message-to-top on send) lives in
 * `chatVirtualizerRuntime`. This component is just the JSX integration.
 */

import { Button, Scrollbar, Tooltip } from '@cherrystudio/ui'
import { ArrowDown } from 'lucide-react'
import { type ReactNode, type Ref, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtualizer } from 'virtua'

import { type MessageVirtualListHandle, useChatVirtualizerRuntime } from './chatVirtualizerRuntime'

export const MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX = 6
export const MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX = 12
const MESSAGE_SCROLL_TO_BOTTOM_BUTTON_DEFAULT_BOTTOM_OFFSET_PX = 24

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
  /**
   * Changes when the caller wants the message with this group key
   * scrolled to the viewport top. Typically set to the newest user
   * message's group key after the user sends.
   */
  forceScrollToBottomKey?: string
  /** Keep the top anchor stable while the response below it is still streaming. */
  preserveScrollAnchor?: boolean
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
  forceScrollToBottomKey,
  preserveScrollAnchor,
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
    scrollToTopKey: forceScrollToBottomKey,
    topicId,
    bottomPadding,
    preserveScrollAnchor
  })
  const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null)
  const { scrollToBottom, markUserInput } = runtime
  const { onWheel } = runtime.scrollerProps
  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.scrollerRef.current = element
      setScrollerElement(element)
      if (element) {
        onScrollContainerReady?.(element)
      }
    },
    [onScrollContainerReady, runtime.scrollerRef]
  )

  useEffect(() => {
    if (!scrollerElement) return
    const handleWheel = (event: WheelEvent) => onWheel(event)
    scrollerElement.addEventListener('wheel', handleWheel, { passive: true })
    return () => scrollerElement.removeEventListener('wheel', handleWheel)
  }, [onWheel, scrollerElement])

  // Flag real user scroll intent (touch/pointer/keyboard) so the runtime can tell
  // a genuine scroll-away from a programmatic scroll (virtua remeasure jump, a
  // child `scrollIntoView`) and only release the top pin for the former.
  useEffect(() => {
    if (!scrollerElement) return
    const onInput = () => markUserInput()
    scrollerElement.addEventListener('pointerdown', onInput, { passive: true })
    scrollerElement.addEventListener('touchstart', onInput, { passive: true })
    scrollerElement.addEventListener('keydown', onInput)
    return () => {
      scrollerElement.removeEventListener('pointerdown', onInput)
      scrollerElement.removeEventListener('touchstart', onInput)
      scrollerElement.removeEventListener('keydown', onInput)
    }
  }, [markUserInput, scrollerElement])

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom('smooth')
  }, [scrollToBottom])

  const shouldShowScrollToBottomButton = showScrollToBottomButton && runtime.isScrollToBottomButtonVisible

  return (
    <div data-message-virtual-list-root className="relative flex min-h-0" style={style}>
      <Scrollbar
        ref={setScrollerRef}
        data-message-virtual-list-scroller
        className={className}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overflowAnchor: 'none' }}>
        <div ref={runtime.contentRef} style={{ paddingBottom: bottomPadding }}>
          {topPadding > 0 && (
            <div aria-hidden="true" data-message-virtual-list-top-spacer style={{ height: topPadding }} />
          )}
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
        </div>
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
