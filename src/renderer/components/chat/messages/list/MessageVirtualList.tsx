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

import { Scrollbar } from '@cherrystudio/ui'
import { type ReactNode, type Ref, useCallback } from 'react'
import { Virtualizer } from 'virtua'

import { type MessageVirtualListHandle, useChatVirtualizerRuntime } from './chatVirtualizerRuntime'

export const MESSAGE_VIRTUAL_LIST_DEFAULT_TOP_PADDING_PX = 6
export const MESSAGE_VIRTUAL_LIST_DEFAULT_BOTTOM_PADDING_PX = 12

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
  topicId
}: MessageVirtualListProps<T>): React.ReactElement {
  const runtime = useChatVirtualizerRuntime({
    items,
    getItemKey,
    renderItem,
    onReachTop,
    hasMoreTop,
    handleRef,
    topReachOverscanItems: overscan,
    scrollToTopKey: forceScrollToBottomKey,
    topicId,
    bottomPadding
  })
  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.scrollerRef.current = element
      if (element) {
        onScrollContainerReady?.(element)
      }
    },
    [onScrollContainerReady, runtime.scrollerRef]
  )

  return (
    <Scrollbar
      ref={setScrollerRef}
      data-message-virtual-list-scroller
      className={className}
      style={{ overflowY: 'auto', overflowX: 'hidden', position: 'relative', ...style }}
      onWheel={runtime.scrollerProps.onWheel}>
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
          keepMounted={runtime.keepMounted}
          startMargin={topPadding}
          onScroll={runtime.scrollerProps.onScroll}
          onScrollEnd={runtime.scrollerProps.onScrollEnd}>
          {runtime.wrappedRenderItem}
        </Virtualizer>
      </div>
    </Scrollbar>
  )
}
