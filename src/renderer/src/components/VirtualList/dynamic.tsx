import type { Range, ScrollToOptions, VirtualItem, VirtualizerOptions } from '@tanstack/react-virtual'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

const SCROLLBAR_AUTO_HIDE_DELAY = 2000

type InheritedVirtualizerOptions = Partial<
  Omit<
    VirtualizerOptions<HTMLDivElement, Element>,
    | 'count' // determined by items.length
    | 'getScrollElement' // determined by internal scrollerRef
    | 'estimateSize' // promoted to a required prop
    | 'rangeExtractor' // isSticky provides a simpler abstraction
  >
>

export interface DynamicVirtualListRef {
  /** Resets any prev item measurements. */
  measure: () => void
  /** Returns the scroll element for the virtualizer. */
  scrollElement: () => HTMLDivElement | null
  /** Scrolls the virtualizer to the pixel offset provided. */
  scrollToOffset: (offset: number, options?: ScrollToOptions) => void
  /** Scrolls the virtualizer to the items of the index provided. */
  scrollToIndex: (index: number, options?: ScrollToOptions) => void
  /** Resizes an item. */
  resizeItem: (index: number, size: number) => void
  /** Returns the total size in pixels for the virtualized items. */
  getTotalSize: () => number
  /** Returns the virtual items for the current state of the virtualizer. */
  getVirtualItems: () => VirtualItem[]
  /** Returns the virtual row indexes for the current state of the virtualizer. */
  getVirtualIndexes: () => number[]
}

export interface DynamicVirtualListProps<T> extends InheritedVirtualizerOptions {
  ref?: React.Ref<DynamicVirtualListRef>

  /**
   * List data
   */
  list: T[]

  /**
   * List item renderer function
   */
  children: (item: T, index: number) => React.ReactNode

  /**
   * List size (height or width, default is 100%)
   */
  size?: string | number

  /**
   * List item size estimator function (initial estimation)
   */
  estimateSize: (index: number) => number

  /**
   * Sticky item predicate, cannot be used with rangeExtractor
   */
  isSticky?: (index: number) => boolean

  /**
   * Get the depth/level of an item for hierarchical sticky positioning
   * Used with isSticky to determine ancestor relationships
   */
  getItemDepth?: (index: number) => number

  /**
   * Range extractor function, cannot be used with isSticky
   */
  rangeExtractor?: (range: Range) => number[]

  /**
   * List item container style
   */
  itemContainerStyle?: React.CSSProperties

  /**
   * Scroll container style
   */
  scrollerStyle?: React.CSSProperties

  /**
   * Hide the scrollbar automatically when scrolling is stopped
   */
  autoHideScrollbar?: boolean

  /**
   * Header content to display above the list
   */
  header?: React.ReactNode

  /**
   * Additional CSS class name for the container
   */
  className?: string
}

function DynamicVirtualList<T>(props: DynamicVirtualListProps<T>) {
  const {
    ref,
    list,
    children,
    size,
    estimateSize,
    isSticky,
    getItemDepth,
    rangeExtractor: customRangeExtractor,
    itemContainerStyle,
    scrollerStyle,
    autoHideScrollbar = false,
    header,
    className,
    ...restOptions
  } = props

  const [showScrollbar, setShowScrollbar] = useState(!autoHideScrollbar)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const internalScrollerRef = useRef<HTMLDivElement>(null)
  const scrollerRef = internalScrollerRef

  const activeStickyIndexesRef = useRef<number[]>([])

  const stickyIndexes = useMemo(() => {
    if (!isSticky) return []
    return list.map((_, index) => (isSticky(index) ? index : -1)).filter((index) => index !== -1)
  }, [list, isSticky])

  const internalStickyRangeExtractor = useCallback(
    (range: Range) => {
      const activeStickies: number[] = []

      if (getItemDepth) {
        // With depth information, we can build a proper ancestor chain
        // Find all sticky items before the visible range
        const stickiesBeforeRange = stickyIndexes.filter((index) => index < range.startIndex)

        if (stickiesBeforeRange.length > 0) {
          // Find the depth of the first visible item (or last sticky before it)
          const firstVisibleIndex = range.startIndex
          const referenceDepth = getItemDepth(firstVisibleIndex)

          // Build ancestor chain: include all sticky parents
          const ancestorChain: number[] = []
          let minDepth = referenceDepth

          // Walk backwards from the last sticky before visible range
          for (let i = stickiesBeforeRange.length - 1; i >= 0; i--) {
            const stickyIndex = stickiesBeforeRange[i]
            const stickyDepth = getItemDepth(stickyIndex)

            // Include this sticky if it's a parent (smaller depth) of our reference
            if (stickyDepth < minDepth) {
              ancestorChain.unshift(stickyIndex)
              minDepth = stickyDepth
            }
          }

          activeStickies.push(...ancestorChain)
        }
      } else {
        // Fallback: without depth info, just use the last sticky before range
        const lastStickyBeforeRange = [...stickyIndexes].reverse().find((index) => index < range.startIndex)
        if (lastStickyBeforeRange !== undefined) {
          activeStickies.push(lastStickyBeforeRange)
        }
      }

      // Update the ref with current active stickies
      activeStickyIndexesRef.current = activeStickies

      // Merge the active sticky indexes and the default range extractor
      const next = new Set([...activeStickyIndexesRef.current, ...defaultRangeExtractor(range)])

      // Sort the set to maintain proper order
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes, getItemDepth]
  )

  const rangeExtractor = customRangeExtractor ?? (isSticky ? internalStickyRangeExtractor : undefined)

  const handleScrollbarHide = useCallback(
    (isScrolling: boolean) => {
      if (!autoHideScrollbar) return

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (isScrolling) {
        setShowScrollbar(true)
      } else {
        timeoutRef.current = setTimeout(() => {
          setShowScrollbar(false)
        }, SCROLLBAR_AUTO_HIDE_DELAY)
      }
    },
    [autoHideScrollbar]
  )

  const virtualizer = useVirtualizer({
    ...restOptions,
    count: list.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize,
    rangeExtractor,
    onChange: (instance, sync) => {
      restOptions.onChange?.(instance, sync)
      handleScrollbarHide(instance.isScrolling)
    }
  })

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [autoHideScrollbar])

  useImperativeHandle(
    ref,
    () => ({
      measure: () => virtualizer.measure(),
      scrollElement: () => virtualizer.scrollElement,
      scrollToOffset: (offset, options) => virtualizer.scrollToOffset(offset, options),
      scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options),
      resizeItem: (index, size) => virtualizer.resizeItem(index, size),
      getTotalSize: () => virtualizer.getTotalSize(),
      getVirtualItems: () => virtualizer.getVirtualItems(),
      getVirtualIndexes: () => virtualizer.getVirtualIndexes()
    }),
    [virtualizer]
  )

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const { horizontal } = restOptions

  return (
    <ScrollContainer
      ref={scrollerRef}
      className={className ? `dynamic-virtual-list ${className}` : 'dynamic-virtual-list'}
      role="region"
      aria-label="Dynamic Virtual List"
      aria-hidden={!showScrollbar}
      $autoHide={autoHideScrollbar}
      $show={showScrollbar}
      style={{
        overflow: 'auto',
        ...(horizontal ? { width: size ?? '100%' } : { height: size ?? '100%' }),
        ...scrollerStyle
      }}>
      {header}
      <div
        style={{
          position: 'relative',
          width: horizontal ? `${totalSize}px` : '100%',
          height: !horizontal ? `${totalSize}px` : '100%'
        }}>
        {virtualItems.map((virtualItem) => {
          const isItemSticky = stickyIndexes.includes(virtualItem.index)
          const isItemActiveSticky = isItemSticky && activeStickyIndexesRef.current.includes(virtualItem.index)

          // Calculate the sticky offset for multi-level sticky headers
          const activeStickyIndex = isItemActiveSticky ? activeStickyIndexesRef.current.indexOf(virtualItem.index) : -1

          // Calculate cumulative offset based on actual sizes of previous sticky items
          let stickyOffset = 0
          if (activeStickyIndex >= 0) {
            for (let i = 0; i < activeStickyIndex; i++) {
              const prevStickyIndex = activeStickyIndexesRef.current[i]
              stickyOffset += estimateSize(prevStickyIndex)
            }
          }

          // Check if this item is visually covered by sticky items
          // If covered, disable pointer events to prevent hover/click bleeding through
          const isCoveredBySticky = (() => {
            if (!activeStickyIndexesRef.current.length) return false
            if (isItemActiveSticky) return false // Sticky items themselves are not covered

            // Calculate if this item's visual position is under any sticky header
            const itemVisualTop = virtualItem.start
            let totalStickyHeight = 0
            for (const stickyIdx of activeStickyIndexesRef.current) {
              totalStickyHeight += estimateSize(stickyIdx)
            }

            // If item starts within the sticky area, it's covered
            return itemVisualTop < totalStickyHeight
          })()

          const style: React.CSSProperties = {
            ...itemContainerStyle,
            position: isItemActiveSticky ? 'sticky' : 'absolute',
            top: isItemActiveSticky ? stickyOffset : 0,
            left: 0,
            zIndex: isItemActiveSticky ? 1000 + (100 - activeStickyIndex) : isItemSticky ? 999 : 0,
            pointerEvents: isCoveredBySticky ? 'none' : 'auto',
            ...(isItemActiveSticky && {
              backgroundColor: 'var(--color-background)'
            }),
            ...(horizontal
              ? {
                  transform: isItemActiveSticky ? undefined : `translateX(${virtualItem.start}px)`,
                  height: '100%'
                }
              : {
                  transform: isItemActiveSticky ? undefined : `translateY(${virtualItem.start}px)`,
                  width: '100%'
                })
          }

          return (
            <div key={virtualItem.key} data-index={virtualItem.index} ref={virtualizer.measureElement} style={style}>
              {children(list[virtualItem.index], virtualItem.index)}
            </div>
          )
        })}
      </div>
    </ScrollContainer>
  )
}

const ScrollContainer = styled.div<{ $autoHide: boolean; $show: boolean }>`
  &::-webkit-scrollbar-thumb {
    transition: background 0.3s ease-in-out;
    will-change: background;
    background: ${(props) => (props.$autoHide && !props.$show ? 'transparent' : 'var(--color-scrollbar-thumb)')};

    &:hover {
      background: var(--color-scrollbar-thumb-hover);
    }
  }
`

const MemoizedDynamicVirtualList = memo(DynamicVirtualList) as <T>(
  props: DynamicVirtualListProps<T>
) => React.ReactElement

export default MemoizedDynamicVirtualList
