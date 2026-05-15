/**
 * Virtualized message list for the chat view.
 *
 * Built on `@tanstack/react-virtual` (already in deps via `CodeViewer`),
 * with chat-specific scroll behavior implemented by
 * `useMessageVirtualListRuntime`:
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

import { Scrollbar } from '@cherrystudio/ui'
import { type ReactNode, type Ref } from 'react'

import { type MessageVirtualListHandle, useMessageVirtualListRuntime } from './useMessageVirtualListRuntime'

const DEFAULT_TOP_PADDING_PX = 10
const DEFAULT_BOTTOM_PADDING_PX = 18

export type { MessageVirtualListHandle }

export interface MessageVirtualListProps<T> {
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
  handleRef?: Ref<MessageVirtualListHandle>
  /** className applied to the outer scroll container. */
  className?: string
  /** style applied to the outer scroll container. */
  style?: React.CSSProperties
  /** Extra empty space before the oldest message. */
  topPadding?: number
  /** Extra empty space after the newest message. */
  bottomPadding?: number
}

export function MessageVirtualList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize = 200,
  overscan = 6,
  onReachTop,
  hasMoreTop = false,
  handleRef,
  className,
  style,
  topPadding = DEFAULT_TOP_PADDING_PX,
  bottomPadding = DEFAULT_BOTTOM_PADDING_PX
}: MessageVirtualListProps<T>): React.ReactElement {
  const { measureItem, scrollerRef, scrollHeight, virtualItems } = useMessageVirtualListRuntime({
    items,
    getItemKey,
    estimateSize,
    overscan,
    onReachTop,
    hasMoreTop,
    handleRef,
    topPadding,
    bottomPadding
  })

  return (
    <Scrollbar
      ref={scrollerRef}
      className={className}
      style={{ overflowY: 'auto', overflowX: 'hidden', position: 'relative', ...style }}>
      <div style={{ height: scrollHeight, position: 'relative', width: '100%' }}>
        {virtualItems.map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={measureItem}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${topPadding + vi.start}px)`
            }}>
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </Scrollbar>
  )
}
